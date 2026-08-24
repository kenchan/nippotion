import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Entry } from '../src/notion';

const { postMessage, getDatabaseInfo, getAllPages, toEntry, fetchTemplateNames } = vi.hoisted(() => ({
  postMessage: vi.fn(),
  getDatabaseInfo: vi.fn(),
  getAllPages: vi.fn(),
  toEntry: vi.fn(),
  fetchTemplateNames: vi.fn(),
}));

// Replace only the network boundaries (Slack client and Notion accessors);
// the date-filter logic and everything else stays real
vi.mock('@slack/web-api', () => ({
  WebClient: class {
    chat = { postMessage };
  },
}));

vi.mock('../src/notion.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/notion.js')>();
  return { ...actual, getDatabaseInfo, getAllPages, toEntry, fetchTemplateNames };
});

import { main, selectPickup } from '../src/main';

const testEntry: Entry = {
  title: 'Test Diary',
  writerName: 'Taro Tanaka',
  labels: ['A', 'B'],
  url: 'https://notion.so/test',
  editGapMs: 60_000,
};

const entryWithGap = (gap: number, overrides: Partial<Entry> = {}): Entry =>
  ({ ...testEntry, editGapMs: gap, ...overrides });

describe('selectPickup', () => {
  // Always draws the first candidate, so the filtering is what the assertions observe
  const firstRng = () => 0;
  const templateNames = new Set(['Test Diary']);

  it('returns null when there are no entries at all', () => {
    expect(selectPickup([], templateNames, 10_000, firstRng)).toBeNull();
  });

  it('returns null when every entry is an unedited template copy', () => {
    const entries = [entryWithGap(0), entryWithGap(9_999)];

    expect(selectPickup(entries, templateNames, 10_000, firstRng)).toBeNull();
  });

  it('keeps every entry when the template name set is empty', () => {
    const entries = [entryWithGap(0), entryWithGap(9_999)];

    expect(selectPickup(entries, new Set(), 10_000, firstRng)).not.toBeNull();
  });

  it('keeps an entry titled after a template that its writer went on to edit', () => {
    expect(selectPickup([entryWithGap(60_000)], templateNames, 10_000, firstRng)).not.toBeNull();
  });

  it('keeps an unedited entry whose title is not a template name', () => {
    const written = entryWithGap(122, { title: 'Shipped the mail API fix' });

    expect(selectPickup([written], templateNames, 10_000, firstRng)?.title).toBe('Shipped the mail API fix');
  });

  it('drops only the unedited template copy and picks from the rest', () => {
    const copy = entryWithGap(0);
    const written = entryWithGap(122, { title: 'Shipped the mail API fix' });

    expect(selectPickup([copy, written], templateNames, 10_000, firstRng)?.title).toBe('Shipped the mail API fix');
  });

  it('picks across all candidates rather than always the first', () => {
    const first = entryWithGap(60_000, { title: 'First' });
    const second = entryWithGap(60_000, { title: 'Second' });

    expect(selectPickup([first, second], templateNames, 10_000, () => 0.99)?.title).toBe('Second');
  });

  it('treats an entry sitting exactly on the threshold as a candidate', () => {
    expect(selectPickup([entryWithGap(10_000)], templateNames, 10_000, firstRng)).not.toBeNull();
  });

  it('admits every entry when the threshold is 0', () => {
    expect(selectPickup([entryWithGap(0)], templateNames, 0, firstRng)).not.toBeNull();
  });
});

describe('main', () => {
  let configDir: string;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // 2026-01-27 is a Tuesday (a regular business day in Japan)
    vi.setSystemTime(new Date('2026-01-27T09:30:00+09:00'));

    configDir = mkdtempSync(join(tmpdir(), 'nippotion-main-'));
    const configPath = join(configDir, 'nippotion.json');
    writeFileSync(configPath, JSON.stringify({
      dataSourceId: 'ds-id',
      timezone: 'Asia/Tokyo',
      holidays: 'jp',
      properties: { title: 'Title', labels: 'Labels', author: 'Author', date: 'Date' },
      recipients: [
        { labels: ['A'], channelId: 'C-A' },
        { labels: ['B'], channelId: 'C-B' },
      ],
    }));

    process.env.NOTION_API_TOKEN = 'test-token';
    process.env.SLACK_BOT_API_TOKEN = 'test-token';
    process.env.NIPPOTION_CONFIG = configPath;
    delete process.env.NIPPOTION_DEBUG;

    getDatabaseInfo.mockResolvedValue({ url: 'https://notion.so/db', title: 'Daily Notes', propertyIds: ['p1'] });
    getAllPages.mockResolvedValue([]);
    fetchTemplateNames.mockResolvedValue(new Set<string>());
    postMessage.mockResolvedValue({ ok: true });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    rmSync(configDir, { recursive: true, force: true });
    delete process.env.NIPPOTION_CONFIG;
    // Failure tests set the process-wide exitCode; reset it so vitest itself exits 0
    process.exitCode = undefined;
  });

  it('does nothing on a non-business day', async () => {
    // 2026-01-24 is a Saturday
    vi.setSystemTime(new Date('2026-01-24T09:30:00+09:00'));

    await main();

    expect(getDatabaseInfo).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does not post to any channel when the query returns no pages', async () => {
    getAllPages.mockResolvedValue([]);

    await main();

    expect(postMessage).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('does not post to any channel when no page yields an entry (e.g. all titles are empty)', async () => {
    getAllPages.mockResolvedValue([{}, {}]);
    toEntry.mockReturnValue(null);

    await main();

    expect(postMessage).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });

  it('posts to every recipient channel when entries exist', async () => {
    getAllPages.mockResolvedValue([{}]);
    toEntry.mockReturnValue(testEntry);

    await main();

    expect(postMessage).toHaveBeenCalledTimes(2);
    const channels = postMessage.mock.calls.map(([args]) => args.channel);
    expect(channels).toEqual(['C-A', 'C-B']);
    expect(process.exitCode).toBeUndefined();
  });

  it('logs the entries dropped from pickup candidates', async () => {
    getAllPages.mockResolvedValue([{}]);
    fetchTemplateNames.mockResolvedValue(new Set([testEntry.title]));
    toEntry.mockReturnValue({ ...testEntry, editGapMs: 0 });

    await main();

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Skipped from pickup candidates'),
      expect.stringContaining('https://notion.so/test'),
    );
  });

  it('keeps delivering to the remaining recipients and sets exitCode to 1 when posting fails', async () => {
    getAllPages.mockResolvedValue([{}]);
    toEntry.mockReturnValue(testEntry);
    postMessage.mockRejectedValue(new Error('boom'));

    await main();

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
  });
});
