import { describe, it, expect, vi } from 'vitest';
import {
  createHeaderBlock,
  createFooterBlock,
  toEntryBlock,
  buildMessageBlocks,
  notifyNippo,
} from '../src/slack';
import type { NotifyContext } from '../src/slack';
import type { Entry } from '../src/notion';
import type { Messages } from '../src/config';
import type { WebClient, KnownBlock } from '@slack/web-api';

// The Slack layer is locale-agnostic (wording always arrives via Messages),
// so the tests use their own templates
const testMessages: Messages = {
  header: 'Entries from {database} for the previous business day',
  pickup: '*:star: Pick of the day: {writer} :star:*',
  unknownWriter: '(unknown)',
  notificationText: 'Daily reports have arrived',
};

const createEntry = (overrides: Partial<Entry> = {}): Entry => ({
  title: 'Test Diary',
  writerName: 'Taro Tanaka',
  labels: [],
  url: 'https://notion.so/test',
  editGapMs: 60_000,
  ...overrides,
});

describe('createHeaderBlock', () => {
  it('builds two blocks from the URL and title', () => {
    const url = 'https://notion.so/database';
    const title = 'Daily Notes';

    const blocks = createHeaderBlock(url, title, testMessages.header);

    expect(blocks).toHaveLength(2);
  });

  it('builds a section block containing the database link first', () => {
    const url = 'https://notion.so/database';
    const title = 'Daily Notes';

    const blocks = createHeaderBlock(url, title, testMessages.header);

    expect(blocks[0]).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Entries from <https://notion.so/database|Daily Notes> for the previous business day'
      }
    });
  });

  it('builds a divider block second', () => {
    const url = 'https://notion.so/database';
    const title = 'Daily Notes';

    const blocks = createHeaderBlock(url, title, testMessages.header);

    expect(blocks[1]).toEqual({ type: 'divider' });
  });

  it('escapes mrkdwn special characters in the title', () => {
    const blocks = createHeaderBlock('https://notion.so/database', 'A&B <Diary>', testMessages.header);

    expect(blocks[0]).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Entries from <https://notion.so/database|A&amp;B &lt;Diary&gt;> for the previous business day'
      }
    });
  });

  it('leaves unknown placeholders untouched', () => {
    const blocks = createHeaderBlock('https://notion.so/database', 'Daily Notes', '{database} and {unknown}');

    expect(blocks[0]).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '<https://notion.so/database|Daily Notes> and {unknown}'
      }
    });
  });
});

describe('createFooterBlock', () => {
  it('returns divider and context blocks when footerText is set', () => {
    const blocks = createFooterBlock('powered by nippotion');

    expect(blocks).toEqual([
      { type: 'divider' },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'powered by nippotion' }] }
    ]);
  });

  it('returns an empty array when footerText is not set', () => {
    expect(createFooterBlock(undefined)).toEqual([]);
  });
});

describe('toEntryBlock', () => {
  it('builds a section block with the writer name and title for a regular entry', () => {
    const entry = createEntry();

    const block = toEntryBlock(entry, testMessages, false);

    expect(block).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Taro Tanaka*\n<https://notion.so/test|Test Diary>'
      }
    });
  });

  it('builds a section block using the pickup template for a pickup entry', () => {
    const entry = createEntry();

    const block = toEntryBlock(entry, testMessages, true);

    expect(block).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*:star: Pick of the day: Taro Tanaka :star:*\n<https://notion.so/test|Test Diary>'
      }
    });
  });

  it('interpolates {writer} in a custom pickup template', () => {
    const entry = createEntry({ writerName: 'Alice' });
    const custom = { ...testMessages, pickup: ":tada: Today's pick is {writer}!" };

    const block = toEntryBlock(entry, custom, true);

    expect(block).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: ":tada: Today's pick is Alice!\n<https://notion.so/test|Test Diary>"
      }
    });
  });

  it('escapes mrkdwn special characters in the title and writer name', () => {
    const entry = createEntry({ title: 'A&B <Diary>', writerName: 'Taro <Tanaka>' });

    const block = toEntryBlock(entry, testMessages, false);

    expect(block).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Taro &lt;Tanaka&gt;*\n<https://notion.so/test|A&amp;B &lt;Diary&gt;>'
      }
    });
  });

  it('falls back to unknownWriter when the writer name is null', () => {
    const entry = createEntry({ writerName: null });

    const block = toEntryBlock(entry, testMessages, false);

    expect(block).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*(unknown)*\n<https://notion.so/test|Test Diary>'
      }
    });
  });

  it('reflects a customized unknownWriter in the fallback', () => {
    const entry = createEntry({ writerName: null });
    const custom = { ...testMessages, unknownWriter: 'someone' };

    const block = toEntryBlock(entry, custom, false);

    expect(block).toEqual({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*someone*\n<https://notion.so/test|Test Diary>'
      }
    });
  });
});

describe('buildMessageBlocks', () => {
  const headerBlock = createHeaderBlock('https://notion.so/database', 'Daily Notes', testMessages.header);
  const footerBlock = createFooterBlock('powered by <https://github.com/kenchan/nippotion|nippotion>');
  const pickupBlock = [toEntryBlock(createEntry({ title: 'Pickup Diary', url: 'https://notion.so/pickup' }), testMessages, true)];

  const buildEntries = (count: number) =>
    Array.from({ length: count }, (_, i) =>
      toEntryBlock(createEntry({ title: `Diary ${i}`, writerName: `User ${i}`, url: `https://notion.so/${i}` }), testMessages)
    );

  // Fixed blocks: header 2 + pickup 1 + footer 2 = 5.
  // MAX_BLOCKS_PER_MESSAGE (50) - 5 = 45 entries fit in a single message
  it('fits 45 entries into a single message', () => {
    const entriesBlock = buildEntries(45);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock, footerBlock);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveLength(50);
  });

  it('splits 46 entries into two messages', () => {
    const entriesBlock = buildEntries(46);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock, footerBlock);

    expect(messages).toHaveLength(2);
    messages.forEach(message => {
      expect(message.length).toBeLessThanOrEqual(50);
    });
  });

  it('starts the first message with the header when split', () => {
    const entriesBlock = buildEntries(46);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock, footerBlock);

    // buildMessageBlocks always returns at least one message, so the first element exists
    expect(messages[0]!.slice(0, headerBlock.length)).toEqual(headerBlock);
  });

  it('ends the last message with the pickup and footer when split', () => {
    const entriesBlock = buildEntries(46);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock, footerBlock);
    // buildMessageBlocks always returns at least one message, so the last element exists
    const lastMessage = messages[messages.length - 1]!;

    expect(lastMessage.slice(-(pickupBlock.length + footerBlock.length))).toEqual([...pickupBlock, ...footerBlock]);
  });

  it('does not repeat the header in messages after the first', () => {
    const entriesBlock = buildEntries(46);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock, footerBlock);

    for (const message of messages.slice(1)) {
      expect(message).not.toEqual(expect.arrayContaining(headerBlock));
    }
  });

  it('builds a single message even with no entries', () => {
    const messages = buildMessageBlocks(headerBlock, [], pickupBlock, footerBlock);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual([...headerBlock, ...pickupBlock, ...footerBlock]);
  });

  it('splits a large number of entries into three or more messages of at most 50 blocks', () => {
    const entriesBlock = buildEntries(120);

    const messages = buildMessageBlocks(headerBlock, entriesBlock, pickupBlock, footerBlock);

    expect(messages.length).toBeGreaterThanOrEqual(3);
    messages.forEach(message => {
      expect(message.length).toBeLessThanOrEqual(50);
    });

    // No entries are lost by splitting
    const totalEntryBlocksInMessages = messages.flat().length - headerBlock.length - pickupBlock.length - footerBlock.length;
    expect(totalEntryBlocksInMessages).toBe(120);
  });
});

describe('notifyNippo', () => {
  const headerBlock = createHeaderBlock('https://notion.so/database', 'Daily Notes', testMessages.header);
  const footerBlock = createFooterBlock('powered by nippotion');

  interface PostedMessage {
    channel: string;
    text: string;
    blocks: KnownBlock[];
  }

  const createContext = (overrides: Partial<NotifyContext> = {}) => {
    const posted: PostedMessage[] = [];
    const slack = {
      chat: {
        postMessage: async (args: PostedMessage) => {
          posted.push(args);
          return { ok: true };
        },
      },
    } as unknown as WebClient;

    const ctx: NotifyContext = {
      slack,
      entries: [],
      pickup: null,
      headerBlock,
      footerBlock,
      messages: testMessages,
      debug: false,
      ...overrides,
    };
    return { ctx, posted };
  };

  const alphaEntry = createEntry({ title: 'Alpha diary', labels: ['A'], url: 'https://notion.so/alpha' });
  const bravoEntry = createEntry({ title: 'Bravo diary', labels: ['B'], url: 'https://notion.so/bravo' });
  const charlieEntry = createEntry({ title: 'Charlie diary', labels: ['A', 'C'], url: 'https://notion.so/charlie' });

  it('delivers only the entries whose labels match the recipient', async () => {
    const { ctx, posted } = createContext({ entries: [alphaEntry, bravoEntry, charlieEntry] });

    const succeeded = await notifyNippo(ctx, { labels: ['A'], channelId: 'C1' });

    expect(succeeded).toBe(true);
    expect(posted).toHaveLength(1);
    const blocksJson = JSON.stringify(posted[0]!.blocks);
    expect(blocksJson).toContain('Alpha diary');
    expect(blocksJson).toContain('Charlie diary');
    expect(blocksJson).not.toContain('Bravo diary');
  });

  it('matches an entry when any of the recipient labels matches', async () => {
    const { ctx, posted } = createContext({ entries: [alphaEntry, bravoEntry, charlieEntry] });

    await notifyNippo(ctx, { labels: ['B', 'C'], channelId: 'C1' });

    const blocksJson = JSON.stringify(posted[0]!.blocks);
    expect(blocksJson).toContain('Bravo diary');
    expect(blocksJson).toContain('Charlie diary');
    expect(blocksJson).not.toContain('Alpha diary');
  });

  it('posts to the recipient channel with notificationText as the fallback text', async () => {
    const { ctx, posted } = createContext({ entries: [alphaEntry] });

    await notifyNippo(ctx, { labels: ['A'], channelId: 'C-ALPHA' });

    expect(posted[0]!.channel).toBe('C-ALPHA');
    expect(posted[0]!.text).toBe(testMessages.notificationText);
  });

  it('includes the shared pickup even when its labels do not match the recipient', async () => {
    const pickup = createEntry({ title: 'Pickup diary', labels: ['B'], url: 'https://notion.so/pickup' });
    const { ctx, posted } = createContext({ entries: [alphaEntry], pickup });

    await notifyNippo(ctx, { labels: ['A'], channelId: 'C1' });

    expect(JSON.stringify(posted[0]!.blocks)).toContain('Pickup diary');
  });

  it('still posts header, pickup, and footer when no entries match the recipient', async () => {
    const pickup = createEntry({ title: 'Pickup diary', labels: ['B'], url: 'https://notion.so/pickup' });
    const { ctx, posted } = createContext({ entries: [bravoEntry], pickup });

    const succeeded = await notifyNippo(ctx, { labels: ['A'], channelId: 'C1' });

    expect(succeeded).toBe(true);
    expect(posted).toHaveLength(1);
    // header 2 + pickup 1 + footer 2, with no entry blocks
    expect(posted[0]!.blocks).toHaveLength(5);
    expect(JSON.stringify(posted[0]!.blocks)).not.toContain('Bravo diary');
  });

  it('does not post and returns true in debug mode', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { ctx, posted } = createContext({ entries: [alphaEntry], debug: true });

    const succeeded = await notifyNippo(ctx, { labels: ['A'], channelId: 'C1' });

    expect(succeeded).toBe(true);
    expect(posted).toHaveLength(0);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('splits delivery into multiple messages when blocks exceed the limit', async () => {
    // 47 entries + header 2 + footer 2 = 51 blocks > 50
    const entries = Array.from({ length: 47 }, (_, i) =>
      createEntry({ title: `Diary ${i}`, labels: ['A'], url: `https://notion.so/${i}` })
    );
    const { ctx, posted } = createContext({ entries });

    const succeeded = await notifyNippo(ctx, { labels: ['A'], channelId: 'C1' });

    expect(succeeded).toBe(true);
    expect(posted).toHaveLength(2);
  });

  it('keeps posting the remaining messages and returns false when one fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const posted: PostedMessage[] = [];
    let attempts = 0;
    const slack = {
      chat: {
        postMessage: async (args: PostedMessage) => {
          attempts += 1;
          if (attempts === 1) throw new Error('boom');
          posted.push(args);
          return { ok: true };
        },
      },
    } as unknown as WebClient;
    const entries = Array.from({ length: 47 }, (_, i) =>
      createEntry({ title: `Diary ${i}`, labels: ['A'], url: `https://notion.so/${i}` })
    );
    const ctx: NotifyContext = {
      slack,
      entries,
      pickup: null,
      headerBlock,
      footerBlock,
      messages: testMessages,
      debug: false,
    };

    const succeeded = await notifyNippo(ctx, { labels: ['A'], channelId: 'C1' });

    expect(succeeded).toBe(false);
    expect(attempts).toBe(2);
    expect(posted).toHaveLength(1);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
