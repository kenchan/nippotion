import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import { getDateFilter, toEntry, editGapMs, isPickupCandidate } from '../src/notion';
import type { PageObjectResponse } from '@notionhq/client/build/src/api-endpoints';

// Actual property names are chosen by users in nippotion.json,
// so the tests use their own fixed values
const properties = {
  title: 'One-liner',
  labels: 'Team',
  author: 'Author',
  date: 'Date',
};

// Passing an array as title reproduces a multi-segment title;
// passing null as name reproduces a partial user without a name
const createPage = (name: string | null, title: string | string[], url: string, labels: string[] = []): PageObjectResponse => {
  const segments = Array.isArray(title) ? title : (title ? [title] : []);
  return {
    object: 'page',
    id: 'test-id',
    created_time: '2026-01-23T00:00:00.000Z',
    last_edited_time: '2026-01-23T00:00:00.000Z',
    created_by: { object: 'user', id: 'user-id' },
    last_edited_by: { object: 'user', id: 'user-id' },
    cover: null,
    icon: null,
    parent: { type: 'database_id', database_id: 'db-id' },
    archived: false,
    in_trash: false,
    is_archived: false,
    is_locked: false,
    url,
    public_url: null,
    properties: {
      [properties.title]: {
        id: 'title',
        type: 'title',
        title: segments.map(segment => ({
          type: 'text',
          text: { content: segment, link: null },
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' },
          plain_text: segment,
          href: null
        }))
      },
      [properties.author]: {
        id: 'created_by',
        type: 'created_by',
        created_by: name === null
          ? { object: 'user', id: 'user-id' }
          : { object: 'user', id: 'user-id', name }
      },
      [properties.labels]: {
        id: 'labels',
        type: 'multi_select',
        multi_select: labels.map(label => ({ id: label, name: label, color: 'default' }))
      }
    }
  };
};

// editGapMs only reads the two page-level timestamps, so the rest of the page is fixed
const createPageWithTimes = (created: string, lastEdited: string): PageObjectResponse => ({
  ...createPage('Taro Tanaka', 'Test Diary', 'https://notion.so/test'),
  created_time: created,
  last_edited_time: lastEdited,
});

describe('editGapMs', () => {
  it('returns the millisecond difference between creation and last edit', () => {
    const page = createPageWithTimes('2026-01-23T10:00:00.000Z', '2026-01-23T10:20:30.500Z');

    expect(editGapMs(page)).toBe(20 * 60 * 1000 + 30_500);
  });

  it('returns 0 when the page was never edited after creation', () => {
    // Minute-granularity stamps land here too: a page created at 10:00:12 and edited at
    // 10:00:47 arrives with both stamps at 10:00:00, so a sub-minute threshold degrades
    // to a same-minute check
    const page = createPageWithTimes('2026-01-23T10:00:00.000Z', '2026-01-23T10:00:00.000Z');

    expect(editGapMs(page)).toBe(0);
  });

  it('returns 0 when the last edit precedes creation', () => {
    const page = createPageWithTimes('2026-01-23T10:00:00.000Z', '2026-01-23T09:59:59.000Z');

    expect(editGapMs(page)).toBe(0);
  });

  it('returns 0 rather than NaN when a timestamp cannot be parsed', () => {
    const page = createPageWithTimes('2026-01-23T10:00:00.000Z', 'not a timestamp');

    expect(editGapMs(page)).toBe(0);
  });

  it('returns 60000 for minute-granularity timestamps one minute apart', () => {
    const page = createPageWithTimes('2026-01-23T10:00:00.000Z', '2026-01-23T10:01:00.000Z');

    expect(editGapMs(page)).toBe(60_000);
  });
});

describe('isPickupCandidate', () => {
  const entry = (gap: number) => ({ title: 't', writerName: null, labels: [], url: 'u', editGapMs: gap });

  it('accepts an entry whose gap exceeds the threshold', () => {
    expect(isPickupCandidate(entry(10_001), 10_000)).toBe(true);
  });

  it('accepts an entry sitting exactly on the threshold', () => {
    expect(isPickupCandidate(entry(10_000), 10_000)).toBe(true);
  });

  it('rejects an entry below the threshold', () => {
    expect(isPickupCandidate(entry(9_999), 10_000)).toBe(false);
  });

  it('accepts every entry when the threshold is 0', () => {
    expect(isPickupCandidate(entry(0), 0)).toBe(true);
  });
});

describe('getDateFilter', () => {
  it('filters by a single date when the gap is one day', () => {
    const today = dayjs('2026-01-23');
    const previousWorkday = dayjs('2026-01-22');

    const filter = getDateFilter(previousWorkday, today, properties.date);

    expect(filter).toEqual({
      property: 'Date',
      date: { equals: '2026-01-22' }
    });
  });

  it('filters by a date range when the gap is two days or more', () => {
    const today = dayjs('2026-01-26');
    const previousWorkday = dayjs('2026-01-23');

    const filter = getDateFilter(previousWorkday, today, properties.date);

    expect(filter).toEqual({
      and: [
        {
          property: 'Date',
          date: { on_or_after: '2026-01-23' }
        },
        {
          property: 'Date',
          date: { on_or_before: '2026-01-25' }
        }
      ]
    });
  });
});

describe('toEntry', () => {
  it('extracts the title, writer, labels, and URL', () => {
    const page = createPage('Taro Tanaka', 'Test Diary', 'https://notion.so/test', ['Team A']);

    const entry = toEntry(page, properties);

    expect(entry).toEqual({
      title: 'Test Diary',
      writerName: 'Taro Tanaka',
      labels: ['Team A'],
      url: 'https://notion.so/test',
      editGapMs: 0,
    });
  });

  it('joins all segments of a multi-segment title', () => {
    const page = createPage('Taro Tanaka', ['First half ', 'and second half'], 'https://notion.so/test');

    const entry = toEntry(page, properties);

    expect(entry?.title).toBe('First half and second half');
  });

  it('returns null for a page without a title', () => {
    const page = createPage('Taro Tanaka', '', 'https://notion.so/empty');

    const entry = toEntry(page, properties);

    expect(entry).toBeNull();
  });

  it('returns null writerName when the writer name is unavailable', () => {
    const page = createPage(null, 'Test Diary', 'https://notion.so/test');

    const entry = toEntry(page, properties);

    expect(entry?.writerName).toBeNull();
  });

  it('carries the edit gap over from the page timestamps', () => {
    const page = createPage('Taro Tanaka', 'Test Diary', 'https://notion.so/test');
    page.last_edited_time = '2026-01-23T00:05:00.000Z';

    const entry = toEntry(page, properties);

    expect(entry?.editGapMs).toBe(5 * 60 * 1000);
  });

  it('returns an empty labels array when no labels are set', () => {
    const page = createPage('Taro Tanaka', 'Test Diary', 'https://notion.so/test');

    const entry = toEntry(page, properties);

    expect(entry?.labels).toEqual([]);
  });
});
