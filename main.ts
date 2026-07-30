import { Client, isFullPage, collectPaginatedAPI } from '@notionhq/client'
import { WebClient } from '@slack/web-api';
import dayjs, { Dayjs } from 'dayjs';
// @holiday-jp/holiday_jpはCJSのエクスポート形式が静的解析できず、named importだと
// Node素のESMローダーで実行時エラーになるため、default importでプロパティ参照する
import holidayJp from '@holiday-jp/holiday_jp';
import pRetry, { AbortError } from 'p-retry';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PageObjectResponse, DataSourceObjectResponse, QueryDataSourceParameters } from '@notionhq/client/build/src/api-endpoints';
import type { KnownBlock } from '@slack/web-api';

export interface Config {
  dataSourceId: string;
  properties: {
    title: string;
    labels: string;
    author: string;
    date: string;
  };
  recipients: {
    labels: string[];
    channelId: string;
  }[];
  // 社内GHESのURLなど利用者ごとに異なる文言のため任意項目にする
  footerText?: string;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, keyPath: string): string => {
  if (typeof value !== 'string') {
    throw new Error(`設定の "${keyPath}" は文字列である必要があります（実際の型: ${typeof value}）`);
  }
  return value;
};

const requireStringArray = (value: unknown, keyPath: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`設定の "${keyPath}" は文字列の配列である必要があります`);
  }
  return value;
};

const validateProperties = (value: unknown, keyPath: string): Config['properties'] => {
  if (!isPlainObject(value)) {
    throw new Error(`設定の "${keyPath}" はオブジェクトである必要があります`);
  }
  return {
    title: requireString(value.title, `${keyPath}.title`),
    labels: requireString(value.labels, `${keyPath}.labels`),
    author: requireString(value.author, `${keyPath}.author`),
    date: requireString(value.date, `${keyPath}.date`),
  };
};

const validateRecipient = (value: unknown, keyPath: string): Config['recipients'][number] => {
  if (!isPlainObject(value)) {
    throw new Error(`設定の "${keyPath}" はオブジェクトである必要があります`);
  }
  return {
    labels: requireStringArray(value.labels, `${keyPath}.labels`),
    channelId: requireString(value.channelId, `${keyPath}.channelId`),
  };
};

const validateRecipients = (value: unknown, keyPath: string): Config['recipients'] => {
  if (!Array.isArray(value)) {
    throw new Error(`設定の "${keyPath}" は配列である必要があります`);
  }
  return value.map((item, index) => validateRecipient(item, `${keyPath}[${index}]`));
};

// JSON.parse直後のunknownからConfigへ絞り込む。どのキーが問題かをエラーメッセージに含め、
// 設定だけ差し替えて使う利用者が原因箇所を特定できるようにする
export const validateConfig = (data: unknown): Config => {
  if (!isPlainObject(data)) {
    throw new Error('設定はオブジェクトである必要があります');
  }

  const config: Config = {
    dataSourceId: requireString(data.dataSourceId, 'dataSourceId'),
    properties: validateProperties(data.properties, 'properties'),
    recipients: validateRecipients(data.recipients, 'recipients'),
  };

  if (data.footerText !== undefined) {
    config.footerText = requireString(data.footerText, 'footerText');
  }

  return config;
};

export const loadConfig = (filePath: string): Config => {
  const raw = readFileSync(filePath, 'utf-8');

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`設定ファイル "${filePath}" のJSONパースに失敗しました: ${message}`);
  }

  return validateConfig(data);
};

// CLIとして実行されるため、カレントディレクトリ基準で解決する
// （NIPPOTION_CONFIGはcli.tsが--configオプションから設定する経路でもある）
const resolveConfigPath = (): string =>
  resolve(process.cwd(), process.env.NIPPOTION_CONFIG ?? 'nippotion.json');

const config = loadConfig(resolveConfigPath());

const client = new Client({
  auth: process.env.NOTION_API_TOKEN,
  timeoutMs: 120000, // 120秒のタイムアウト（デフォルト60秒から延長）
});
const slack = new WebClient(process.env.SLACK_BOT_API_TOKEN);
const dataSourceId = config.dataSourceId;

// エラーはNotion SDKの例外クラスに限らず、p-retryがerrorプロパティにラップしたプレーンオブジェクトの
// 形でも観測されているため、instanceofではなくRecord<string, unknown>への絞り込みで構造的に探査する
const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;

const extractErrorInfo = (error: unknown): { code: unknown; status: unknown; causeCode: unknown } => {
  const err = asRecord(error);
  const originalError = asRecord(err?.originalError);
  const wrappedError = asRecord(err?.error);
  const cause = asRecord(err?.cause);

  return {
    code: err?.code ?? originalError?.code ?? wrappedError?.code,
    status: err?.status ?? originalError?.status ?? wrappedError?.status,
    causeCode: cause?.code,
  };
};

const isKnownRetryableCode = (code: unknown): boolean =>
  typeof code === 'string' && ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'].includes(code);

export const isRetryableError = (error: unknown): boolean => {
  const { code, status, causeCode } = extractErrorInfo(error);

  return (
    code === 'notionhq_client_request_timeout' ||
    // Notionのレート制限（429 / rate_limited）は待てば解消するため再試行対象にする
    code === 'rate_limited' ||
    status === 429 ||
    (code === 'notionhq_client_response_error' && (status === undefined || (typeof status === 'number' && status >= 500))) ||
    isKnownRetryableCode(code) ||
    isKnownRetryableCode(causeCode)
  );
};

const formatError = (error: unknown): string => {
  const message = asRecord(error)?.message;
  if (typeof message === 'string' && message) return message;
  if (typeof error === 'string') return error;
  return JSON.stringify(error, null, 2);
};

const withRetry = <T>(fn: () => Promise<T>): Promise<T> =>
  pRetry(fn, {
    retries: 3,
    minTimeout: 5000,
    onFailedAttempt: ({ error, attemptNumber, retriesLeft, retryDelay }) => {
      const { code, status } = extractErrorInfo(error);
      const retryable = isRetryableError(error);

      console.log(`Notion API call failed (attempt ${attemptNumber}/${retriesLeft + attemptNumber}):`, {
        code,
        status,
        message: error.message,
        isRetryable: retryable
      });

      if (!retryable) {
        console.error('Non-retryable error encountered:', formatError(error));
        throw new AbortError(formatError(error));
      }

      console.log(`Retrying in ${retryDelay / 1000}s...`);
    }
  });

// filter_properties解決に使うプロパティ名は、Notion側の実プロパティ名を1箇所（nippotion.json）に集約するためconfigから導出する。
// dateはフィルタ条件にのみ使いレスポンスには不要なため、ここには含めない
const REQUIRED_PROPERTIES = [config.properties.labels, config.properties.title, config.properties.author];

const getDatabaseInfo = async (dataSourceId: string): Promise<{ url: string; title: string; propertyIds: string[] }> =>
  withRetry(async () => {
    const dataSource = await client.dataSources.retrieve({
      data_source_id: dataSourceId
    }) as DataSourceObjectResponse;

    const propertyIds = REQUIRED_PROPERTIES.map(name => {
      const prop = Object.values(dataSource.properties).find(p => p.name === name);
      if (!prop) throw new Error(`プロパティ "${name}" が見つかりません`);
      return prop.id;
    });

    return {
      url: dataSource.url,
      title: dataSource.title.map(t => t.plain_text).join(''),
      propertyIds,
    };
  });

export const createHeaderBlock = (databaseUrl: string, databaseTitle: string): KnownBlock[] => [
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `前営業日の<${databaseUrl}|${databaseTitle}>はこちら`
    },
  },
  {
    type: "divider"
  }
];
// footerTextはOSS利用者ごとに異なる（社内GHESのURLを含む文言を強制しないため）任意項目なので、
// 未設定なら空配列にしてbuildMessageBlocksのブロック数計算にも影響しないようにする
export const footerBlock: KnownBlock[] = config.footerText
  ? [
    {
      type: "divider"
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: config.footerText
        }
      ]
    }
  ]
  : [];

export const isWeekendOrHoliday = (date: Dayjs) => {
  return date.day() === 0 || date.day() === 6 || holidayJp.isHoliday(date.toDate());
}

export const getPreviousWorkday = (date: Dayjs) => {
  let previousWorkday = date.subtract(1, 'day');

  while (isWeekendOrHoliday(previousWorkday)) {
    previousWorkday = previousWorkday.subtract(1, 'day');
  }
  return previousWorkday;
}

export const getDateFilter = (previousWorkday: Dayjs, today: Dayjs) => {
  const previousDay = today.subtract(1, 'day');

  if (previousWorkday.isSame(previousDay, 'day')) {
    return {
      "property": config.properties.date,
      "date": { "equals": previousWorkday.format("YYYY-MM-DD") }
    };
  }

  return {
    "and": [{
      "property": config.properties.date,
      "date": {
        "on_or_after": previousWorkday.format("YYYY-MM-DD"),
      }
    }, {
      "property": config.properties.date,
      "date": {
        "on_or_before": previousDay.format("YYYY-MM-DD")
      }
    }]
  };
}

const getAllEntries = async (previousWorkday: Dayjs, today: Dayjs, filterProperties?: string[]): Promise<PageObjectResponse[]> => {
  // collectPaginatedAPIのlistFn自体をwithRetryで包むことで、ページ単位でリトライが効くようにする
  // （全体を1つのwithRetryで包むと、途中まで取得済みのページも最初からやり直しになってしまう）
  const results = await collectPaginatedAPI(
    (args: QueryDataSourceParameters) => withRetry(() => client.dataSources.query(args)),
    {
      data_source_id: dataSourceId,
      filter: getDateFilter(previousWorkday, today),
      filter_properties: filterProperties,
    }
  );
  return results.filter(isFullPage);
};

// Notionプロパティ名はnippotion.jsonのpropertiesに集約し、この3関数から参照する。
// typeによるnarrowingで想定外のプロパティ型が来た場合もクラッシュせずフォールバック値を返す。
const getTitle = (entry: PageObjectResponse): string | undefined => {
  const prop = entry.properties[config.properties.title];
  if (prop?.type !== "title") return undefined;
  return prop.title[0]?.plain_text;
};

const getWriterName = (entry: PageObjectResponse): string | null | undefined => {
  const prop = entry.properties[config.properties.author];
  if (prop?.type !== "created_by") return undefined;
  const user = prop.created_by;
  // created_byはPartialUserObjectResponse | UserObjectResponseのユニオンで、nameは後者にしかない
  return 'name' in user ? user.name : undefined;
};

const getLabels = (entry: PageObjectResponse): string[] => {
  const prop = entry.properties[config.properties.labels];
  if (prop?.type !== "multi_select") return [];
  return prop.multi_select.map(s => s.name);
};

// 「今日のひとこと」が空のページはリンク先が<url|undefined>になってしまうため、
// ピックアップ選出・チャンネル投稿の両方で共通して除外する
export const hasTitle = (entry: PageObjectResponse): boolean => Boolean(getTitle(entry));

export const getPickupEntry = (entries: PageObjectResponse[]): PageObjectResponse | null => {
  const candidates = entries.filter(hasTitle);

  if (candidates.length === 0) {
    return null;
  }

  // 直前のlength===0チェックにより添字は必ず範囲内だが、noUncheckedIndexedAccessにより型上はundefinedになるため型を合わせる
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

export const toEntryBlock = (entry: PageObjectResponse, pickup = false): KnownBlock => {
  const title = getTitle(entry);
  const writerName = getWriterName(entry);
  if (pickup === true) {
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*:star:今日のピックアップ日記は ${writerName} さん:star:*\n<${entry.url}|${title}>`
      }
    };
  } else {
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${writerName}*\n<${entry.url}|${title}>`
      }
    }
  };
}

const MAX_BLOCKS_PER_MESSAGE = 50; // Slack chat.postMessageのblocks上限

// エントリが多いとヘッダー+エントリ+ピックアップ+フッターが50 blocksを超えるため、
// 超える場合のみヘッダーを先頭・ピックアップとフッターを末尾のメッセージに固定して分割する
export const buildMessageBlocks = (headerBlock: KnownBlock[], entriesBlock: KnownBlock[], pickupBlock: KnownBlock[]): KnownBlock[][] => {
  const singleMessageBlocks = [...headerBlock, ...entriesBlock, ...pickupBlock, ...footerBlock];
  if (singleMessageBlocks.length <= MAX_BLOCKS_PER_MESSAGE) {
    return [singleMessageBlocks];
  }

  const messages: KnownBlock[][] = [];

  const maxEntriesInFirstMessage = MAX_BLOCKS_PER_MESSAGE - headerBlock.length;
  const maxEntriesInLastMessage = MAX_BLOCKS_PER_MESSAGE - pickupBlock.length - footerBlock.length;

  messages.push([...headerBlock, ...entriesBlock.slice(0, maxEntriesInFirstMessage)]);

  let rest = entriesBlock.slice(maxEntriesInFirstMessage);
  while (rest.length > maxEntriesInLastMessage) {
    messages.push(rest.slice(0, MAX_BLOCKS_PER_MESSAGE));
    rest = rest.slice(MAX_BLOCKS_PER_MESSAGE);
  }

  messages.push([...rest, ...pickupBlock, ...footerBlock]);

  return messages;
};

const notifyNippo = async (allEntries: PageObjectResponse[], labels: string[], channelId: string, pickup: PageObjectResponse | null, headerBlock: KnownBlock[]): Promise<boolean> => {
  const filteredEntries = allEntries.filter(hasTitle).filter(entry => {
    const entryLabels = getLabels(entry);
    return labels.some(label => entryLabels.includes(label));
  });

  const entriesBlock = filteredEntries.map((r) => {
    return toEntryBlock(r);
  });

  const pickupBlock = pickup ? [toEntryBlock(pickup, true)] : [];

  const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock);

  if (process.env.DEBUG === "1") {
    console.log("send to #" + channelId);
    // console.logの深いネストは[Object]に潰れてメッセージ本文が読めないため、JSONで全文出力する
    console.log(JSON.stringify(messages, null, 2));
    return true;
  }

  // 一部のメッセージ送信が失敗しても、残りのメッセージ・他チャンネルへの配信は継続する
  let succeeded = true;
  for (const blocks of messages) {
    try {
      await slack.chat.postMessage({
        text: '前営業日の日報が届きました',
        blocks,
        channel: channelId
      });
    } catch (error) {
      console.error(`Failed to send notification to channel: ${channelId}`, error);
      succeeded = false;
    }
  }
  return succeeded;
}

// DEBUGモードはSlackに投稿しないため、SLACK_BOT_API_TOKENは必須にしない
const checkRequiredEnvVars = (): void => {
  const missing: string[] = [];

  if (!process.env.NOTION_API_TOKEN) missing.push('NOTION_API_TOKEN');
  if (process.env.DEBUG !== '1' && !process.env.SLACK_BOT_API_TOKEN) missing.push('SLACK_BOT_API_TOKEN');

  if (missing.length > 0) {
    console.error(`必須環境変数が設定されていません: ${missing.join(', ')}`);
    process.exit(1);
  }
};

export const main = async () => {
  checkRequiredEnvVars();

  const today = dayjs();
  if (isWeekendOrHoliday(today)) return;

  const { url, title, propertyIds } = await getDatabaseInfo(dataSourceId);

  const previousWorkday = getPreviousWorkday(today);

  console.log("nippotion start:", JSON.stringify({
    now: today.toISOString(),
    today: today.format("YYYY-MM-DD"),
    previousWorkday: previousWorkday.format("YYYY-MM-DD"),
    query: {
      data_source_id: dataSourceId,
      filter: getDateFilter(previousWorkday, today),
    },
  }, null, 2));

  const allEntries = await getAllEntries(previousWorkday, today, propertyIds);
  console.log("entries:", JSON.stringify({ count: allEntries.length }));
  if (allEntries.length === 0) return;

  const pickup = getPickupEntry(allEntries);
  const headerBlock = createHeaderBlock(url, title);

  // 一部チャンネルへの投稿失敗があってもジョブとしては最後まで走らせ、
  // 終了時にexitCodeで失敗を報告してGitHub Actionsのissue自動作成を発火させる
  let hasFailure = false;
  for (const recipient of config.recipients) {
    const succeeded = await notifyNippo(allEntries, recipient.labels, recipient.channelId, pickup, headerBlock);
    if (!succeeded) hasFailure = true;
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
}
