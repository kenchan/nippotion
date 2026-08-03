import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import { getDateFilter, toEntry } from '../src/notion';
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

  it('returns an empty labels array when no labels are set', () => {
    const page = createPage('Taro Tanaka', 'Test Diary', 'https://notion.so/test');

    const entry = toEntry(page, properties);

    expect(entry?.labels).toEqual([]);
  });
});
