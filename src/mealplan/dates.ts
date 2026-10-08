// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Calendar dates for the meal planner, as 'YYYY-MM-DD' strings. A plan is about days, not
// instants: a Date at local midnight can land on the wrong day after a DST change or in another
// time zone, so the arithmetic here is on whole UTC days and only todayIn() reads a clock.

export type CivilDate = string;

// The demo's stores are in British Columbia, so "today" and "tomorrow" are Vancouver's.
export const PLAN_TIME_ZONE = 'America/Vancouver';

const DAY_MS = 86_400_000;
const SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Days since 1970-01-01, or null for anything that is not a real date ('2026-02-30' included:
// Date.UTC would quietly roll it over to March).
function dayNumber(d: string): number | null {
  const m = SHAPE.exec(d);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(ms).toISOString().slice(0, 10) === d ? ms / DAY_MS : null;
}

function day(d: CivilDate): number {
  const n = dayNumber(d);
  if (n === null) throw new RangeError(`not a calendar date: ${JSON.stringify(d)}`);
  return n;
}

const fromDay = (n: number): CivilDate => new Date(n * DAY_MS).toISOString().slice(0, 10);

export const isCivilDate = (d: string): boolean => dayNumber(d) !== null;

// Today's date on the shopper's calendar. `now` is a parameter so tests can pin the instant.
export function todayIn(timeZone: string = PLAN_TIME_ZONE, now: Date = new Date()): CivilDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export const addDays = (d: CivilDate, n: number): CivilDate => fromDay(day(d) + n);

// Whole days from `from` to `to`: negative when `to` comes first.
export const daysBetween = (from: CivilDate, to: CivilDate): number => day(to) - day(from);

// `days` consecutive dates from `start`.
export function range(start: CivilDate, days: number): CivilDate[] {
  const first = day(start);
  return Array.from({ length: Math.max(0, days) }, (_, i) => fromDay(first + i));
}

// 0 is Sunday, as Date.getUTCDay counts.
export const weekday = (d: CivilDate): number => new Date(day(d) * DAY_MS).getUTCDay();

// "Thu 15 Oct": fixed English names, the same in every browser and on every machine.
export function dayLabel(d: CivilDate): string {
  const date = new Date(day(d) * DAY_MS);
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}
