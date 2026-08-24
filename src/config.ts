import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18next, { t } from './i18n.js';
import { HOLIDAY_COUNTRIES } from './workday.js';
import type { HolidayCountry } from './workday.js';

export interface Messages {
  header: string;
  pickup: string;
  unknownWriter: string;
  notificationText: string;
}

const LANGUAGES = ['ja', 'en'] as const;
export type Language = (typeof LANGUAGES)[number];

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
  // Optional because the wording differs per user (e.g. internal GHES URLs)
  footerText?: string;
  // When omitted, dates are evaluated in the process-local timezone (TZ env var)
  timezone?: string;
  // When omitted, NIPPOTION_LANG applies (en if unset).
  // Determines the default messages wording and the log/error language
  language?: Language;
  // When set, holidays of this country are treated as non-business days: delivery is
  // skipped on them and the previous-workday calculation skips them. Omitted = weekends only
  holidays?: HolidayCountry;
  // When omitted, DEFAULT_MIN_EDIT_GAP_MS applies. Entries whose last edit falls within
  // minEditGapMs of their creation are dropped from pickup candidates; 0 admits every entry
  pickup?: { minEditGapMs: number };
  messages: Messages;
}

// An entry created and delivered without a single edit in between was never written by
// hand: it is a template copy, an auto-created shell, or a post written elsewhere and
// submitted in one write. 10s clears the observed gaps of such entries by a wide margin
export const DEFAULT_MIN_EDIT_GAP_MS = 10_000;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireString = (value: unknown, keyPath: string): string => {
  if (typeof value !== 'string') {
    throw new Error(t('config.mustBeString', { keyPath, type: typeof value }));
  }
  return value;
};

const requireNumber = (value: unknown, keyPath: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(t('config.mustBeNumber', { keyPath, type: typeof value }));
  }
  return value;
};

const requireStringArray = (value: unknown, keyPath: string): string[] => {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(t('config.mustBeStringArray', { keyPath }));
  }
  return value;
};

const validateProperties = (value: unknown, keyPath: string): Config['properties'] => {
  if (!isPlainObject(value)) {
    throw new Error(t('config.mustBeObject', { keyPath }));
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
    throw new Error(t('config.mustBeObject', { keyPath }));
  }
  return {
    labels: requireStringArray(value.labels, `${keyPath}.labels`),
    channelId: requireString(value.channelId, `${keyPath}.channelId`),
  };
};

const validateRecipients = (value: unknown, keyPath: string): Config['recipients'] => {
  if (!Array.isArray(value)) {
    throw new Error(t('config.mustBeArray', { keyPath }));
  }
  return value.map((item, index) => validateRecipient(item, `${keyPath}[${index}]`));
};

const validateHolidays = (value: unknown, keyPath: string): HolidayCountry => {
  const country = requireString(value, keyPath);
  if (!(HOLIDAY_COUNTRIES as readonly string[]).includes(country)) {
    throw new Error(t('config.invalidHolidays', { keyPath, supported: HOLIDAY_COUNTRIES.join(', ') }));
  }
  return country as HolidayCountry;
};

// A negative threshold behaves exactly like 0 and a fractional millisecond has no meaning,
// so both are rejected as typos rather than silently accepted
const validatePickup = (value: unknown, keyPath: string): NonNullable<Config['pickup']> => {
  if (!isPlainObject(value)) {
    throw new Error(t('config.mustBeObject', { keyPath }));
  }

  const minEditGapMsPath = `${keyPath}.minEditGapMs`;
  const minEditGapMs = requireNumber(value.minEditGapMs, minEditGapMsPath);
  if (!Number.isInteger(minEditGapMs) || minEditGapMs < 0) {
    throw new Error(t('config.mustBeNonNegativeInteger', { keyPath: minEditGapMsPath }));
  }

  return { minEditGapMs };
};

const validateLanguage = (value: unknown, keyPath: string): Language => {
  const language = requireString(value, keyPath);
  if (!(LANGUAGES as readonly string[]).includes(language)) {
    throw new Error(t('config.invalidLanguage', { keyPath }));
  }
  return language as Language;
};

// Only the specified keys override the defaults, so users can replace just part of the wording
const validateMessages = (value: unknown, keyPath: string, language?: Language): Messages => {
  const fixedT = i18next.getFixedT(language ?? i18next.language);
  const messages: Messages = {
    header: fixedT('slack.header'),
    pickup: fixedT('slack.pickup'),
    unknownWriter: fixedT('slack.unknownWriter'),
    notificationText: fixedT('slack.notificationText'),
  };

  if (value === undefined) return messages;
  if (!isPlainObject(value)) {
    throw new Error(t('config.mustBeObject', { keyPath }));
  }

  for (const key of Object.keys(messages) as (keyof Messages)[]) {
    if (value[key] !== undefined) {
      messages[key] = requireString(value[key], `${keyPath}.${key}`);
    }
  }
  return messages;
};

const validateTimezone = (value: unknown, keyPath: string): string => {
  const tz = requireString(value, keyPath);
  // An invalid timezone name would not surface until dayjs.tz() at runtime,
  // so detect it at config load time
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    throw new Error(t('config.invalidTimezone', { keyPath, timezone: tz }));
  }
  return tz;
};

// Error messages include the offending key path so that users who only maintain
// the config file can locate the problem
export const validateConfig = (data: unknown): Config => {
  if (!isPlainObject(data)) {
    throw new Error(t('config.notObject'));
  }

  const language = data.language === undefined ? undefined : validateLanguage(data.language, 'language');

  const config: Config = {
    dataSourceId: requireString(data.dataSourceId, 'dataSourceId'),
    properties: validateProperties(data.properties, 'properties'),
    recipients: validateRecipients(data.recipients, 'recipients'),
    messages: validateMessages(data.messages, 'messages', language),
  };

  if (language !== undefined) {
    config.language = language;
  }

  if (data.holidays !== undefined) {
    config.holidays = validateHolidays(data.holidays, 'holidays');
  }

  if (data.footerText !== undefined) {
    config.footerText = requireString(data.footerText, 'footerText');
  }

  if (data.timezone !== undefined) {
    config.timezone = validateTimezone(data.timezone, 'timezone');
  }

  if (data.pickup !== undefined) {
    config.pickup = validatePickup(data.pickup, 'pickup');
  }

  return config;
};

export const loadConfig = (filePath: string): Config => {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(t('config.readFailed', { filePath, message }), { cause: error });
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(t('config.parseFailed', { filePath, message }), { cause: error });
  }

  return validateConfig(data);
};

// Resolved relative to cwd because this runs as a CLI
// (NIPPOTION_CONFIG is also the channel cli.ts uses to pass --config through)
export const resolveConfigPath = (): string =>
  resolve(process.cwd(), process.env.NIPPOTION_CONFIG ?? 'nippotion.json');
