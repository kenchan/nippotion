import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig, loadConfig } from '../main';

const validConfigData = {
  dataSourceId: 'ds-id',
  properties: {
    title: 'タイトル',
    labels: 'ラベル',
    author: '著者',
    date: '日付',
  },
  recipients: [
    { labels: ['EC'], channelId: 'C123' },
  ],
};

describe('validateConfig', () => {
  it('必須項目が揃っていれば正常にパースできる', () => {
    const result = validateConfig(validConfigData);

    expect(result).toEqual(validConfigData);
  });

  it('footerTextを指定すると結果に含まれる', () => {
    const result = validateConfig({ ...validConfigData, footerText: 'footer' });

    expect(result.footerText).toBe('footer');
  });

  it('footerTextを省略すると結果にfooterTextが含まれない', () => {
    const result = validateConfig(validConfigData);

    expect(result.footerText).toBeUndefined();
  });

  it('データ自体がオブジェクトでない場合エラーになる', () => {
    expect(() => validateConfig(null)).toThrow();
    expect(() => validateConfig('invalid')).toThrow();
  });

  it('dataSourceIdが欠落している場合、キー名を含むエラーになる', () => {
    const configWithoutDataSourceId = {
      properties: validConfigData.properties,
      recipients: validConfigData.recipients,
    };

    expect(() => validateConfig(configWithoutDataSourceId)).toThrow(/dataSourceId/);
  });

  it('dataSourceIdの型が不正な場合、キー名を含むエラーになる', () => {
    expect(() => validateConfig({ ...validConfigData, dataSourceId: 123 })).toThrow(/dataSourceId/);
  });

  it('properties.dateが欠落している場合、キー名を含むエラーになる', () => {
    const propertiesWithoutDate = {
      title: validConfigData.properties.title,
      labels: validConfigData.properties.labels,
      author: validConfigData.properties.author,
    };

    expect(() => validateConfig({ ...validConfigData, properties: propertiesWithoutDate }))
      .toThrow(/properties\.date/);
  });

  it('propertiesがオブジェクトでない場合エラーになる', () => {
    expect(() => validateConfig({ ...validConfigData, properties: 'invalid' })).toThrow(/properties/);
  });

  it('recipientsが配列でない場合エラーになる', () => {
    expect(() => validateConfig({ ...validConfigData, recipients: {} })).toThrow(/recipients/);
  });

  it('recipients内のchannelIdが欠落している場合、添字を含むエラーになる', () => {
    expect(() => validateConfig({ ...validConfigData, recipients: [{ labels: ['EC'] }] }))
      .toThrow(/recipients\[0\]\.channelId/);
  });

  it('recipients内のlabelsが文字列配列でない場合、添字を含むエラーになる', () => {
    expect(() => validateConfig({ ...validConfigData, recipients: [{ labels: 'EC', channelId: 'C1' }] }))
      .toThrow(/recipients\[0\]\.labels/);
  });

  it('footerTextの型が不正な場合、キー名を含むエラーになる', () => {
    expect(() => validateConfig({ ...validConfigData, footerText: 123 })).toThrow(/footerText/);
  });
});

describe('loadConfig', () => {
  it('JSONファイルを読み込んでバリデーション済みのConfigを返す', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nippotion-config-'));
    const filePath = join(dir, 'nippotion.json');
    writeFileSync(filePath, JSON.stringify(validConfigData));

    try {
      const result = loadConfig(filePath);

      expect(result).toEqual(validConfigData);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('不正なJSONの場合エラーになる', () => {
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
