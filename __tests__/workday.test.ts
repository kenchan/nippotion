import { describe, it, expect } from 'vitest';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { isWeekendOrHoliday, getPreviousWorkday } from '../src/workday';

dayjs.extend(utc);
dayjs.extend(timezone);

describe('isWeekendOrHoliday', () => {
  it('returns true for Saturday', () => {
    const saturday = dayjs('2026-01-24');

    const result = isWeekendOrHoliday(saturday, 'jp');

    expect(result).toBe(true);
  });

  it('returns true for Sunday', () => {
    const sunday = dayjs('2026-01-25');

    const result = isWeekendOrHoliday(sunday, 'jp');

    expect(result).toBe(true);
  });

  it('returns false for Friday', () => {
    const friday = dayjs('2026-01-23');

    const result = isWeekendOrHoliday(friday, 'jp');

    expect(result).toBe(false);
  });

  it('returns false for Monday', () => {
    const monday = dayjs('2026-01-26');

    const result = isWeekendOrHoliday(monday, 'jp');

    expect(result).toBe(false);
  });

  it("returns true for a Japanese holiday (New Year's Day)", () => {
    const newYearsDay = dayjs('2026-01-01');

    const result = isWeekendOrHoliday(newYearsDay, 'jp');

    expect(result).toBe(true);
  });

  it('returns false for a regular weekday (Tuesday)', () => {
    const tuesday = dayjs('2026-01-27');

    const result = isWeekendOrHoliday(tuesday, 'jp');

    expect(result).toBe(false);
  });

  it('returns false for a weekday holiday when holidays is not set', () => {
    // 2026-01-01 is a Thursday
    const newYearsDay = dayjs('2026-01-01');

    const result = isWeekendOrHoliday(newYearsDay);

    expect(result).toBe(false);
  });

  it('returns true for weekends even when holidays is not set', () => {
    const saturday = dayjs('2026-01-24');

    const result = isWeekendOrHoliday(saturday);

    expect(result).toBe(true);
  });

  it('evaluates holidays using the date in the given timezone', () => {
    // 05:00 JST on 2026-01-01 is 2025-12-31 in UTC. It must be evaluated as
    // New Year's Day in JST regardless of the process timezone
    const earlyNewYearJst = dayjs.tz('2026-01-01 05:00', 'Asia/Tokyo');

    const result = isWeekendOrHoliday(earlyNewYearJst, 'jp');

    expect(result).toBe(true);
  });
});

describe('getPreviousWorkday', () => {
  it('returns Thursday as the previous workday of Friday', () => {
    const friday = dayjs('2026-01-23');

    const result = getPreviousWorkday(friday, 'jp');

    expect(result.format('YYYY-MM-DD')).toBe('2026-01-22');
  });

  it('returns Friday as the previous workday of Monday', () => {
    const monday = dayjs('2026-01-26');

    const result = getPreviousWorkday(monday, 'jp');

    expect(result.format('YYYY-MM-DD')).toBe('2026-01-23');
  });

  it('skips a holiday Monday and returns Friday for Tuesday', () => {
    // 2026-01-12 (Monday) is Coming-of-Age Day
    const tuesday = dayjs('2026-01-13');

    const result = getPreviousWorkday(tuesday, 'jp');

    expect(result.format('YYYY-MM-DD')).toBe('2026-01-09');
  });

  it('does not skip holidays when holidays is not set', () => {
    // 2026-01-12 (Monday) is Coming-of-Age Day but should not be skipped
    const tuesday = dayjs('2026-01-13');

    const result = getPreviousWorkday(tuesday);

    expect(result.format('YYYY-MM-DD')).toBe('2026-01-12');
  });
});
