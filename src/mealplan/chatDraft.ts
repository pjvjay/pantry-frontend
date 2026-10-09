// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The Assistant's meal plan: pantry's plan_meals draft as the chat's card holds it, and the
// shopper's Meal plan as the chat sends it.
//
// - contextOf: the plan in brief for ChatBody.meal_plan (at most 64 KB, which the hub checks):
//   window, meals, recipes, the dates of approved trips, settings, and the lines of the
//   shopper's own recipes. Approvals stay here: the hub never sees a fingerprint.
// - asMealPlan: a card's summary read as a draft, or null when it is not one.
// - draftDiff: what Apply would change in the plan as it is now, in words.
// - applyDraft: the draft's ops, and every proposal the shopper said Use to, applied to the plan
//   as one edit (one undo step). Ops are relative to the plan the draft was made from
//   (base_rev); when the plan changed since, each op is tried in turn and a meal whose cell is
//   taken waits for a free slot instead. Nothing here approves a trip.
import { addDays, dayLabel, daysBetween, range } from './dates.ts';
import type { CivilDate } from './dates.ts';
import { CAPACITY, SLOTS, mealsOf, occupants, recipeTitle, refProblem, step } from './model.ts';
import type { MealPlanState, PlanEdit, Slot } from './model.ts';
import type { MealSlot, RecipeDoc, RecipeRef } from '../types.ts';

export const MAX_CONTEXT_BYTES = 64_000;

export type ChatMealOp =
  | { op: 'set_window'; start_date: CivilDate; days: number }
  | { op: 'add_recipe'; recipe_key: string; title: string; slot: MealSlot; count: number;
      ref?: RecipeRef | null; spread?: boolean }
  | { op: 'add_meals'; recipe_key: string; title: string; count: number }
  | { op: 'place'; recipe_key: string; title?: string; date: CivilDate; slot: MealSlot };

export interface ChatMeal { date: CivilDate; slot: MealSlot; title: string; recipe_key: string; new: boolean }
export interface ChatAdded { recipe_key: string; title: string; label: string; how: string;
  count: number; placed: number; slot: MealSlot; input?: string }
export interface ChatProposal { input: string; recipe_key: string; title: string; label: string;
  how: string; count: number; slot: MealSlot; question: string; op: ChatMealOp }
export interface ChatUnmatched { input: string; reason: string;
  candidates: { recipe_key: string; title: string; label: string }[] }
export interface ChatTrip { date: CivilDate; stores: string[]; items: number; total_cost: number | null;
  total_is_floor: boolean; reason: string }

export interface ChatMealPlan {
  kind: 'mealplan';
  start_date: CivilDate;
  days: number;
  base_rev: number | null;
  household_servings: number;
  meals: ChatMeal[];
  added: ChatAdded[];
  proposals: ChatProposal[];
  unmatched: ChatUnmatched[];
  unplaced: { title: string; count: number; reason: string }[];
  strategy: string;
  trips: ChatTrip[];
  other_strategy: { name: string; trips: number; total_cost: number | null; total_is_floor: boolean } | null;
  total_cost: number | null;
  total_is_floor: boolean;
  nutrition: string;
  warnings: string[];
  notes: string[];
  ops: ChatMealOp[];
  drafted_from_message?: boolean;
}

// ChatBody.meal_plan: what the hub drafts against.
export interface MealPlanContext {
  start_date: CivilDate;
  days: number;
  rev: number;
  meals: { id: string; recipe_key: string; date: CivilDate | null; slot: MealSlot | null;
    servings: number | null; pinned: boolean }[];
  approved_trips: { date: CivilDate; strategy: string }[];
  recipes: { key: string; title: string; kind: 'library' | 'starter' | 'doc'; slot: MealSlot }[];
  prefs: MealPlanState['draft']['prefs'];
  docs: Record<string, RecipeDoc>;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const kindOf = (ref: RecipeRef): 'library' | 'starter' | 'doc' =>
  (ref.slug != null ? 'library' : ref.starter != null ? 'starter' : 'doc');

const bytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

// The plan in brief. Over MAX_CONTEXT_BYTES the largest docs are left out first (their
// recipes' meals still hold their places; the hub warns that they buy nothing in the draft).
export function contextOf(s: MealPlanState): { context: MealPlanContext; dropped: string[] } {
  const d = s.draft;
  const docs: Record<string, RecipeDoc> = {};
  for (const [key, r] of Object.entries(d.recipes)) {
    if (r.ref.doc) docs[key] = r.ref.doc;
  }
  const context: MealPlanContext = {
    start_date: d.start_date, days: d.days, rev: d.rev,
    meals: d.meals.map((m) => ({ id: m.id, recipe_key: m.recipe_key, date: m.date, slot: m.slot,
      servings: m.servings ?? null, pinned: m.pinned })),
    approved_trips: d.trips.map((t) => ({ date: t.date, strategy: t.strategy })),
    recipes: Object.entries(d.recipes).map(([key, r]) => ({ key, title: recipeTitle(s, key),
      kind: kindOf(r.ref), slot: r.slot })),
    prefs: d.prefs,
    docs,
  };
  const dropped: string[] = [];
  const bySize = Object.keys(docs).sort((a, b) => bytes(docs[b]) - bytes(docs[a]));
  while (bytes(context) > MAX_CONTEXT_BYTES && bySize.length) {
    const key = bySize.shift() as string;
    delete context.docs[key];
    dropped.push(recipeTitle(s, key));
  }
  return { context, dropped };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// A card's summary as a draft, or null when it is not one (an older hub, another card).
export function asMealPlan(summary: unknown): ChatMealPlan | null {
  if (!isObj(summary) || summary.kind !== 'mealplan') return null;
  for (const key of ['meals', 'added', 'proposals', 'unmatched', 'trips', 'ops']) {
    if (!Array.isArray(summary[key])) return null;
  }
  if (typeof summary.start_date !== 'string' || typeof summary.days !== 'number') return null;
  return summary as unknown as ChatMealPlan;
}

// ─── The strip ───────────────────────────────────────────────

export interface StripDay {
  date: CivilDate;
  label: string;                  // 'Fri 9 Oct'
  meals: ChatMeal[];              // in slot order
  trip: ChatTrip | null;
}

const slotRank = (slot: MealSlot) => SLOTS.indexOf(slot as Slot);

// One cell per day of the draft, with its meals and the day's suggested trip.
export function stripDays(p: ChatMealPlan): StripDay[] {
  return range(p.start_date, p.days).map((date) => ({
    date, label: dayLabel(date),
    meals: p.meals.filter((m) => m.date === date).sort((a, b) => slotRank(a.slot) - slotRank(b.slot)),
    trip: p.trips.find((t) => t.date === date) ?? null,
  }));
}

// "PP" for Pepperoni Pizza: the strip's short name, with the full one in its label.
export const initials = (title: string): string =>
  (title.match(/[A-Za-z0-9]+/g) ?? []).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// ─── The diff ────────────────────────────────────────────────

export type Decisions = Record<string, 'use' | 'reject'>;

const SLOT_PLURAL: Record<MealSlot, [string, string]> = {
  breakfast: ['breakfast', 'breakfasts'], lunch: ['lunch', 'lunches'],
  dinner: ['dinner', 'dinners'], snack: ['snack', 'snacks'],
};

const meals = (n: number, slot: MealSlot) => plural(n, ...SLOT_PLURAL[slot]);

// Whether the plan is the one the draft was made from.
export const current = (s: MealPlanState, p: ChatMealPlan): boolean =>
  p.base_rev === null ? s.draft.meals.length === 0 : p.base_rev === s.draft.rev;

// What Apply would change, one line each, in the order applied.
export function draftDiff(s: MealPlanState, p: ChatMealPlan, decisions: Decisions = {}): string[] {
  const d = s.draft;
  const out: string[] = [];
  for (const op of p.ops) {
    if (op.op === 'set_window') {
      if (op.days !== d.days || (d.meals.length === 0 && op.start_date !== d.start_date)) {
        out.push(d.meals.length === 0
          ? `Plan: ${plural(op.days, 'day', 'days')} from ${dayLabel(op.start_date)}`
          : `Plan length: ${d.days} → ${op.days} days`);
      }
    } else if (op.op === 'add_recipe' || op.op === 'add_meals') {
      const there = d.recipes[op.recipe_key];
      const slot = op.op === 'add_recipe' ? op.slot : (there?.slot ?? 'dinner');
      out.push(there ? `More ${op.title}: +${meals(op.count, slot)}`
        : `New: ${op.title}, ${meals(op.count, slot)}`);
    }
  }
  const placed = p.ops.filter((o) => o.op === 'place').length;
  if (placed) out.push(`${plural(placed, 'meal', 'meals')} on free slots`);
  for (const pr of p.proposals) {
    if (decisions[pr.recipe_key] === 'use') {
      out.push(`New: ${pr.title}, ${meals(pr.count, pr.slot)}, spread over free slots (you said Use)`);
    }
  }
  return out;
}

// ─── Apply ───────────────────────────────────────────────────

export interface Applied {
  edit: PlanEdit;
  said: string;
  skipped: string[];
}

// The recipe's ref from an op, checked as the reducer checks it.
function refOf(op: Extract<ChatMealOp, { op: 'add_recipe' }>): RecipeRef | null {
  const ref = op.ref;
  if (!ref || ref.key !== op.recipe_key) return null;
  return refProblem(ref) ? null : ref;
}

// Add `count` meals of a recipe (new to the plan, or there already): the new tray meals' ids.
function addMeals(s: MealPlanState, op: Extract<ChatMealOp, { op: 'add_recipe' | 'add_meals' }>)
  : { state: MealPlanState; ids: string[] } | string {
  const before = new Set(mealsOf(s.draft, op.recipe_key).map((m) => m.id));
  const there = s.draft.recipes[op.recipe_key];
  let out;
  if (there) {
    out = step(s, { type: 'setWanted', key: op.recipe_key, wanted: there.wanted + op.count });
  } else if (op.op === 'add_recipe') {
    const ref = refOf(op);
    if (!ref) return `${op.title}: its recipe did not come with the draft`;
    out = step(s, { type: 'addRecipe', ref, title: op.title, slot: op.slot, wanted: op.count });
  } else {
    return `${op.title} is no longer in your plan`;
  }
  if (out.refused) return `${op.title}: ${out.refused}`;
  return { state: out.state, ids: mealsOf(out.state.draft, op.recipe_key)
    .filter((m) => !before.has(m.id)).map((m) => m.id) };
}

// Meals left in the tray are let go to the schedule, which spreads them over free slots.
function spread(s: MealPlanState, ids: Set<string>): MealPlanState {
  if (!ids.size) return s;
  return { ...s, draft: { ...s.draft, meals: s.draft.meals.map((m) => (ids.has(m.id) && m.date === null
    ? { ...m, pinned: false } : m)) } };
}

export function applyDraft(s: MealPlanState, p: ChatMealPlan, decisions: Decisions = {})
  : Applied | { refused: string } {
  let next = s;
  const skipped: string[] = [];
  const waiting = new Set<string>();       // new meals not yet on a day
  let placed = 0;
  const fresh = current(s, p);
  for (const op of p.ops) {
    if (op.op === 'set_window') {
      // A plan made from nothing takes the draft's dates; an existing one only grows.
      const start = next.draft.meals.length === 0 ? op.start_date : next.draft.start_date;
      const days = next.draft.meals.length === 0 ? op.days : Math.max(next.draft.days, op.days);
      if (start === next.draft.start_date && days === next.draft.days) continue;
      const out = step(next, { type: 'setWindow', start_date: start, days });
      if (out.refused) skipped.push(`plan dates: ${out.refused}`);
      else next = out.state;
    } else if (op.op === 'add_recipe' || op.op === 'add_meals') {
      const out = addMeals(next, op);
      if (typeof out === 'string') {
        skipped.push(out);
        continue;
      }
      next = out.state;
      out.ids.forEach((id) => waiting.add(id));
    } else if (op.op === 'place') {
      const meal = next.draft.meals.find((m) => waiting.has(m.id) && m.recipe_key === op.recipe_key);
      const title = op.title ?? recipeTitle(next, op.recipe_key);
      const inside = daysBetween(next.draft.start_date, op.date);
      if (!meal) continue;
      if (inside < 0 || inside >= next.draft.days) {
        skipped.push(`${title} on ${dayLabel(op.date)}: outside the plan's dates`);
        continue;
      }
      if (occupants(next.draft, op.date, op.slot).length >= CAPACITY[op.slot as Slot]) {
        skipped.push(`${title} on ${dayLabel(op.date)}: that ${op.slot} is taken now`);
        continue;
      }
      if (!next.draft.prefs.slots_on.includes(op.slot)) {
        const on = step(next, { type: 'setPrefs', prefs: {
          slots_on: SLOTS.filter((sl) => next.draft.prefs.slots_on.includes(sl) || sl === op.slot) } });
        if (!on.refused) next = on.state;
      }
      const out = step(next, { type: 'place', mealId: meal.id, date: op.date, slot: op.slot });
      if (out.refused) {
        skipped.push(`${title} on ${dayLabel(op.date)}: ${out.refused}`);
        continue;
      }
      next = out.state;
      waiting.delete(meal.id);
      placed += 1;
    }
  }
  const used: string[] = [];
  for (const pr of p.proposals) {
    if (decisions[pr.recipe_key] !== 'use' || pr.op.op !== 'add_recipe') continue;
    const out = addMeals(next, pr.op);
    if (typeof out === 'string') {
      skipped.push(out);
      continue;
    }
    next = out.state;
    out.ids.forEach((id) => waiting.add(id));
    used.push(pr.title);
  }
  if (next === s) return { refused: skipped.join('; ') || 'the draft adds nothing to your plan' };
  const left = [...waiting].filter((id) => next.draft.meals.some((m) => m.id === id && m.date === null));
  next = spread(next, new Set(left));
  const parts = [`${plural(placed, 'meal', 'meals')} placed from the Assistant's draft`];
  if (left.length) parts.push(`${plural(left.length, 'meal', 'meals')} to spread over free slots`);
  if (used.length) parts.push(`added on your word: ${used.join(', ')}`);
  if (!fresh) parts.push('your plan had changed since the draft');
  return { edit: { type: 'replace', state: next }, said: `${parts.join('; ')}.`, skipped };
}

// "Sat 10 Oct · $63.76" for the card's trip list; null totals stay "price unknown".
export function tripText(t: ChatTrip): string {
  const cost = t.total_cost === null ? 'price unknown'
    : `${t.total_is_floor ? 'at least ' : ''}$${t.total_cost.toFixed(2)}`;
  return `${dayLabel(t.date)} · ${cost}`;
}

export const endOf = (p: ChatMealPlan): CivilDate => addDays(p.start_date, p.days - 1);
