// The Assistant's meal-plan draft: the plan the chat sends (contextOf), the card's reading of the
// draft, what Apply changes and applying it as one undo step. The draft is pantry-api's own
// plan_meals answer for the user's sentence (fixtures/mealplan-chat-draft.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_CONTEXT_BYTES, applyDraft, asMealPlan, contextOf, current, draftDiff, initials, stripDays,
  tripText,
} from '../src/mealplan/chatDraft.ts';
import type { ChatMealPlan } from '../src/mealplan/chatDraft.ts';
import { historyStep, mealsOf, docRef, undoPlan } from '../src/mealplan/model.ts';
import type { MealPlanState } from '../src/mealplan/model.ts';
import { startHistory } from '../src/mealplan/undo.ts';
import type { RecipeDoc } from '../src/types.ts';
import { D, add, planWith, run } from './helpers/mealplan.ts';

const DRAFT: ChatMealPlan = JSON.parse(readFileSync(
  new URL('./fixtures/mealplan-chat-draft.json', import.meta.url), 'utf8'));
const PIZZA = 'starter:pepperoni_pizza';
const RICE = 'starter:chicken_fried_rice';
const SHAKE = 'starter:mango_milkshake';
const BIRYANI = 'starter:chicken_biryani';

const placedOn = (s: MealPlanState, key: string) =>
  mealsOf(s.draft, key).filter((m) => m.date !== null).map((m) => `${m.date} ${m.slot}`).sort();

function applied(s: MealPlanState, p: ChatMealPlan, decisions = {}) {
  const out = applyDraft(s, p, decisions);
  assert.ok(!('refused' in out), 'refused' in out ? out.refused : '');
  return out;
}

test('the fixture is a draft the card can read', () => {
  assert.equal(asMealPlan(DRAFT), DRAFT);
  assert.equal(asMealPlan({ recipe_name: 'Tomato Penne', lines: [] }), null);
  assert.equal(asMealPlan({ ...DRAFT, ops: undefined }), null);
  assert.equal(DRAFT.base_rev, null);
  assert.deepEqual(DRAFT.proposals.map((p) => [p.recipe_key, p.question]),
    [[BIRYANI, 'chicken briyani → Chicken Biryani (demo starter)?']]);
});

test('Apply to a new plan: its dates, the three dishes on their days, briyani left out', () => {
  const s = planWith(7);
  assert.equal(current(s, DRAFT), true);
  const out = applied(s, DRAFT);
  assert.equal(out.edit.type, 'replace');
  const next = (out.edit as { state: MealPlanState }).state;
  assert.equal(next.draft.start_date, '2026-10-09');
  assert.equal(next.draft.days, 14);
  const want = (key: string) => DRAFT.ops.filter((o) => o.op === 'place' && o.recipe_key === key)
    .map((o) => (o.op === 'place' ? `${o.date} ${o.slot}` : '')).sort();
  for (const key of [PIZZA, RICE, SHAKE]) assert.deepEqual(placedOn(next, key), want(key));
  assert.deepEqual(Object.keys(next.draft.recipes).sort(), [RICE, SHAKE, PIZZA].sort());
  assert.equal(next.draft.recipes[BIRYANI], undefined);
  assert.equal(next.draft.meals.length, 12);
  assert.ok(next.draft.meals.every((m) => m.date !== null && !m.pinned && m.servings === undefined));
  assert.deepEqual(next.draft.trips, []);                              // nothing approved
  assert.equal(out.skipped.length, 0);
  assert.match(out.said, /^12 meals placed from the Assistant's draft\.$/);
});

test('Use on a proposal adds its meals for the schedule to spread; Not this leaves it out', () => {
  const s = planWith(7);
  const used = (applied(s, DRAFT, { [BIRYANI]: 'use' }).edit as { state: MealPlanState }).state;
  const biryani = mealsOf(used.draft, BIRYANI);
  assert.equal(biryani.length, 3);
  assert.ok(biryani.every((m) => m.date === null && m.pinned === false));
  assert.deepEqual(used.draft.recipes[BIRYANI].ref, { key: BIRYANI, starter: 'chicken_biryani' });
  const not = (applied(s, DRAFT, { [BIRYANI]: 'reject' }).edit as { state: MealPlanState }).state;
  assert.equal(mealsOf(not.draft, BIRYANI).length, 0);
  assert.match(applied(s, DRAFT, { [BIRYANI]: 'use' }).said, /added on your word: Chicken Biryani/);
});

test('Apply is one undo step', () => {
  const h = startHistory(planWith(7));
  const out = applied(h.present, DRAFT, { [BIRYANI]: 'use' });
  const after = historyStep(h, out.edit).history;
  assert.equal(after.present.draft.meals.length, 15);
  const back = undoPlan(after);
  assert.equal(back.present.draft.meals.length, 0);
  assert.equal(back.present.draft.days, 7);
});

test('a plan that changed since the draft: each op in turn, a taken cell waits for a free one', () => {
  const pizzaDay = DRAFT.ops.find((o) => o.op === 'place' && o.recipe_key === PIZZA);
  assert.ok(pizzaDay && pizzaDay.op === 'place');
  // the shopper put a dinner on the pizza's first day since the draft was made against rev 0
  const doc: RecipeDoc = { v: 1, key: 'my:dal', title: 'Grandma Dal', servings: 2, servings_stated: true,
    servings_basis: 'source', yield_text: '', lines: [], source: { kind: 'pasted', method: 'paste' },
    warnings: [] } as unknown as RecipeDoc;
  let s = run(planWith(14), { type: 'addRecipe', ref: docRef(doc), title: 'Grandma Dal', wanted: 1 });
  const dal = mealsOf(s.draft, 'my:dal')[0];
  s = run(s, { type: 'place', mealId: dal.id, date: pizzaDay.date, slot: 'dinner' });
  const stale = { ...DRAFT, base_rev: 0 };
  assert.equal(current(s, stale), false);
  const out = applied(s, stale);
  const next = (out.edit as { state: MealPlanState }).state;
  assert.deepEqual(placedOn(next, 'my:dal'), [`${pizzaDay.date} dinner`]);     // never moved
  assert.equal(out.skipped.length, 1);
  assert.match(out.skipped[0], /^Pepperoni Pizza on .*: that dinner is taken now$/);
  const waiting = mealsOf(next.draft, PIZZA).filter((m) => m.date === null);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].pinned, false);                    // the schedule spreads it
  assert.match(out.said, /1 meal to spread over free slots; your plan had changed since the draft/);
});

test('ops for a recipe already in the plan add meals; a plan is lengthened, never shortened', () => {
  let s = run(planWith(14), add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  const pizza = mealsOf(s.draft, PIZZA)[0];
  s = run(s, { type: 'place', mealId: pizza.id, date: D(0), slot: 'dinner' });
  const draft: ChatMealPlan = { ...DRAFT, base_rev: s.draft.rev, ops: [
    { op: 'set_window', start_date: D(0), days: 7 },
    { op: 'add_meals', recipe_key: PIZZA, title: 'Pepperoni Pizza', count: 1 },
    { op: 'place', recipe_key: PIZZA, title: 'Pepperoni Pizza', date: D(3), slot: 'dinner' }] };
  assert.deepEqual(draftDiff(s, draft), ['Plan length: 14 → 7 days', 'More Pepperoni Pizza: +1 dinner',
    '1 meal on free slots']);
  const next = (applied(s, draft).edit as { state: MealPlanState }).state;
  assert.equal(next.draft.days, 14);
  assert.deepEqual(placedOn(next, PIZZA), [`${D(0)} dinner`, `${D(3)} dinner`]);
  assert.equal(next.draft.recipes[PIZZA].wanted, 2);
});

test('the diff says what Apply changes', () => {
  const s = planWith(7);
  assert.deepEqual(draftDiff(s, DRAFT), [
    'Plan: 14 days from Fri 9 Oct',
    'New: Pepperoni Pizza, 3 dinners',
    'New: Chicken Fried Rice, 2 dinners',
    'New: Mango Milkshake, 7 snacks',
    '12 meals on free slots',
  ]);
  assert.equal(draftDiff(s, DRAFT, { [BIRYANI]: 'use' }).at(-1),
    'New: Chicken Biryani, 3 dinners, spread over free slots (you said Use)');
});

test('a snack slot switched off is switched on for the snacks Apply places', () => {
  const s = run(planWith(7), { type: 'setPrefs', prefs: { slots_on: ['dinner'] } });
  const next = (applied(s, DRAFT).edit as { state: MealPlanState }).state;
  assert.ok(next.draft.prefs.slots_on.includes('snack'));
  assert.equal(mealsOf(next.draft, SHAKE).filter((m) => m.date !== null).length, 7);
});

test('a draft that adds nothing is refused with the reason', () => {
  const out = applyDraft(planWith(7), { ...DRAFT, ops: [], proposals: [] });
  assert.ok('refused' in out);
});

test('the strip: one cell a day, meals in slot order, the trips on their days', () => {
  const days = stripDays(DRAFT);
  assert.equal(days.length, 14);
  assert.equal(days[0].label, 'Fri 9 Oct');
  const sat = days[1];
  assert.deepEqual(sat.meals.map((m) => m.slot), ['snack']);
  assert.ok(sat.trip);
  assert.equal(tripText(sat.trip), `Sat 10 Oct · $${DRAFT.trips[0].total_cost?.toFixed(2)}`);
  assert.equal(days.filter((d) => d.trip).length, DRAFT.trips.length);
  assert.equal(initials('Pepperoni Pizza'), 'PP');
  assert.equal(initials('Mango Milkshake'), 'MM');
});

test('the context the chat sends: the plan in brief, its own recipes\' lines, no approvals', () => {
  const doc = { v: 1, key: 'my:dal', title: 'Grandma Dal', servings: 2, servings_stated: true,
    servings_basis: 'source', yield_text: '', lines: [], source: { kind: 'pasted', method: 'paste' },
    warnings: [] } as unknown as RecipeDoc;
  const s = run(planWith(7), add('pepperoni_pizza', 'Pepperoni Pizza', 2),
    { type: 'addRecipe', ref: docRef(doc), title: 'Grandma Dal', wanted: 1 });
  const { context, dropped } = contextOf(s);
  assert.deepEqual(dropped, []);
  assert.equal(context.rev, s.draft.rev);
  assert.equal(context.meals.length, 3);
  assert.deepEqual(context.recipes, [
    { key: PIZZA, title: 'Pepperoni Pizza', kind: 'starter', slot: 'dinner' },
    { key: 'my:dal', title: 'Grandma Dal', kind: 'doc', slot: 'dinner' }]);
  assert.deepEqual(Object.keys(context.docs), ['my:dal']);
  assert.deepEqual(context.approved_trips, []);
  assert.ok(!('trips' in context) && !('resolved' in context));
});

test('a context over 64 KB leaves the largest docs out', () => {
  const big = (i: number) => ({ v: 1, key: `my:${i}`, title: `Big ${i}`, servings: 2,
    servings_stated: true, servings_basis: 'source', yield_text: '',
    lines: Array.from({ length: 60 }, (_, n) => ({ line_no: n + 1, text: 'x'.repeat(280),
      name: `item ${n}`, quantity: 1, unit: 'g', note: 'y'.repeat(280), confirmed: true,
      amount_basis: 'parsed_from_your_paste' })),
    source: { kind: 'pasted', method: 'paste' }, warnings: [] }) as unknown as RecipeDoc;
  let s = planWith(7);
  for (let i = 0; i < 3; i += 1) {
    s = run(s, { type: 'addRecipe', ref: docRef(big(i)), title: `Big ${i}`, wanted: 1 });
  }
  const { context, dropped } = contextOf(s);
  assert.ok(dropped.length >= 1);
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).length <= MAX_CONTEXT_BYTES);
  assert.equal(context.recipes.length, 3);                   // the recipes themselves stay
});
