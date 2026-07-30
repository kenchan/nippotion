# nippotion（にっぽーしょん）

Notionのデータベースに書かれた日報（日記）を、ラベルに応じたSlackチャンネルへ毎朝自動配信するCLIツールです。**`npx nippotion` と設定ファイル1枚**で動きます。

- 平日の朝に**前営業日**の日報を配信します（土日と日本の祝日は[@holiday-jp/holiday_jp](https://github.com/holiday-jp/holiday_jp)でスキップ。月曜には金曜の日報が届きます）
- 日報につけられたラベル（マルチセレクト）に応じて、複数のSlackチャンネルへ振り分けます
- 毎回ランダムに1件を「ピックアップ日報」として紹介します

```bash
npx nippotion --config nippotion.json
```

スケジュール実行はGitHub Actions・cron・各種CIなど、Nodeが動く好きな環境に載せてください（GitHub Actionsの例は後述）。

## 必要なもの

### Notionデータベース

日報を書き込むデータベースに、以下の4つのプロパティが必要です（名前は設定で変更可能）：

| プロパティ | 種類 | 用途 |
|---|---|---|
| 今日のひとこと | タイトル | 日報のタイトル。Slackにはこれがリンクとして流れます |
| 日付 | 日付 | 配信対象日の判定に使います |
| 所属 | マルチセレクト | 配信先チャンネルの振り分けに使います |
| 書いた人 | 作成者 | 書いた人の名前の表示に使います |

### Notion Integration

1. [My integrations](https://www.notion.so/my-integrations)でIntegrationを作成し、APIトークンを控えます
2. 対象データベースをIntegrationに共有（コネクト）します
3. データベースの**データソースID**を控えます

### Slack App

1. [Slack API](https://api.slack.com/apps)でAppを作成し、Bot Token Scopeに `chat:write` を追加してワークスペースにインストールします
2. Bot User OAuth Token（`xoxb-`で始まる）を控えます
3. **配信先の各チャンネルにbotユーザーを招待**します（招待されていないチャンネルには投稿できません）

## 使い方

### CLI

```bash
# デバッグ実行（Slackに投稿せず、投稿内容をログに出力）
NOTION_API_TOKEN=xxx npx nippotion --debug

# 本番実行
NOTION_API_TOKEN=xxx SLACK_BOT_API_TOKEN=xoxb-xxx npx nippotion
```

| オプション | 説明 |
|---|---|
| `-c, --config <path>` | 設定ファイルのパス（デフォルト: カレントディレクトリの `nippotion.json`） |
| `-d, --debug` | Slackに投稿せず、投稿内容をログに出力する |
| `-h, --help` | ヘルプを表示する |

| 環境変数 | 説明 |
|---|---|
| `NOTION_API_TOKEN` | Notion IntegrationのAPIトークン（必須） |
| `SLACK_BOT_API_TOKEN` | SlackのBot User OAuth Token（`--debug`時は不要） |
| `NIPPOTION_CONFIG` | 設定ファイルのパス（`--config`と同じ。オプションが優先） |
| `TZ` | 営業日判定に使うタイムゾーン。`Asia/Tokyo` を推奨 |

### GitHub Actionsでの定期実行

リポジトリに `nippotion.json` と以下のworkflow（[examples/notify.yml](./examples/notify.yml)）を置き、Secretsに `NOTION_API_TOKEN` / `SLACK_BOT_API_TOKEN` を登録します：

```yaml
name: nippotion
on:
  schedule:
    - cron: '30 0 * * *'  # 9:30 JST
  workflow_dispatch:
    inputs:
      debug_mode:
        description: 'デバッグモード (Slackに投稿しない)'
        type: boolean
        default: false
jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
      - run: npx nippotion@1 ${{ github.event.inputs.debug_mode == 'true' && '--debug' || '' }}
        env:
          TZ: 'Asia/Tokyo'
          NOTION_API_TOKEN: ${{ secrets.NOTION_API_TOKEN }}
          SLACK_BOT_API_TOKEN: ${{ secrets.SLACK_BOT_API_TOKEN }}
```

動作確認は、Actionsタブから `debug_mode: true` で手動実行してください。

## 設定リファレンス（nippotion.json）

```json
{
  "dataSourceId": "NotionデータベースのデータソースID",
  "properties": {
    "title": "タイトルプロパティの名前",
    "labels": "マルチセレクトプロパティの名前",
    "author": "作成者プロパティの名前",
    "date": "日付プロパティの名前"
  },
  "footerText": "メッセージ末尾に添える文言（Slack mrkdwn、省略可）",
  "recipients": [
    {
      "labels": ["このラベルのいずれかが付いた日報を"],
      "channelId": "このチャンネルIDに配信します"
    }
  ]
}
```

- `channelId` はSlackチャンネルのリンクURLの末尾、またはチャンネル詳細から確認できます
- 同じラベルを複数のrecipientsに書けば、複数チャンネルへ配信されます

## 開発

```bash
npm ci
npm start -- --debug   # tsxでソースから実行
npm run typecheck      # 型チェック
npm run lint           # ESLint
npm test               # テスト
npm run build          # tsupでdist/をビルド
```

## License

[MIT](./LICENSE)
