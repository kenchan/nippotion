import type { TranslationResource } from './ja.js';

export const en: TranslationResource = {
  cli: {
    help: `Usage: nippotion [options]

Fetches entries for the previous business day from a Notion database
and delivers them to Slack channels based on their labels.

Options:
  -c, --config <path>  Path to the config file (default: ./nippotion.json)
  -d, --debug          Log the messages instead of posting to Slack
  -h, --help           Show this help

Environment variables:
  NOTION_API_TOKEN     Notion Integration API token (required)
  SLACK_BOT_API_TOKEN  Slack Bot User OAuth Token (not needed with --debug)
`,
  },
  config: {
    notObject: 'Config must be an object',
    mustBeString: 'Config "{{keyPath}}" must be a string (got: {{type}})',
    mustBeNumber: 'Config "{{keyPath}}" must be a finite number (got: {{type}})',
    mustBeNonNegativeInteger: 'Config "{{keyPath}}" must be an integer of 0 or greater',
    mustBeStringArray: 'Config "{{keyPath}}" must be an array of strings',
    mustBeObject: 'Config "{{keyPath}}" must be an object',
    mustBeArray: 'Config "{{keyPath}}" must be an array',
    invalidTimezone: 'Config "{{keyPath}}" is invalid: "{{timezone}}" is not a valid IANA timezone name (e.g. Asia/Tokyo)',
    invalidLanguage: 'Config "{{keyPath}}" must be "ja" or "en"',
    invalidHolidays: 'Config "{{keyPath}}" is invalid: supported values are {{supported}}',
    readFailed: 'Failed to read config file "{{filePath}}": {{message}}',
    parseFailed: 'Failed to parse config file "{{filePath}}" as JSON: {{message}}',
  },
  env: {
    missing: 'Required environment variables are not set: {{vars}}',
  },
  notion: {
    propertyNotFound: 'Property "{{name}}" was not found in the data source',
    templateListFailed: 'Could not list the data source templates, so no entry is skipped from the pickup candidates: {{message}}',
  },
  pickup: {
    skipped: 'Skipped from pickup candidates (still titled after a template, never edited between creation and delivery): {{count}}',
  },
  slack: {
    header: 'Here are the entries from {database} for the previous business day',
    pickup: "*:star: Today's pick goes to {writer}! :star:*",
    unknownWriter: '(unknown)',
    notificationText: 'Daily reports have arrived',
  },
};
