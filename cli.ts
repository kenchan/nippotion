import { parseArgs } from 'node:util';

const HELP = `使い方: nippotion [options]

Notionの日報データベースから前営業日分を取得し、
ラベルに応じたSlackチャンネルへ配信します。

オプション:
  -c, --config <path>  設定ファイルのパス（デフォルト: ./nippotion.json）
  -d, --debug          Slackに投稿せず、投稿内容をログに出力する
  -h, --help           このヘルプを表示する

環境変数:
  NOTION_API_TOKEN     Notion IntegrationのAPIトークン（必須）
  SLACK_BOT_API_TOKEN  SlackのBot User OAuth Token（--debug時は不要）
`;

let values: { config?: string; debug?: boolean; help?: boolean };
try {
  ({ values } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      debug: { type: 'boolean', short: 'd', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  }));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(HELP);
  process.exit(1);
}

if (values.help) {
  console.log(HELP);
  process.exit(0);
}

// mainモジュールは読み込み時に設定ファイルを解決するため、importより先に環境変数へ反映する
if (values.config) process.env.NIPPOTION_CONFIG = values.config;
if (values.debug) process.env.DEBUG = '1';

const { main } = await import('./main.js');
await main();
