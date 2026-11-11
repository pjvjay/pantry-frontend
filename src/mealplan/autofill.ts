// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Place on days fills itself once. The first time the shopper opens it on a plan whose meals all
// wait in the tray, they are spread over the empty slots: the same edit as "Fill empty slots"
// (fillEmpty: the meals waiting pinned in the tray are unpinned, and the schedule spreads them),
// with a toast whose Undo puts them back in the tray. It happens once per plan, ever: the plan's
// id is remembered in this browser under pantry.autofill.v1, so an Undo stays undone and coming
// back to the stage never fills it again. A plan with any meal on a day is never filled: its
// shopper has started placing meals by hand, and meals the shopper placed are not touched.
import type { MealPlanState } from './model.ts';
import type { StorageLike } from './persist.ts';

export const AUTOFILL_KEY = 'pantry.autofill.v1';
// The plans remembered, newest last: more than anyone keeps, and a small value to store.
export const AUTOFILL_LIMIT = 50;

// The ids of the plans filled before in this browser; none when storage is off, refuses, or holds
// something this console did not write.
export function readAutofilled(storage: StorageLike | null): string[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(AUTOFILL_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// The list with `id` in it once, last, and at most AUTOFILL_LIMIT long (the oldest go first).
export function withAutofilled(list: readonly string[], id: string): string[] {
  return [...list.filter((x) => x !== id), id].slice(-AUTOFILL_LIMIT);
}

// Remembers that the plan `id` was filled. False when the browser would not store it: the page
// remembers it for itself meanwhile, so it is still filled only once while the page is open.
export function rememberAutofilled(storage: StorageLike | null, id: string): boolean {
  if (!storage) return false;
  try {
    storage.setItem(AUTOFILL_KEY, JSON.stringify(withAutofilled(readAutofilled(storage), id)));
    return true;
  } catch {
    return false;
  }
}

// How many meals filling the plan now would spread, or 0 when it is not one to fill: filled
// before, nothing waiting in the tray, or a meal on a day already.
export function autofillCount(s: MealPlanState, filled: readonly string[]): number {
  const d = s.draft;
  if (filled.includes(d.id) || d.meals.some((m) => m.date !== null)) return 0;
  return d.meals.filter((m) => m.date === null && m.pinned).length;
}

// The toast: "Spread 3 meals across the week".
export function spreadText(n: number, days: number): string {
  const span = days === 1 ? 'the day' : days === 7 ? 'the week' : days === 14 ? 'the two weeks'
    : `the ${days} days`;
  return `Spread ${n === 1 ? '1 meal' : `${n} meals`} across ${span}`;
}
