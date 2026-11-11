// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Room for meals: how many of each meal the plan's days hold, and how many its meals take. A day
// holds one breakfast, one lunch, one dinner and two snacks (CAPACITY), and only the meals
// planned in Set up; every recipe's meals of a kind count, on a day or in the tray. Pick meals
// stops a recipe's + and Add once every place for its meal is taken, and says why in words, so the
// counts never run ahead of the calendar. The engine's own limits (MAX_WANTED a recipe,
// MAX_MEALS a plan) stay behind it as the last stop.
import { CAPACITY, MAX_MEALS, MAX_WANTED, SLOTS, SLOT_LABELS } from './model.ts';
import type { Slot } from './model.ts';
import type { Meal, MealPlanDraft } from '../types.ts';

export interface SlotRoom {
  slot: Slot;
  label: string;
  on: boolean;                     // one of the meals planned (Set up)
  capacity: number;                // days × what a day holds; 0 for a meal not planned
  meals: number;                   // the plan's meals of this kind, placed or in the tray
  filled: number;                  // meals, at most capacity
  free: number;
}

const NOUNS: Record<Slot, [string, string]> = {
  breakfast: ['breakfast', 'breakfasts'], lunch: ['lunch', 'lunches'], dinner: ['dinner', 'dinners'],
  snack: ['snack', 'snacks'],
};

// A meal's kind: the slot it sits in, or in the tray its recipe's.
const kindOf = (d: MealPlanDraft, m: Meal): Slot | null => m.slot ?? d.recipes[m.recipe_key]?.slot ?? null;

export function slotRoom(d: MealPlanDraft, slot: Slot): SlotRoom {
  const on = d.prefs.slots_on.includes(slot);
  const capacity = on ? d.days * CAPACITY[slot] : 0;
  const meals = d.meals.filter((m) => kindOf(d, m) === slot).length;
  return { slot, label: SLOT_LABELS[slot], on, capacity, meals, filled: Math.min(meals, capacity),
    free: Math.max(0, capacity - meals) };
}

// The meals planned, in the calendar's order.
export const roomOf = (d: MealPlanDraft): SlotRoom[] =>
  SLOTS.filter((sl) => d.prefs.slots_on.includes(sl)).map((sl) => slotRoom(d, sl));

// The plan's days in words: "this week", "in these 2 weeks", "in these 10 days", "on this day".
export function periodWords(days: number): string {
  if (days === 7) return 'this week';
  if (days === 1) return 'on this day';
  return days % 7 === 0 ? `in these ${days / 7} weeks` : `in these ${days} days`;
}

// "All 7 dinners this week are planned", "All 28 snacks in these 2 weeks are planned".
export function fullText(r: SlotRoom, days: number): string {
  const [one, many] = NOUNS[r.slot];
  const when = periodWords(days);
  return r.capacity === 1 ? `The one ${one} ${when} is planned` : `All ${r.capacity} ${many} ${when} are planned`;
}

// Why one more meal of a recipe whose meal is `slot` cannot go in the plan, or null when it can:
// its meal is not planned, every place for it is taken, or an engine limit is reached. wanted:
// the recipe's count now (0 before it is in the plan).
export function addStop(d: MealPlanDraft, slot: Slot, wanted: number): string | null {
  const r = slotRoom(d, slot);
  if (!r.on) return `You plan no ${NOUNS[slot][1]}: turn ${r.label} on in Set up`;
  if (!r.free) return fullText(r, d.days);
  if (wanted >= MAX_WANTED) return `A recipe has at most ${MAX_WANTED} meals`;
  if (d.meals.length >= MAX_MEALS) return `A plan holds at most ${MAX_MEALS} meals`;
  return null;
}
