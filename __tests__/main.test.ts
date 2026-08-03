import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Entry } from '../src/notion';

const { postMessage, getDatabaseInfo, getAllPages, toEntry } = vi.hoisted(() => ({
  postMessage: vi.fn(),
  getDatabaseInfo: vi.fn(),
  getAllPages: vi.fn(),
  toEntry: vi.fn(),
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
  return { ...actual, getDatabaseInfo, getAllPages, toEntry };
});

import { main } from '../src/main';

const testEntry: Entry = {
  title: 'Test Diary',
  writerName: 'Taro Tanaka',
  labels: ['A', 'B'],
  url: 'https://notion.so/test',
};

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

  it('keeps delivering to the remaining recipients and sets exitCode to 1 when posting fails', async () => {
    getAllPages.mockResolvedValue([{}]);
    toEntry.mockReturnValue(testEntry);
    postMessage.mockRejectedValue(new Error('boom'));

    await main();

    expect(postMessage).toHaveBeenCalledTimes(2);
    expect(process.exitCode).toBe(1);
  });
});
