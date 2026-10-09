// Options on a meal-plan trip line: the edit a choice makes (one undo step, pins only where they
// differ from the planner's pick), the words around the dialog, and the fix for a pin the
// schedule refuses. The shapes are pantry-api's /mealplan/alternatives answer, cut down.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { historyStep, sameArea, step, undoPlan } from '../src/mealplan/model.ts';
import {
  choiceAnnouncement, chosenLineKey, coveredText, optionsDescription, optionsEdit, pinFix,
  stockNotice, tripLineKey, tripOptionsLabel,
} from '../src/mealplan/options.ts';
import { startHistory } from '../src/mealplan/undo.ts';
import type { CoveredLine, TripLineOptions } from '../src/types.ts';
import { D, add, line, planWith, run, trip } from './helpers/mealplan.ts';

const PIZZA = 'starter:pepperoni_pizza';
const BIRYANI = 'starter:chicken_biryani';
const SALT = 122;
const SEA_SALT = 123;

const covered = (key: string, title: string, lineNo: number, planner: number | null,
  pinned: number | null = null): CoveredLine => ({
  recipe_key: key, title, line_no: lineNo, ingredient: 'Salt', planner_product_id: planner,
  pinned_product_id: pinned,
});

function opts(lines: CoveredLine[], over: Partial<TripLineOptions> = {}): TripLineOptions {
  return {
    v: 1, rev: 3, strategy: 'fresh', trip_date: D(1), product_id: SALT, product: 'Table Salt 1kg',
    stocked: true, pinned: false, lines, plan_total: 219.4,
    ranking: {
      line_no: 1, lines: [1, 2], ingredient: 'Salt', need: '13.5 g', need_note: '',
      need_qty: 13.5, need_uom: 'g', order: [], ranking_text: '', items: [], held_back: [],
      total: 0, unavailable: 0,
      counts: { exact: 0, no_new_stop: 0, preferred_origin: 0, says_organic: 0, rated: 0 },
      data_note: 'Store prices, stock at every store and reviews are demo data.',
    },
    ...over,
  };
}

const both = [covered(BIRYANI, 'Chicken Biryani', 7, SALT), covered(PIZZA, 'Pepperoni Pizza', 3, SALT)];

test('a trip line is found again by its date and product', () => {
  assert.equal(tripLineKey(D(1), SALT), '2026-10-10:122');
});

test("the Options button says what it opens and what the line buys now, starting with its word", () => {
  assert.equal(tripOptionsLabel(line(SALT, 'Table Salt 1kg', { price: 1.54 })),
    'Options for Table Salt 1kg: now 1 pack, $1.54 at Pantry Mart Downtown');
  assert.equal(tripOptionsLabel(line(SALT, 'Table Salt 1kg', { packs: 3, price: 4.62 })),
    'Options for Table Salt 1kg: now 3 packs, $4.62 at Pantry Mart Downtown');
  // unknowns stay unknown, and a line no store sells says so
  assert.equal(tripOptionsLabel(line(SALT, 'Table Salt 1kg', { packs: null, price: null, store: null,
    stocked: false })),
  'Options for Table Salt 1kg: now amount unknown, price unknown; no store in range sells it now');
});

test('a choice pins every line the purchase covers, as one edit', () => {
  const edit = optionsEdit(both, SEA_SALT, {});
  assert.deepEqual(edit, { type: 'batch', edits: [
    { type: 'pinProduct', recipeKey: BIRYANI, lineNo: 7, productId: SEA_SALT },
    { type: 'pinProduct', recipeKey: PIZZA, lineNo: 3, productId: SEA_SALT },
  ] });
  // one line: the edit itself
  assert.deepEqual(optionsEdit(both.slice(1), SEA_SALT, {}),
    { type: 'pinProduct', recipeKey: PIZZA, lineNo: 3, productId: SEA_SALT });
});

test("the planner's pick is no pin: choosing it, or going back, takes pins off", () => {
  const pins = { [BIRYANI]: { 7: SEA_SALT }, [PIZZA]: { 3: SEA_SALT } };
  const lines = [covered(BIRYANI, 'Chicken Biryani', 7, SALT, SEA_SALT),
    covered(PIZZA, 'Pepperoni Pizza', 3, SALT, SEA_SALT)];
  const back = { type: 'batch', edits: [
    { type: 'pinProduct', recipeKey: BIRYANI, lineNo: 7, productId: null },
    { type: 'pinProduct', recipeKey: PIZZA, lineNo: 3, productId: null },
  ] };
  assert.deepEqual(optionsEdit(lines, null, pins), back);
  assert.deepEqual(optionsEdit(lines, SALT, pins), back);
  // nothing to change: no edit
  assert.equal(optionsEdit(both, SALT, {}), null);
  assert.equal(optionsEdit(lines, SEA_SALT, pins), null);
  // lines with different planner picks: each gets the pick it needs
  const mixed = [covered(BIRYANI, 'Chicken Biryani', 7, SALT), covered(PIZZA, 'Pepperoni Pizza', 3, SEA_SALT)];
  assert.deepEqual(optionsEdit(mixed, SEA_SALT, {}),
    { type: 'pinProduct', recipeKey: BIRYANI, lineNo: 7, productId: SEA_SALT });
});

test('the choice lands in the draft and one Undo takes it all back', () => {
  const s0 = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1),
    add('chicken_biryani', 'Chicken Biryani', 1));
  const edit = optionsEdit(both, SEA_SALT, s0.draft.pins);
  assert.ok(edit);
  const h0 = startHistory(s0);
  const { history: h1, outcome } = historyStep(h0, edit);
  assert.equal(outcome.refused, null);
  assert.deepEqual(h1.present.draft.pins, { [BIRYANI]: { 7: SEA_SALT }, [PIZZA]: { 3: SEA_SALT } });
  assert.equal(h1.present.draft.rev, s0.draft.rev + 1);
  // what Options schedules first is exactly what the edit makes
  assert.deepEqual(step(s0, edit).state.draft, h1.present.draft);
  const h2 = undoPlan(h1);
  assert.deepEqual(h2.present.draft.pins, {});
});

test('focus goes to the line that buys the choice afterwards', () => {
  assert.equal(chosenLineKey(opts(both), SEA_SALT), tripLineKey(D(1), SEA_SALT));
  assert.equal(chosenLineKey(opts(both, { product_id: SEA_SALT }), null), tripLineKey(D(1), SALT));
});

test('the dialog names the recipe lines, the trip and what these meals need', () => {
  assert.equal(coveredText(both), 'Chicken Biryani (line 7) and Pepperoni Pizza (line 3)');
  assert.equal(coveredText([covered(PIZZA, 'Pepperoni Pizza', 3, SALT),
    covered(PIZZA, 'Pepperoni Pizza', 5, SALT)]), 'Pepperoni Pizza (lines 3 and 5)');
  assert.equal(optionsDescription(opts(both)),
    'For Chicken Biryani (line 7) and Pepperoni Pizza (line 3), bought on the Sat 10 Oct trip. '
    + 'These meals need 13.5 g on this trip. A choice here is used for every Chicken Biryani and '
    + 'Pepperoni Pizza meal in the plan.');
  const unknown = opts(both.slice(1), { ranking: { ...opts([]).ranking, need: '',
    need_note: 'How many Pepperoni Pizza serves is not known yet, so the amount for these meals is unknown' } });
  assert.match(optionsDescription(unknown), /serves is not known yet, so the amount for these meals is unknown\./);
});

test('a line no store sells any more says so above the rows', () => {
  assert.equal(stockNotice(opts(both)), '');
  assert.equal(stockNotice(opts(both, { stocked: false })),
    'Table Salt 1kg is no longer sold at a store in range. Choose another product, or leave it off the trip.');
});

test('after a choice a screen reader hears the trip total from the two answers', () => {
  const before = trip(D(1), [], { total_cost: 118.83 });
  const after = trip(D(1), [], { total_cost: 118.2 });
  assert.equal(choiceAnnouncement(opts(both), 'Sea Salt 500g', before, after),
    'Table Salt 1kg is now Sea Salt 500g on the Sat 10 Oct trip. Trip $118.20, was $118.83.');
  assert.equal(choiceAnnouncement(opts(both), 'Sea Salt 500g', before, { ...before }),
    'Table Salt 1kg is now Sea Salt 500g on the Sat 10 Oct trip. Trip $118.83.');
  assert.equal(choiceAnnouncement(opts(both), 'Sea Salt 500g', before,
    trip(D(1), [], { total_cost: 120, total_is_floor: true })),
  'Table Salt 1kg is now Sea Salt 500g on the Sat 10 Oct trip. Trip at least $120.00, was $118.83.');
  assert.equal(choiceAnnouncement(opts(both), 'Sea Salt 500g', before, undefined),
    'Table Salt 1kg is now Sea Salt 500g on the Sat 10 Oct trip. The trips changed: see the Shop band.');
});

test('a pin the schedule refuses can be taken off, and nothing else is offered', () => {
  const fix = pinFix('pin_invalid', { error: 'pin_invalid', detail: 'x', recipe_key: PIZZA, line_no: 3 });
  assert.deepEqual(fix?.edit, { type: 'pinProduct', recipeKey: PIZZA, lineNo: 3, productId: null });
  assert.match(fix?.label ?? '', /planner’s product/);
  assert.equal(pinFix('stale_product', { recipe_key: PIZZA, line_no: 3 }), null);
  assert.equal(pinFix('pin_invalid', { recipe_key: PIZZA, line_no: null }), null);
  assert.equal(pinFix('pin_invalid', 'pin 3 is bad'), null);
  assert.equal(pinFix(null, null), null);
  // the fix applies, and the plan has no pin left on that line
  const s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1)),
    { type: 'pinProduct', recipeKey: PIZZA, lineNo: 3, productId: SEA_SALT });
  assert.deepEqual(run(s, fix!.edit).draft.pins, {});
});

test("the plan's origin rules are part of its shopping area", () => {
  assert.ok(sameArea({}, { lat: null, exclude_origin: [] }));
  assert.ok(!sameArea({}, { exclude_origin: ['United States'] }));
  assert.ok(!sameArea({ preference: ['Canada'] }, { preference: ['Mexico'] }));
  let s = run(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1)),
    { type: 'setResolved', resolved: [{ key: PIZZA, title: 'Pepperoni Pizza', status: 'ok', lines: [] }] });
  assert.ok(s.draft.resolved[PIZZA]);
  // new rules: the products are checked again under them
  s = run(s, { type: 'setSettings', settings: { exclude_origin: ['United States'] } });
  assert.deepEqual(s.draft.settings.exclude_origin, ['United States']);
  assert.deepEqual(s.draft.resolved, {});
  // the same rules again change nothing; a list the server would refuse is refused here
  assert.equal(step(s, { type: 'setSettings', settings: { exclude_origin: ['United States'] } }).state, s);
  assert.match(step(s, { type: 'setSettings', settings: { preference: Array(51).fill('Canada') } }).refused ?? '',
    /at most 50/);
  assert.match(step(s, { type: 'setSettings', settings: { exclude_origin: [''] } }).refused ?? '', /at most 50/);
});
