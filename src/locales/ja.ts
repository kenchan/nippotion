export interface TranslationResource {
  cli: {
    help: string;
  };
  config: {
    notObject: string;
    mustBeString: string;
    mustBeNumber: string;
    mustBeNonNegativeInteger: string;
    mustBeStringArray: string;
    mustBeObject: string;
    mustBeArray: string;
    invalidTimezone: string;
    invalidLanguage: string;
    invalidHolidays: string;
    readFailed: string;
    parseFailed: string;
  };
  env: {
    missing: string;
  };
  notion: {
    propertyNotFound: string;
  };
  pickup: {
    skipped: string;
  };
  // Default wording for Slack posts. {database} and {writer} are placeholders replaced
  // by fillTemplate in slack.ts (same syntax as the messages config), not by i18next
  slack: {
    header: string;
    pickup: string;
    unknownWriter: string;
    notificationText: string;
  };
}

export const ja: TranslationResource = {
  cli: {
    help: `使い方: nippotion [options]

Notionの日報データベースから前営業日分を取得し、
ラベルに応じたSlackチャンネルへ配信します。

オプション:
  -c, --config <path>  設定ファイルのパス（デフォルト: ./nippotion.json）
  -d, --debug          Slackに投稿せず、投稿内容をログに出力する
  -h, --help           このヘルプを表示する

環境変数:
  NOTION_API_TOKEN     Notion IntegrationのAPIトークン（必須）
  SLACK_BOT_API_TOKEN  SlackのBot User OAuth Token（--debug時は不要）
`,
  },
  config: {
    notObject: '設定はオブジェクトである必要があります',
    mustBeString: '設定の "{{keyPath}}" は文字列である必要があります（実際の型: {{type}}）',
    mustBeNumber: '設定の "{{keyPath}}" は有限の数値である必要があります（実際の型: {{type}}）',
    mustBeNonNegativeInteger: '設定の "{{keyPath}}" は0以上の整数である必要があります',
    mustBeStringArray: '設定の "{{keyPath}}" は文字列の配列である必要があります',
    mustBeObject: '設定の "{{keyPath}}" はオブジェクトである必要があります',
    mustBeArray: '設定の "{{keyPath}}" は配列である必要があります',
    invalidTimezone: '設定の "{{keyPath}}" が不正です: "{{timezone}}" は有効なIANAタイムゾーン名ではありません（例: Asia/Tokyo）',
    invalidLanguage: '設定の "{{keyPath}}" は "ja" または "en" である必要があります',
    invalidHolidays: '設定の "{{keyPath}}" が不正です: 対応している値は {{supported}} です',
    readFailed: '設定ファイル "{{filePath}}" を読み込めませんでした: {{message}}',
    parseFailed: '設定ファイル "{{filePath}}" のJSONパースに失敗しました: {{message}}',
  },
  env: {
    missing: '必須環境変数が設定されていません: {{vars}}',
  },
  notion: {
    propertyNotFound: 'プロパティ "{{name}}" が見つかりません',
  },
  pickup: {
    skipped: 'pickup候補から除外（作成から配信まで一度も編集されていないエントリ）: {{count}}件',
  },
  slack: {
    header: '前営業日の{database}はこちら',
    pickup: '*:star:今日のピックアップ日記は {writer} さん:star:*',
    unknownWriter: '（不明）',
    notificationText: '前営業日の日報が届きました',
  },
};
