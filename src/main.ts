import { Client } from '@notionhq/client';
import { WebClient } from '@slack/web-api';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import i18next, { t } from './i18n.js';
import { loadConfig, resolveConfigPath, DEFAULT_TEMPLATE_COPY_MIN_EDIT_GAP_MS } from './config.js';
import type { Config } from './config.js';
import { isWeekendOrHoliday, getPreviousWorkday } from './workday.js';
import { getDatabaseInfo, getAllPages, getDateFilter, toEntry, isPickupCandidate, fetchTemplateNames } from './notion.js';
import type { Entry } from './notion.js';
import { createHeaderBlock, createFooterBlock, notifyNippo } from './slack.js';
import type { NotifyContext } from './slack.js';

dayjs.extend(utc);
dayjs.extend(timezone);

// Debug mode does not post to Slack, so SLACK_BOT_API_TOKEN is not required there
const checkRequiredEnvVars = (debug: boolean): void => {
  const missing: string[] = [];

  if (!process.env.NOTION_API_TOKEN) missing.push('NOTION_API_TOKEN');
  if (!debug && !process.env.SLACK_BOT_API_TOKEN) missing.push('SLACK_BOT_API_TOKEN');

  if (missing.length > 0) {
    console.error(t('env.missing', { vars: missing.join(', ') }));
    process.exit(1);
  }
};

// rng is a parameter rather than a direct Math.random call so that the choice
// can be pinned in tests
export const selectPickup = (entries: Entry[], templateNames: Set<string>, minEditGapMs: number, rng: () => number = Math.random): Entry | null => {
  const candidates = entries.filter(entry => isPickupCandidate(entry, templateNames, minEditGapMs));
  // An empty candidates list indexes to undefined, which is exactly the "no pickup" case.
  // noUncheckedIndexedAccess types the access as possibly undefined either way
  return candidates[Math.floor(rng() * candidates.length)] ?? null;
};

export const main = async () => {
  const debug = process.env.NIPPOTION_DEBUG === '1';
  checkRequiredEnvVars(debug);

  let config: Config;
  try {
    config = loadConfig(resolveConfigPath());
  } catch (error) {
    // Config mistakes are for the user to fix; show only the message, not a stack trace
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Align logs and errors after this point with the configured language
  if (config.language) await i18next.changeLanguage(config.language);

  const today = config.timezone ? dayjs().tz(config.timezone) : dayjs();
  if (isWeekendOrHoliday(today, config.holidays)) return;

  const client = new Client({
    auth: process.env.NOTION_API_TOKEN,
    timeoutMs: 120000, // extended from the 60s default
  });
  const slack = new WebClient(process.env.SLACK_BOT_API_TOKEN);

  // Property names for filter_properties resolution are derived from the config so that
  // real Notion property names live in one place (nippotion.json).
  // date is used only in the filter and not needed in responses, so it is excluded
  const requiredProperties = [config.properties.labels, config.properties.title, config.properties.author];
  const { url, title, propertyIds } = await getDatabaseInfo(client, config.dataSourceId, requiredProperties);

  const previousWorkday = getPreviousWorkday(today, config.holidays);
  const filter = getDateFilter(previousWorkday, today, config.properties.date);

  console.log("nippotion start:", JSON.stringify({
    now: today.toISOString(),
    timezone: config.timezone ?? null,
    today: today.format("YYYY-MM-DD"),
    previousWorkday: previousWorkday.format("YYYY-MM-DD"),
    query: {
      data_source_id: config.dataSourceId,
      filter,
    },
  }, null, 2));

  const pages = await getAllPages(client, config.dataSourceId, filter, propertyIds);
  const entries = pages.map(page => toEntry(page, config.properties)).filter(entry => entry !== null);
  console.log("entries:", JSON.stringify({ pages: pages.length, entries: entries.length }));
  if (entries.length === 0) return;

  const minEditGapMs = config.pickup?.templateCopyMinEditGapMs ?? DEFAULT_TEMPLATE_COPY_MIN_EDIT_GAP_MS;
  // Fetched only once there is something to pick from, so a day with no entries costs nothing
  const templateNames = await fetchTemplateNames(client, config.dataSourceId);
  const skipped = entries.filter(entry => !isPickupCandidate(entry, templateNames, minEditGapMs));
  // Logged outside debug mode too: a writer who is never picked up has no other way to
  // find out why, since Notion's UI does not expose the gap this decision is made on
  if (skipped.length > 0) {
    console.log(t('pickup.skipped', { count: skipped.length }), JSON.stringify(
      skipped.map(({ url, title, editGapMs }) => ({ url, title, editGapMs })),
      null,
      2,
    ));
  }

  const pickup = selectPickup(entries, templateNames, minEditGapMs);

  const ctx: NotifyContext = {
    slack,
    entries,
    pickup,
    headerBlock: createHeaderBlock(url, title, config.messages.header),
    footerBlock: createFooterBlock(config.footerText),
    messages: config.messages,
    debug,
  };

  // Even if posting to some channels fails, run the job to completion and report
  // the failure via exitCode to trigger GitHub Actions' automatic issue creation
  let hasFailure = false;
  for (const recipient of config.recipients) {
    const succeeded = await notifyNippo(ctx, recipient);
    if (!succeeded) hasFailure = true;
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
}
