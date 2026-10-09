// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The meal plan's frame: which days it covers and the four meal slots in each. The draft and
// its reducer build on this.
import { addDays, daysBetween, isCivilDate, range } from './dates.ts';
import type { CivilDate } from './dates.ts';

export type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const SLOTS: readonly Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const SLOT_LABELS: Record<Slot, string> = {
  breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack',
};

// One meal per slot over at most two weeks: 14 days × 4 slots holds 56 meals.
export const MAX_DAYS = 14;
export const MAX_MEALS = MAX_DAYS * SLOTS.length;

export interface PlanWindow {
  start_date: CivilDate;
  days: number;
}

// A new plan starts tomorrow: today's meals are usually bought already.
export const newWindow = (today: CivilDate, days = 7): PlanWindow =>
  ({ start_date: addDays(today, 1), days });

// What is wrong with a window, in words for the shopper, or null when it is usable.
export function windowProblem(w: PlanWindow): string | null {
  if (!isCivilDate(w.start_date)) return `"${w.start_date}" is not a date`;
  if (!Number.isInteger(w.days) || w.days < 1 || w.days > MAX_DAYS) {
    return `a plan covers 1 to ${MAX_DAYS} days, not ${w.days}`;
  }
  return null;
}

export const windowDates = (w: PlanWindow): CivilDate[] => range(w.start_date, w.days);

export function inWindow(w: PlanWindow, date: CivilDate): boolean {
  const offset = daysBetween(w.start_date, date);
  return offset >= 0 && offset < w.days;
}

// The board draws a plan as weeks of seven days counted from its start date, not from Monday,
// so a plan never opens on a half-empty week.
export function weeksOf(w: PlanWindow): CivilDate[][] {
  const dates = windowDates(w);
  const weeks: CivilDate[][] = [];
  for (let i = 0; i < dates.length; i += 7) weeks.push(dates.slice(i, i + 7));
  return weeks;
}

// A slot cell's drop-target key, as the board's data-drop attribute carries it:
// 'slot|2026-10-15|dinner'.
export const cellKey = (date: CivilDate, slot: Slot): string => `slot|${date}|${slot}`;

export function parseCellKey(key: string): { date: CivilDate; slot: Slot } | null {
  const parts = key.split('|');
  if (parts.length !== 3) return null;
  const [kind, date, slot] = parts;
  if (kind !== 'slot' || !isCivilDate(date) || !SLOTS.includes(slot as Slot)) return null;
  return { date, slot: slot as Slot };
}
