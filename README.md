# nippotion

A CLI tool that delivers daily reports (diary entries) written in a Notion database to Slack channels based on their labels, every morning. Runs with **`npx nippotion` and a single config file**.

- Delivers **the previous business day's** entries on weekday mornings (weekends are skipped; set `"holidays": "jp"` to also skip Japanese holidays via [@holiday-jp/holiday_jp](https://github.com/holiday-jp/holiday_jp). Monday delivers entries dated Friday through Sunday)
- Routes entries to multiple Slack channels based on their labels (multi-select)
- Randomly picks one entry each time to feature as the "pickup" entry (shared by every channel, even ones whose labels don't match it). Unfilled template copies — entries still titled after a template that nobody edited between creation and delivery — are left out of the draw (`pickup.templateCopyMinEditGapMs`)
- Timezone, holiday skipping, language (Japanese/English), and Slack message wording are all configurable (works for non-Japan offices and English-speaking workspaces too)

```bash
npx nippotion --config nippotion.json
```

Run it on a schedule with GitHub Actions, cron, or any Node-capable CI (a GitHub Actions example is below).

## Requirements

### Notion database

The database you write daily reports into needs these four properties (names are configurable):

| Property | Type | Purpose |
|---|---|---|
| One-liner | Title | The entry's title. Posted to Slack as a link |
| Date | Date | Used to determine which entries to deliver |
| Team | Multi-select | Used to route entries to the right channel |
| Author | Created by | Used to display the writer's name |

> [!NOTE]
> The date property should hold **a date only, with no time component**. If a time is present, it may not match Notion's date filter and the entry could be skipped.

### Notion integration

1. Create an integration at [My integrations](https://www.notion.so/my-integrations) and note its API token
2. Under the integration's capabilities, **enable "Read user information"** (no email address needed). Without it, the writer's name can't be retrieved and shows as "(unknown)"
3. Share (connect) the target database with the integration
4. Note the database's **data source ID**

### Slack app

1. Create an app at [Slack API](https://api.slack.com/apps), add the `chat:write` Bot Token Scope, and install it to your workspace
2. Note the Bot User OAuth Token (starts with `xoxb-`)
3. **Invite the bot user to every channel you deliver to** (it can't post to channels it hasn't been invited to)

## Usage

### CLI

```bash
# Debug run (logs the message content instead of posting to Slack)
NOTION_API_TOKEN=xxx npx nippotion --debug

# Production run
NOTION_API_TOKEN=xxx SLACK_BOT_API_TOKEN=xoxb-xxx npx nippotion
```

| Option | Description |
|---|---|
| `-c, --config <path>` | Path to the config file (default: `nippotion.json` in the current directory) |
| `-d, --debug` | Log the message content instead of posting to Slack |
| `-h, --help` | Show help |

| Environment variable | Description |
|---|---|
| `NOTION_API_TOKEN` | Notion integration API token (required) |
| `SLACK_BOT_API_TOKEN` | Slack Bot User OAuth Token (not needed with `--debug`) |
| `NIPPOTION_CONFIG` | Path to the config file (same as `--config`; the flag takes precedence) |
| `NIPPOTION_DEBUG` | Set to `1` for debug mode (same as `--debug`) |
| `NIPPOTION_LANG` | Language for CLI help, log/error messages, and the default Slack message wording (`ja` / `en`, default: `en`). The config's `language` takes precedence if set |
| `TZ` | Fallback timezone for date evaluation. Prefer setting `timezone` in the config file |

### Scheduled runs with GitHub Actions

Place `nippotion.json` and the following workflow ([examples/notify.yml](./examples/notify.yml)) in your repository, and register `NOTION_API_TOKEN` / `SLACK_BOT_API_TOKEN` as secrets:

```yaml
name: nippotion
on:
  schedule:
    - cron: '30 0 * * *'  # 9:30 JST
  workflow_dispatch:
    inputs:
      debug_mode:
        description: 'Debug mode (does not post to Slack)'
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
      - run: npx nippotion@0 ${{ github.event.inputs.debug_mode == 'true' && '--debug' || '' }}
        env:
          NOTION_API_TOKEN: ${{ secrets.NOTION_API_TOKEN }}
          SLACK_BOT_API_TOKEN: ${{ secrets.SLACK_BOT_API_TOKEN }}
```

To verify it works, trigger it manually from the Actions tab with `debug_mode: true`.

## Config reference (nippotion.json)

```json
{
  "dataSourceId": "The Notion database's data source ID",
  "timezone": "America/New_York",
  "language": "en",
  "holidays": "jp",
  "pickup": {
    "templateCopyMinEditGapMs": 10000
  },
  "properties": {
    "title": "Name of the title property",
    "labels": "Name of the multi-select property",
    "author": "Name of the created-by property",
    "date": "Name of the date property"
  },
  "footerText": "Text appended to the end of the message (Slack mrkdwn, optional)",
  "messages": {
    "header": "Here are the entries from {database} for the previous business day",
    "pickup": "*:star: Today's pick goes to {writer}! :star:*",
    "unknownWriter": "(unknown)",
    "notificationText": "Daily reports have arrived"
  },
  "recipients": [
    {
      "labels": ["Entries with any of these labels"],
      "channelId": "are delivered to this channel ID"
    }
  ]
}
```

- `channelId` can be found at the end of the Slack channel's link URL, or from the channel details
- Listing the same label in multiple recipients delivers it to multiple channels
- As long as at least one entry exists for the day, every recipient channel receives a message — a channel whose labels match no entries still gets the header, pickup, and footer (delivery is skipped entirely only when there are no entries at all)
- `timezone` is the IANA timezone name used to evaluate business days and "the previous business day" (defaults to the runtime's local timezone if omitted)
- `language` sets the default Slack message wording and the log/error message language (`ja` / `en`; **defaults to `NIPPOTION_LANG`, or `en` if neither is set**). Set `"language": "ja"` to use it in Japanese
- Setting `holidays` to a country code also excludes that country's holidays from business days (**weekends only if omitted**; currently only `jp` — Japanese holidays — is supported). Non-business days are not delivered, and are also skipped when computing "the previous business day" (entries from a holiday arrive together on the next business day)
- `messages` lets you override individual pieces of Slack wording. All fields are optional (defaults follow `language`). `{database}` is replaced with a link to the database, and `{writer}` with the entry's author name
- `pickup.templateCopyMinEditGapMs` drops an entry from the **pickup candidates** when **both** of the following hold (default: `10000`, i.e. 10 seconds). Such entries are still delivered to their channels as usual — only the "today's pick" draw skips them. Set `0` to disable the rule and keep every entry as a candidate
  1. the entry's title matches one of the data source's **template names** exactly, and
  2. the gap between its `created_time` and its `last_edited_time` is **below** this value — that is, nobody edited it between creation and delivery
- Neither condition alone is usable: plenty of people leave the title as their template's name and still write a full report, and plenty of reports are composed elsewhere and submitted in a single write. Requiring both is what keeps those two groups in the draw
- Every run logs the entries it skipped (URL, title, and the measured gap), so you can check what the setting is actually doing
- **Known limits.** Please read these before turning the threshold up:
  - A writer who keeps their template's name as the title **and** submits in one write is skipped. In the 3-day sample this rule was built from, that was 2 writers across 4 entries, one of whom was affected on every day of the sample
  - A template copy whose title is not in the template list — because the template was renamed, or created after the run started — is **not** skipped
  - If the template list cannot be fetched, **nothing is skipped**. Listing templates requires the data source to be shared with your integration, and the endpoint is documented against a newer `Notion-Version` than the Notion SDK sends by default. Rather than guess, nippotion logs the reason and leaves every entry in the draw
- Notion is not documented to guarantee sub-second precision on these timestamps. Where it reports them at minute granularity the gap lands on multiples of 60000, and any threshold below a minute behaves as "created and last edited within the same minute" — the same intent, so no configuration change is needed

### Example: Japanese setup

For a Japanese-language Notion database and Slack workspace, set `language` to `"ja"` and use Japanese property names:

```json
{
  "dataSourceId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "timezone": "Asia/Tokyo",
  "language": "ja",
  "holidays": "jp",
  "properties": {
    "title": "今日のひとこと",
    "labels": "所属",
    "author": "書いた人",
    "date": "日付"
  },
  "footerText": "powered by <https://github.com/kenchan/nippotion|nippotion>",
  "recipients": [
    {
      "labels": ["チームA"],
      "channelId": "C0123456789"
    },
    {
      "labels": ["チームB", "チームC"],
      "channelId": "C9876543210"
    }
  ]
}
```

With `"language": "ja"`, the default `messages` wording is Japanese too, so it can be omitted here.

## Development

```bash
npm ci
npm start -- --debug   # run from source with tsx
npm run typecheck      # type check
npm run lint           # ESLint
npm test               # tests
npm run build          # build dist/ with tsup
```

## License

[MIT](./LICENSE)
