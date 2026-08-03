import type { WebClient, KnownBlock } from '@slack/web-api';
import type { Config, Messages } from './config.js';
import type { Entry } from './notion.js';

// In Slack mrkdwn, & < > are special characters. Free-form input like titles inside
// <url|label> would break the link syntax, so always pass display strings through this
export const escapeMrkdwn = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

// Wording is replaceable via the messages config, so interpolate {name}-style placeholders.
// Unknown placeholders are left as-is so that typos remain visible
export const fillTemplate = (template: string, vars: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);

export const createHeaderBlock = (databaseUrl: string, databaseTitle: string, headerTemplate: string): KnownBlock[] => [
  {
    type: "section",
    text: {
      type: "mrkdwn",
      text: fillTemplate(headerTemplate, { database: `<${databaseUrl}|${escapeMrkdwn(databaseTitle)}>` })
    },
  },
  {
    type: "divider"
  }
];

// footerText is optional because its wording differs per user (no forced internal URLs);
// an empty array keeps it out of buildMessageBlocks' block-count math.
// It is meant to contain user-authored mrkdwn (links etc.), so it is not escaped
export const createFooterBlock = (footerText?: string): KnownBlock[] =>
  footerText
    ? [
      {
        type: "divider"
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: footerText
          }
        ]
      }
    ]
    : [];

export const toEntryBlock = (entry: Entry, messages: Messages, pickup = false): KnownBlock => {
  const title = escapeMrkdwn(entry.title);
  // The name is unavailable when the integration lacks the user-information capability,
  // so fall back for display only
  const writerName = escapeMrkdwn(entry.writerName ?? messages.unknownWriter);
  if (pickup) {
    return {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${fillTemplate(messages.pickup, { writer: writerName })}\n<${entry.url}|${title}>`
      }
    };
  }
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*${writerName}*\n<${entry.url}|${title}>`
    }
  };
}

const MAX_BLOCKS_PER_MESSAGE = 50; // Slack chat.postMessage blocks limit

// With many entries, header+entries+pickup+footer exceeds 50 blocks; only then split,
// pinning the header to the first message and pickup+footer to the last
export const buildMessageBlocks = (headerBlock: KnownBlock[], entriesBlock: KnownBlock[], pickupBlock: KnownBlock[], footerBlock: KnownBlock[]): KnownBlock[][] => {
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

export interface NotifyContext {
  slack: WebClient;
  entries: Entry[];
  pickup: Entry | null;
  headerBlock: KnownBlock[];
  footerBlock: KnownBlock[];
  messages: Messages;
  debug: boolean;
}

export const notifyNippo = async (ctx: NotifyContext, recipient: Config['recipients'][number]): Promise<boolean> => {
  const filteredEntries = ctx.entries.filter(entry =>
    recipient.labels.some(label => entry.labels.includes(label))
  );

  const entriesBlock = filteredEntries.map(entry => toEntryBlock(entry, ctx.messages));

  const pickupBlock = ctx.pickup ? [toEntryBlock(ctx.pickup, ctx.messages, true)] : [];

  const messages = buildMessageBlocks(ctx.headerBlock, entriesBlock, pickupBlock, ctx.footerBlock);

  if (ctx.debug) {
    console.log("send to #" + recipient.channelId);
    // Deeply nested console.log collapses to [Object], hiding the message body,
    // so print the full JSON
    console.log(JSON.stringify(messages, null, 2));
    return true;
  }

  // Even if sending one message fails, keep delivering the remaining messages and channels
  let succeeded = true;
  for (const blocks of messages) {
    try {
      await ctx.slack.chat.postMessage({
        text: ctx.messages.notificationText,
        blocks,
        channel: recipient.channelId
      });
    } catch (error) {
      console.error(`Failed to send notification to channel: ${recipient.channelId}`, error);
      succeeded = false;
    }
  }
  return succeeded;
}
