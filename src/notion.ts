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
}

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
  };
};
