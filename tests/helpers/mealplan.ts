// Builders for the meal-plan tests: a plan with recipes in it, and the server's answers in the
// shapes pantry-api sends (types.ts), cut down to the fields each test reads.
import { newPlan, starterRef, step } from '../../src/mealplan/model.ts';
import type { MealPlanState, PlanEdit, Slot } from '../../src/mealplan/model.ts';
import type { MealSchedule, PlacedMeal, Trip, TripLine } from '../../src/types.ts';

export const TODAY = '2026-10-08';          // a Thursday; plans start Fri 9 Oct
// Day n of a plan that starts Fri 9 Oct 2026.
export const D = (n: number) => `2026-10-${String(9 + n).padStart(2, '0')}`;

// Apply edits in order, failing loudly on a refusal so a test never passes on a no-op.
export function run(s: MealPlanState, ...edits: PlanEdit[]): MealPlanState {
  for (const e of edits) {
    const out = step(s, e);
    if (out.refused) throw new Error(`${e.type} refused: ${out.refused}`);
    s = out.state;
  }
  return s;
}

export const add = (key: string, title: string, wanted: number, slot: Slot = 'dinner'): PlanEdit =>
  ({ type: 'addRecipe', ref: starterRef(key), title, slot, wanted });

export function planWith(days = 7, ...edits: PlanEdit[]): MealPlanState {
  return run(newPlan(TODAY, 'plan-1', days), ...edits);
}

export function line(pid: number, name: string, over: Partial<TripLine> = {}): TripLine {
  return {
    product: { id: pid, name, unit_size: '1kg', category: 'meat', demo_product: false },
    category: 'meat', packs: 1, packs_basis: 'computed', need_qty: 200, need_uom: 'g',
    leftover_qty: null, leftover_until: null, storage: 'fridge', freeze_on_arrival: false,
    shelf_life: { status: 'cited', verbatim: ['1 to 2 days'], rule_ids: ['fs-poultry-pieces-fridge'],
      source: 'FoodSafety.gov', url: 'https://www.foodsafety.gov/', page_date: '2023-09-19',
      days_planned: 1, note: '' },
    for_meals: [], store: 'Pantry Mart Downtown', price: 9.36, price_at_approval: null,
    price_delta: null, stocked: true, ...over,
  };
}

export function trip(date: string, lines: TripLine[], over: Partial<Trip> = {}): Trip {
  return {
    id: `fresh-${date}`, date, status: 'suggested', reason: 'test', lines, dismissed: [],
    stores: ['Pantry Mart Downtown'], recommended: null, frontier: [], not_stocked: [],
    total_cost: 0, total_is_floor: false, price_delta: null, fingerprint: 'a'.repeat(64),
    diff: null, list_text: '', ...over,
  };
}

export function schedule(rev: number, meals: PlacedMeal[], trips: Trip[] = [],
  start = D(0)): MealSchedule {
  return {
    v: 1, rev, start_date: start, meals, unplaced: [],
    strategies: [
      { name: 'fresh', recommended: true, trips, actions: [], total_cost: 0, total_is_floor: false,
        warning_counts: { must_fix: 0, decide: 0, note: 0 } },
      { name: 'fewest_trips', recommended: false, trips: [], actions: [], total_cost: 0,
        total_is_floor: false, warning_counts: { must_fix: 0, decide: 0, note: 0 } },
    ],
    recommended_strategy: 'fresh', warnings: [], days: [], period_nutrition: null,
    coverage: { products: 0, freshness_cited: 0, freshness_your_setting: 0, freshness_unknown: 0,
      needs: 0, amounts_known: 0, nutrition: 'unknown' },
    approved_schedule: null, sources: [], synthetic_notice: '',
  };
}

export const placed = (id: string, recipe_key: string, title: string, date: string | null,
  slot: PlacedMeal['slot'] = 'dinner', placed_by: PlacedMeal['placed_by'] = 'spread'): PlacedMeal =>
  ({ id, recipe_key, title, date, slot, servings: 2, pinned: false, placed_by });
