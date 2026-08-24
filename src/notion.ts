import { Client, isFullPage, collectPaginatedAPI } from '@notionhq/client';
import type { Dayjs } from 'dayjs';
import type { PageObjectResponse, DataSourceObjectResponse, QueryDataSourceParameters } from '@notionhq/client/build/src/api-endpoints';
import { withRetry } from './retry.js';
import { t } from './i18n.js';
import type { Config } from './config.js';

export const getDateFilter = (previousWorkday: Dayjs, today: Dayjs, dateProperty: string) => {
  const previousDay = today.subtract(1, 'day');

  if (previousWorkday.isSame(previousDay, 'day')) {
    return {
      "property": dateProperty,
      "date": { "equals": previousWorkday.format("YYYY-MM-DD") }
    };
  }

  return {
    "and": [{
      "property": dateProperty,
      "date": {
        "on_or_after": previousWorkday.format("YYYY-MM-DD"),
      }
    }, {
      "property": dateProperty,
      "date": {
        "on_or_before": previousDay.format("YYYY-MM-DD")
      }
    }]
  };
}

export const getDatabaseInfo = async (client: Client, dataSourceId: string, requiredProperties: string[]): Promise<{ url: string; title: string; propertyIds: string[] }> =>
  withRetry(async () => {
    const dataSource = await client.dataSources.retrieve({
      data_source_id: dataSourceId
    }) as DataSourceObjectResponse;

    const propertyIds = requiredProperties.map(name => {
      const prop = Object.values(dataSource.properties).find(p => p.name === name);
      if (!prop) throw new Error(t('notion.propertyNotFound', { name }));
      return prop.id;
    });

    return {
      url: dataSource.url,
      title: dataSource.title.map(t => t.plain_text).join(''),
      propertyIds,
    };
  });

export const getAllPages = async (client: Client, dataSourceId: string, filter: QueryDataSourceParameters['filter'], filterProperties?: string[]): Promise<PageObjectResponse[]> => {
  // Wrap the listFn itself in withRetry so retries apply per page
  // (wrapping the whole call would refetch already-retrieved pages from scratch)
  const results = await collectPaginatedAPI(
    (args: QueryDataSourceParameters) => withRetry(() => client.dataSources.query(args)),
    {
      data_source_id: dataSourceId,
      filter,
      filter_properties: filterProperties,
    }
  );
  return results.filter(isFullPage);
};

// Domain type holding only the values needed for delivery, extracted from a Notion page.
// Using it as the boundary keeps the Slack layer independent of Notion SDK types
// and of the property-name config
export interface Entry {
  title: string;
  writerName: string | null;
  labels: string[];
  url: string;
  editGapMs: number;
}

// Notion is not documented to guarantee sub-second precision on these fields. When it
// reports them at minute granularity the gap lands on multiples of 60000, and a threshold
// below a minute degrades to "created and last edited within the same minute" —
// the same intent, so no separate handling is needed
export const editGapMs = (page: PageObjectResponse): number => {
  const gap = Date.parse(page.last_edited_time) - Date.parse(page.created_time);
  // Floored at 0 so that a threshold of 0 really admits every entry: a negative gap, or the
  // NaN an unparseable timestamp yields, would otherwise compare false against every
  // threshold and drop the entry even where the setting is meant to disable the skip
  return Number.isFinite(gap) ? Math.max(0, gap) : 0;
};

// Each page is retried on its own rather than wrapping the whole walk, matching getAllPages:
// a retry around the walk would refetch pages that already succeeded.
// Any failure yields an empty set, which makes every entry a pickup candidate: listTemplates
// needs an API version and integration capabilities this tool cannot verify up front, and
// skipping nothing is far less harmful than skipping everything
export const fetchTemplateNames = async (client: Client, dataSourceId: string): Promise<Set<string>> => {
  const names = new Set<string>();

  try {
    let startCursor: string | undefined;
    do {
      const response = await withRetry(() => client.dataSources.listTemplates({
        data_source_id: dataSourceId,
        start_cursor: startCursor,
      }));
      for (const template of response.templates) names.add(template.name);
      startCursor = response.next_cursor ?? undefined;
    } while (startCursor);
  } catch (error) {
    console.error(t('notion.templateListFailed', {
      message: error instanceof Error ? error.message : String(error),
    }));
    return new Set();
  }

  return names;
};

// Both halves must hold to skip an entry: the title is still one of the database's template
// names, and nothing was edited after creation. Either half alone misidentifies entries —
// a title left as the template name is common among people who do write, and a one-shot
// write is common among people who compose elsewhere.
// Exported so that the caller can log exactly the entries selectPickup drops, without
// restating the condition on both sides of the boundary
export const isPickupCandidate = (entry: Entry, templateNames: Set<string>, minEditGapMs: number): boolean =>
  !(templateNames.has(entry.title) && entry.editGapMs < minEditGapMs);

// Property names are centralized in nippotion.json, so they are passed in as arguments.
// Narrowing by `type` returns a fallback instead of crashing on unexpected property types
const getTitle = (page: PageObjectResponse, titleProperty: string): string => {
  const prop = page.properties[titleProperty];
  if (prop?.type !== "title") return '';
  // Mentions and partial formatting split rich_text into segments, so join them all
  return prop.title.map(t => t.plain_text).join('');
};

const getWriterName = (page: PageObjectResponse, authorProperty: string): string | null => {
  const prop = page.properties[authorProperty];
  if (prop?.type !== "created_by") return null;
  const user = prop.created_by;
  // created_by is a union of PartialUserObjectResponse | UserObjectResponse; only the latter has `name`
  return 'name' in user ? user.name : null;
};

const getLabels = (page: PageObjectResponse, labelsProperty: string): string[] => {
  const prop = page.properties[labelsProperty];
  if (prop?.type !== "multi_select") return [];
  return prop.multi_select.map(s => s.name);
};

export const toEntry = (page: PageObjectResponse, properties: Config['properties']): Entry | null => {
  const title = getTitle(page, properties.title);
  // Pages without a title would produce a broken Slack link (<url|>),
  // so exclude them from both delivery and pickup
  if (!title) return null;

  return {
    title,
    writerName: getWriterName(page, properties.author),
    labels: getLabels(page, properties.labels),
    url: page.url,
    editGapMs: editGapMs(page),
  };
};
