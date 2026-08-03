import type { Dayjs } from 'dayjs';
// holiday_jp's CJS export shape cannot be statically analyzed; a named import
// breaks at runtime under Node's plain ESM loader, so default-import and access properties
import holidayJp from '@holiday-jp/holiday_jp';

export const HOLIDAY_COUNTRIES = ['jp'] as const;
export type HolidayCountry = (typeof HOLIDAY_COUNTRIES)[number];

const isHoliday = (date: Dayjs, country: HolidayCountry): boolean => {
  switch (country) {
    case 'jp':
      // toDate() on a timezone-aware dayjs returns the UTC instant, which holiday_jp
      // interprets in the process-local timezone, potentially shifting the date.
      // Building a Date from the date components evaluates holidays in the configured
      // timezone regardless of the process TZ
      return holidayJp.isHoliday(new Date(date.year(), date.month(), date.date()));
  }
};

export const isWeekendOrHoliday = (date: Dayjs, holidays?: HolidayCountry): boolean => {
  if (date.day() === 0 || date.day() === 6) return true;
  return holidays !== undefined && isHoliday(date, holidays);
}

export const getPreviousWorkday = (date: Dayjs, holidays?: HolidayCountry): Dayjs => {
  let previousWorkday = date.subtract(1, 'day');

  while (isWeekendOrHoliday(previousWorkday, holidays)) {
    previousWorkday = previousWorkday.subtract(1, 'day');
  }
  return previousWorkday;
}
