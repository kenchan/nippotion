import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import {
  isWeekendOrHoliday,
  getPreviousWorkday,
  getDateFilter,
  createHeaderBlock,
  toEntryBlock,
  isRetryableError,
  hasTitle,
  getPickupEntry,
  buildMessageBlocks,
  footerBlock,
} from '../main';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

// テストヘルパー: 必要最小限のエントリを生成
const createMinimalEntry = (name: string, title: string, url: string): PageObjectResponse => ({
  object: 'page',
  id: 'test-id',
  created_time: '2026-01-23T00:00:00.000Z',
  last_edited_time: '2026-01-23T00:00:00.000Z',
  created_by: { object: 'user', id: 'user-id' },
  last_edited_by: { object: 'user', id: 'user-id' },
  cover: null,
  icon: null,
  parent: { type: 'database_id', database_id: 'db-id' },
  archived: false,
  in_trash: false,
  is_archived: false,
  is_locked: false,
  url,
  public_url: null,
  properties: {
    '今日のひとこと': {
      id: 'title',
      type: 'title',
      title: title ? [{
        type: 'text',
        text: { content: title, link: null },
        annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
        plain_text: title,
        href: null
      }] : []
    },
    '書いた人': {
      id: 'created_by',
      type: 'created_by',
      created_by: { object: 'user', id: 'user-id', name }
    }
  }
});

describe('isWeekendOrHoliday', () => {
  it('土曜日をtrueと判定する', () => {
    const saturday = dayjs('2026-01-24');

    const result = isWeekendOrHoliday(saturday);

    expect(result).toBe(true);
  });

  it('日曜日をtrueと判定する', () => {
    const sunday = dayjs('2026-01-25');

    const result = isWeekendOrHoliday(sunday);

    expect(result).toBe(true);
  });

  it('金曜日をfalseと判定する', () => {
    const friday = dayjs('2026-01-23');

    const result = isWeekendOrHoliday(friday);

    expect(result).toBe(false);
  });

  it('月曜日をfalseと判定する', () => {
    const monday = dayjs('2026-01-26');

    const result = isWeekendOrHoliday(monday);

    expect(result).toBe(false);
  });

  it('祝日（元日）をtrueと判定する', () => {
    const newYearsDay = dayjs('2026-01-01');

    const result = isWeekendOrHoliday(newYearsDay);

    expect(result).toBe(true);
  });

  it('平日（火曜日）をfalseと判定する', () => {
    const tuesday = dayjs('2026-01-27');

    const result = isWeekendOrHoliday(tuesday);

    expect(result).toBe(false);
  });
});

describe('getPreviousWorkday', () => {
  it('金曜日の前営業日は木曜日を返す', () => {
    const friday = dayjs('2026-01-23');

    const result = getPreviousWorkday(friday);

    expect(result.format('YYYY-MM-DD')).toBe('2026-01-22');
  });

  it('月曜日の前営業日は金曜日を返す', () => {
    const monday = dayjs('2026-01-26');

    const result = getPreviousWorkday(monday);

    expect(result.format('YYYY-MM-DD')).toBe('2026-01-23');
  });

  it('火曜日（月曜が祝日）の前営業日は金曜日を返す', () => {
    const tuesday = dayjs('2026-01-13');

    const result = getPreviousWorkday(tuesday);

    expect(result.format('YYYY-MM-DD')).toBe('2026-01-09');
  });
});

describe('getDateFilter', () => {
  it('1日差の場合、単一日付でフィルタする', () => {
    const today = dayjs('2026-01-23');
    const previousWorkday = dayjs('2026-01-22');

    const filter = getDateFilter(previousWorkday, today);

    expect(filter).toEqual({
      property: '日付',
      date: { equals: '2026-01-22' }
    });
  });

  it('2日以上の差がある場合、日付範囲でフィルタする', () => {
    const today = dayjs('2026-01-26');
    const previousWorkday = dayjs('2026-01-23');

    const filter = getDateFilter(previousWorkday, today);

    expect(filter).toEqual({
      and: [
        {
          property: '日付',
          date: { on_or_after: '2026-01-23' }
        },
        {
          property: '日付',
          date: { on_or_before: '2026-01-25' }
        }
      ]
    });
  });
});

describe('createHeaderBlock', () => {
  it('URLとタイトルから2つのブロックを生成する', () => {
    const url = 'https://notion.so/database';
    const title = 'みんなの日記';

    const blocks = createHeaderBlock(url, title);

    expect(blocks).toHaveLength(2);
  });

  it('1つ目はURLとタイトルを含むsectionブロックである', () => {
    const url = 'https://notion.so/database';
    const title = 'みんなの日記';

    const blocks = createHeaderBlock(url, title);

    expect(blocks[0]).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '前営業日の<https://notion.so/database|みんなの日記>はこちら'
      }
    });
  });

  it('2つ目はdividerブロックである', () => {
    const url = 'https://notion.so/database';
    const title = 'みんなの日記';

    const blocks = createHeaderBlock(url, title);

    expect(blocks[1]).toEqual({ type: 'divider' });
  });
});

describe('toEntryBlock', () => {
  it('通常エントリは名前とタイトルのsectionブロックを生成する', () => {
    const entry = createMinimalEntry('田中太郎', 'テスト日記', 'https://notion.so/test');

    const block = toEntryBlock(entry, false);

    expect(block).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*田中太郎*\n<https://notion.so/test|テスト日記>'
      }
    });
  });

  it('ピックアップエントリは星マーク付きのsectionブロックを生成する', () => {
    const entry = createMinimalEntry('田中太郎', 'テスト日記', 'https://notion.so/test');

    const block = toEntryBlock(entry, true);

    expect(block).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*:star:今日のピックアップ日記は 田中太郎 さん:star:*\n<https://notion.so/test|テスト日記>'
      }
    });
  });
});

describe('isRetryableError', () => {
  it('notionhq_client_request_timeoutエラーをリトライ可能と判定する', () => {
    const error = { code: 'notionhq_client_request_timeout' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('500系エラーをリトライ可能と判定する', () => {
    const error = { code: 'notionhq_client_response_error', status: 500 };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('502系エラーをリトライ可能と判定する', () => {
    const error = { code: 'notionhq_client_response_error', status: 502 };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('503系エラーをリトライ可能と判定する', () => {
    const error = { code: 'notionhq_client_response_error', status: 503 };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('ECONNRESETエラーをリトライ可能と判定する', () => {
    const error = { code: 'ECONNRESET' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('ETIMEDOUTエラーをリトライ可能と判定する', () => {
    const error = { code: 'ETIMEDOUT' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('ENOTFOUNDエラーをリトライ可能と判定する', () => {
    const error = { code: 'ENOTFOUND' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('400系エラーをリトライ不可と判定する', () => {
    const error = { code: 'notionhq_client_response_error', status: 400 };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('401系エラーをリトライ不可と判定する', () => {
    const error = { code: 'notionhq_client_response_error', status: 401 };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('404系エラーをリトライ不可と判定する', () => {
    const error = { code: 'notionhq_client_response_error', status: 404 };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('未知のエラーコードをリトライ不可と判定する', () => {
    const error = { code: 'unknown_error' };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('p-retryがerrorプロパティにラップした504エラーをリトライ可能と判定する', () => {
    const error = {
      error: {
        name: 'UnknownHTTPResponseError',
        code: 'notionhq_client_response_error',
        status: 504,
      },
      attemptNumber: 1,
      retriesLeft: 3,
    };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('p-retryがerrorプロパティにラップした502エラーをリトライ可能と判定する', () => {
    const error = {
      error: {
        name: 'UnknownHTTPResponseError',
        code: 'notionhq_client_response_error',
        status: 502,
      },
      attemptNumber: 1,
      retriesLeft: 3,
    };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('p-retryがerrorプロパティにラップした400エラーをリトライ不可と判定する', () => {
    const error = {
      error: {
        name: 'APIResponseError',
        code: 'notionhq_client_response_error',
        status: 400,
      },
      attemptNumber: 1,
      retriesLeft: 3,
    };

    const result = isRetryableError(error);

    expect(result).toBe(false);
  });

  it('429エラーをリトライ可能と判定する', () => {
    const error = { code: 'notionhq_client_response_error', status: 429 };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('rate_limitedコードをリトライ可能と判定する', () => {
    const error = { code: 'rate_limited' };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });

  it('p-retryがerrorプロパティにラップした429エラーをリトライ可能と判定する', () => {
    const error = {
      error: {
        name: 'RateLimitedError',
        code: 'rate_limited',
        status: 429,
      },
      attemptNumber: 1,
      retriesLeft: 3,
    };

    const result = isRetryableError(error);

    expect(result).toBe(true);
  });
});

describe('hasTitle', () => {
  it('タイトルがあるエントリをtrueと判定する', () => {
    const entry = createMinimalEntry('田中太郎', 'テスト日記', 'https://notion.so/test');

    expect(hasTitle(entry)).toBe(true);
  });

  it('タイトルが空のエントリをfalseと判定する', () => {
    const entry = createMinimalEntry('田中太郎', '', 'https://notion.so/test');

    expect(hasTitle(entry)).toBe(false);
  });
});

describe('getPickupEntry', () => {
  it('タイトルが空のエントリはピックアップ候補から除外する', () => {
    const entries = [
      createMinimalEntry('田中太郎', '', 'https://notion.so/empty'),
    ];

    const result = getPickupEntry(entries);

    expect(result).toBeNull();
  });

  it('タイトルがあるエントリのみをピックアップ候補にする', () => {
    const entries = [
      createMinimalEntry('田中太郎', '', 'https://notion.so/empty'),
      createMinimalEntry('鈴木一郎', 'テスト日記', 'https://notion.so/test'),
    ];

    const result = getPickupEntry(entries);

    expect(result?.url).toBe('https://notion.so/test');
  });
});

describe('buildMessageBlocks', () => {
  const headerBlock = createHeaderBlock('https://notion.so/database', 'みんなの日記');
  const pickupEntry = createMinimalEntry('田中太郎', 'ピックアップ日記', 'https://notion.so/pickup');
  const pickupBlock = [toEntryBlock(pickupEntry, true)];

  const buildEntries = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      toEntryBlock(createMinimalEntry(`ユーザー${i}`, `日記${i}`, `https://notion.so/${i}`))
    );

  // 固定ブロック数: ヘッダー2 + ピックアップ1 + フッター2 = 5
  // MAX_BLOCKS_PER_MESSAGE(50) - 5 = 45件が1メッセージに収まる上限
  it('45件のエントリは1メッセージに収まる', () => {
    const entriesBlock = buildEntries(45);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveLength(50);
  });

  it('46件のエントリは2メッセージに分割される', () => {
    const entriesBlock = buildEntries(46);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock);

    expect(messages).toHaveLength(2);
    messages.forEach(message => {
      expect(message.length).toBeLessThanOrEqual(50);
    });
  });

  it('分割時、最初のメッセージはヘッダーで始まる', () => {
    const entriesBlock = buildEntries(46);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock);

    // buildMessageBlocksは常に1件以上のメッセージを返すため、先頭要素は必ず存在する
    expect(messages[0]!.slice(0, headerBlock.length)).toEqual(headerBlock);
  });

  it('分割時、最後のメッセージはピックアップとフッターで終わる', () => {
    const entriesBlock = buildEntries(46);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock);
    // buildMessageBlocksは常に1件以上のメッセージを返すため、最後の要素は必ず存在する
    const lastMessage = messages[messages.length - 1]!;

    expect(lastMessage.slice(-(pickupBlock.length + footerBlock.length))).toEqual([...pickupBlock, ...footerBlock]);
  });

  it('分割時、ヘッダー以外のメッセージにはヘッダーが含まれない', () => {
    const entriesBlock = buildEntries(46);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock);

    for (const message of messages.slice(1)) {
      expect(message).not.toEqual(expect.arrayContaining(headerBlock));
    }
  });

  it('エントリが全く無くても1メッセージとして生成できる', () => {
    const messages = buildMessageBlocks(headerBlock, [], pickupBlock);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual([...headerBlock, ...pickupBlock, ...footerBlock]);
  });

  it('大量のエントリは3メッセージ以上に分割され、すべて50 blocks以下になる', () => {
    const entriesBlock = buildEntries(120);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock);

    expect(messages.length).toBeGreaterThanOrEqual(3);
    messages.forEach(message => {
      expect(message.length).toBeLessThanOrEqual(50);
    });

    // 分割してもエントリ自体は失われない
    const totalEntryBlocksInMessages = messages.flat().length - headerBlock.length - pickupBlock.length - footerBlock.length;
    expect(totalEntryBlocksInMessages).toBe(120);
  });
});
