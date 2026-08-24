import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, loadConfig } from '../src/config';

const validConfigData = {
  dataSourceId: 'ds-id',
  properties: {
    title: 'Title',
    labels: 'Labels',
    author: 'Author',
    date: 'Date',
  },
  recipients: [
    { labels: ['EC'], channelId: 'C123' },
  ],
};

// The default language is en, so the filled-in defaults are
// the English wording from locales/en.ts
const defaultFilledFields = {
  messages: {
    header: 'Here are the entries from {database} for the previous business day',
    pickup: "*:star: Today's pick goes to {writer}! :star:*",
    unknownWriter: '(unknown)',
    notificationText: 'Daily reports have arrived',
  },
};

describe('validateConfig', () => {
  it('parses a config with all required fields, filling in defaults', () => {
    const result = validateConfig(validConfigData);

    expect(result).toEqual({ ...validConfigData, ...defaultFilledFields });
  });

  it('includes footerText when specified', () => {
    const result = validateConfig({ ...validConfigData, footerText: 'footer' });

    expect(result.footerText).toBe('footer');
  });

  it('omits footerText when not specified', () => {
    const result = validateConfig(validConfigData);

    expect(result.footerText).toBeUndefined();
  });

  it('throws when the data itself is not an object', () => {
    expect(() => validateConfig(null)).toThrow();
    expect(() => validateConfig('invalid')).toThrow();
  });

  it('throws an error naming the key when dataSourceId is missing', () => {
    const configWithoutDataSourceId = {
      properties: validConfigData.properties,
      recipients: validConfigData.recipients,
    };

    expect(() => validateConfig(configWithoutDataSourceId)).toThrow(/dataSourceId/);
  });

  it('throws an error naming the key when dataSourceId has a wrong type', () => {
    expect(() => validateConfig({ ...validConfigData, dataSourceId: 123 })).toThrow(/dataSourceId/);
  });

  it('throws an error naming the key path when properties.date is missing', () => {
    const propertiesWithoutDate = {
      title: validConfigData.properties.title,
      labels: validConfigData.properties.labels,
      author: validConfigData.properties.author,
    };

    expect(() => validateConfig({ ...validConfigData, properties: propertiesWithoutDate }))
      .toThrow(/properties\.date/);
  });

  it('throws when properties is not an object', () => {
    expect(() => validateConfig({ ...validConfigData, properties: 'invalid' })).toThrow(/properties/);
  });

  it('throws when recipients is not an array', () => {
    expect(() => validateConfig({ ...validConfigData, recipients: {} })).toThrow(/recipients/);
  });

  it('throws an error with the index when channelId is missing in a recipient', () => {
    expect(() => validateConfig({ ...validConfigData, recipients: [{ labels: ['EC'] }] }))
      .toThrow(/recipients\[0\]\.channelId/);
  });

  it('throws an error with the index when labels is not a string array in a recipient', () => {
    expect(() => validateConfig({ ...validConfigData, recipients: [{ labels: 'EC', channelId: 'C1' }] }))
      .toThrow(/recipients\[0\]\.labels/);
  });

  it('throws an error naming the key when footerText has a wrong type', () => {
    expect(() => validateConfig({ ...validConfigData, footerText: 123 })).toThrow(/footerText/);
  });

  it('includes timezone when specified', () => {
    const result = validateConfig({ ...validConfigData, timezone: 'America/New_York' });

    expect(result.timezone).toBe('America/New_York');
  });

  it('omits timezone when not specified', () => {
    const result = validateConfig(validConfigData);

    expect(result.timezone).toBeUndefined();
  });

  it('throws an error naming the key for an invalid timezone name', () => {
    expect(() => validateConfig({ ...validConfigData, timezone: 'Asia/Gotham' })).toThrow(/timezone/);
  });

  it('throws an error naming the key when timezone has a wrong type', () => {
    expect(() => validateConfig({ ...validConfigData, timezone: 9 })).toThrow(/timezone/);
  });

  it('includes holidays when specified', () => {
    const result = validateConfig({ ...validConfigData, holidays: 'jp' });

    expect(result.holidays).toBe('jp');
  });

  it('omits holidays when not specified', () => {
    const result = validateConfig(validConfigData);

    expect(result.holidays).toBeUndefined();
  });

  it('includes pickup when specified', () => {
    const result = validateConfig({ ...validConfigData, pickup: { templateCopyMinEditGapMs: 30_000 } });

    expect(result.pickup).toEqual({ templateCopyMinEditGapMs: 30_000 });
  });

  it('omits pickup when not specified', () => {
    const result = validateConfig(validConfigData);

    expect(result.pickup).toBeUndefined();
  });

  it('accepts 0 as templateCopyMinEditGapMs, which admits every entry', () => {
    const result = validateConfig({ ...validConfigData, pickup: { templateCopyMinEditGapMs: 0 } });

    expect(result.pickup).toEqual({ templateCopyMinEditGapMs: 0 });
  });

  it('throws an error naming the key when pickup is not an object', () => {
    expect(() => validateConfig({ ...validConfigData, pickup: 10_000 })).toThrow(/pickup/);
  });

  it('throws an error naming the key path when templateCopyMinEditGapMs is missing', () => {
    expect(() => validateConfig({ ...validConfigData, pickup: {} }))
      .toThrow(/pickup\.templateCopyMinEditGapMs/);
  });

  it('throws an error naming the key path when templateCopyMinEditGapMs has a wrong type', () => {
    expect(() => validateConfig({ ...validConfigData, pickup: { templateCopyMinEditGapMs: '10000' } }))
      .toThrow(/pickup\.templateCopyMinEditGapMs/);
  });

  it('throws an error naming the key path when templateCopyMinEditGapMs is NaN', () => {
    expect(() => validateConfig({ ...validConfigData, pickup: { templateCopyMinEditGapMs: NaN } }))
      .toThrow(/pickup\.templateCopyMinEditGapMs/);
  });

  it('throws an error naming the key path when templateCopyMinEditGapMs is negative', () => {
    expect(() => validateConfig({ ...validConfigData, pickup: { templateCopyMinEditGapMs: -1 } }))
      .toThrow(/pickup\.templateCopyMinEditGapMs/);
  });

  it('throws an error naming the key path when templateCopyMinEditGapMs is not an integer', () => {
    expect(() => validateConfig({ ...validConfigData, pickup: { templateCopyMinEditGapMs: 10.5 } }))
      .toThrow(/pickup\.templateCopyMinEditGapMs/);
  });

  it('throws an error naming the key for an unsupported holidays country', () => {
    expect(() => validateConfig({ ...validConfigData, holidays: 'us' })).toThrow(/holidays/);
  });

  it('throws an error naming the key when holidays has a wrong type', () => {
    expect(() => validateConfig({ ...validConfigData, holidays: true })).toThrow(/holidays/);
  });

  it('fills in the default wording when messages is omitted', () => {
    const result = validateConfig(validConfigData);

    expect(result.messages).toEqual(defaultFilledFields.messages);
  });

  it('keeps the default wording for keys not overridden in messages', () => {
    const result = validateConfig({
      ...validConfigData,
      messages: { header: "Here are yesterday's entries from {database}!" },
    });

    expect(result.messages).toEqual({
      ...defaultFilledFields.messages,
      header: "Here are yesterday's entries from {database}!",
    });
  });

  it('throws when messages is not an object', () => {
    expect(() => validateConfig({ ...validConfigData, messages: 'invalid' })).toThrow(/messages/);
  });

  it('throws an error naming the key path when a messages value has a wrong type', () => {
    expect(() => validateConfig({ ...validConfigData, messages: { pickup: 123 } })).toThrow(/messages\.pickup/);
  });

  it('uses Japanese default messages when language is "ja"', () => {
    const result = validateConfig({ ...validConfigData, language: 'ja' });

    expect(result.language).toBe('ja');
    expect(result.messages.unknownWriter).toBe('（不明）');
    expect(result.messages.header).toContain('{database}');
  });

  it('lets individual messages overrides win over language defaults', () => {
    const result = validateConfig({
      ...validConfigData,
      language: 'ja',
      messages: { unknownWriter: 'どなたか' },
    });

    expect(result.messages.unknownWriter).toBe('どなたか');
  });

  it('omits language and uses English defaults when language is not specified', () => {
    const result = validateConfig(validConfigData);

    expect(result.language).toBeUndefined();
    expect(result.messages.unknownWriter).toBe('(unknown)');
  });

  it('throws an error naming the key for an unsupported language', () => {
    expect(() => validateConfig({ ...validConfigData, language: 'fr' })).toThrow(/language/);
  });
});

describe('loadConfig', () => {
  it('loads a JSON file and returns a validated Config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nippotion-config-'));
    const filePath = join(dir, 'nippotion.json');
    writeFileSync(filePath, JSON.stringify(validConfigData));

    try {
      const result = loadConfig(filePath);

      expect(result).toEqual({ ...validConfigData, ...defaultFilledFields });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws an error containing the path when the file does not exist', () => {
    expect(() => loadConfig('/no/such/dir/nippotion.json'))
      .toThrow(/\/no\/such\/dir\/nippotion\.json/);
  });

  it('throws for invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nippotion-config-'));
    const filePath = join(dir, 'nippotion.json');
    writeFileSync(filePath, '{ invalid json');

    try {
      expect(() => loadConfig(filePath)).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
