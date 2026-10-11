// Options on a meal-plan trip line: the edit a choice makes (one undo step, pins only where they
// differ from the planner's pick), the words around the dialog, and the fix for a pin the
// schedule refuses. The shapes are pantry-api's /mealplan/alternatives answer, cut down.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { historyStep, sameArea, step, undoPlan } from '../src/mealplan/model.ts';
import {
  choiceAnnouncement, chosenLineKey, coveredText, lineChoices, nothingText, optionsDescription, optionsEdit,
  optionsRequest, optionsTitle, pinFix, reachOf, reachText, stockNotice, storeToTurnOn, tripLineKey, tripOptionsLabel,
} from '../src/mealplan/options.ts';
import { startHistory } from '../src/mealplan/undo.ts';
import type { CoveredLine, HeldBack, MealStores, RankedAlternative, TripLineOptions } from '../src/types.ts';
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

test('a trip line is found again by its date and product, an ingredient across the plan by its product', () => {
  assert.equal(tripLineKey(D(1), SALT), '2026-10-10:122');
  assert.equal(tripLineKey(null, SALT), 'plan:122');
});

test('Options across the plan (no trip) say which recipes a choice changes', () => {
  const plan = opts(both, { trip_date: null, plan_total: null });
  assert.equal(optionsDescription(plan),
    'For Chicken Biryani (line 7) and Pepperoni Pizza (line 3). These meals need 13.5 g. A choice here '
    + 'changes it in every Chicken Biryani and Pepperoni Pizza meal in the plan.');
  assert.equal(stockNotice({ ...plan, stocked: false }),
    'Table Salt 1kg is no longer sold at a store in range. Choose another product, or skip this ingredient.');
  assert.equal(choiceAnnouncement(plan, 'Sea Salt 500g', undefined, undefined),
    'Table Salt 1kg is now Sea Salt 500g in Chicken Biryani and Pepperoni Pizza.');
  assert.equal(chosenLineKey(plan, SEA_SALT), 'plan:123');
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
    'Table Salt 1kg is now Sea Salt 500g on the Sat 10 Oct trip. The trips changed: see the Shopping plan.');
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
  // a new plan has the default rules; this one starts with none
  let s = run(planWith(7, { type: 'setSettings', settings: { exclude_origin: [], preference: [] } },
    add('pepperoni_pizza', 'Pepperoni Pizza', 1)),
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

// ─── a line with no product (line mode) ──────────────────────

const RICE = 'starter:chicken_fried_rice';
const row = (id: number, product: string, over: Partial<RankedAlternative> = {}): RankedAlternative => ({
  rank: id, current: false, product_id: id, product, brand: '', size: '', tier: 'same', match: 'exact',
  offer: { store: 'Pantry Mart Downtown', price: 4, distance_km: 0.3, on_trip: false }, packs: 1, pack_fit: 'covers',
  cost_for_need: 4, unit_price: null, unit_basis: '', trip: null,
  origin: { status: 'unknown', country: '', claim: '', label: '', verbatim: '', source: '', demo: false },
  rating: null, says_organic: false, reasons: [], rank_reason: '', ...over,
});
const held: HeldBack = { product_id: 9, product: 'Chicken Breast Fillets', country: 'United States',
  field: 'ingredient_origin', verbatim: 'Product of USA', source: 'label', demo: true };

test('a line with no product is asked by its recipe line, and its sheet says nothing is chosen yet', () => {
  const d = planWith(7).draft;
  assert.deepEqual(optionsRequest(d, { line: { recipeKey: RICE, lineNo: 6 } }, null, 'fresh', 12),
    { draft: d, line: { recipe_key: RICE, line_no: 6 }, strategy: 'fresh', limit: 12 });
  assert.deepEqual(optionsRequest(d, { productId: SALT }, D(1), 'fewest_trips', 12),
    { draft: d, trip_date: D(1), product_id: SALT, strategy: 'fewest_trips', limit: 12 });
  assert.equal(optionsTitle('Yellow Onion', false), 'Options for Yellow Onion: nothing chosen yet');
  assert.equal(optionsTitle('Yellow Onion', true), 'Options for Yellow Onion');
});

test('choosing for a line with no product pins every line it covers, and says so', () => {
  const lines = [{ ...covered(RICE, 'Chicken Fried Rice', 6, null), ingredient: 'Yellow Onion' },
    { ...covered(PIZZA, 'Pepperoni Pizza', 4, null), ingredient: 'Yellow Onion' }];
  const o = opts(lines, { trip_date: null, product_id: null, product: '', stocked: false,
    ranking: { ...opts([]).ranking, ingredient: 'Yellow Onion' } });
  assert.deepEqual(optionsEdit(lines, 77, {}), { type: 'batch', edits: [
    { type: 'pinProduct', recipeKey: RICE, lineNo: 6, productId: 77 },
    { type: 'pinProduct', recipeKey: PIZZA, lineNo: 4, productId: 77 },
  ] });
  assert.equal(stockNotice(o), '', 'no product of its own to have stopped selling');
  assert.equal(choiceAnnouncement(o, 'Red Onions 1kg', undefined, undefined),
    'Yellow Onion: Red Onions 1kg chosen in Chicken Fried Rice and Pepperoni Pizza.');
  assert.equal(chosenLineKey(o, 77), 'plan:77');
  assert.equal(chosenLineKey(o, null), '', 'back to the planner: no product to find');
});

test('a row out of reach: only at a store turned off, or only beyond the distance, under any of its names', () => {
  assert.equal(reachOf(row(1, 'A', { unavailable_kind: 'stores_off' })), 'stores_off');
  assert.equal(reachOf(row(1, 'A', { unavailable_kind: 'out_of_range' })), 'out_of_range');
  assert.equal(reachOf({ reach: 'beyond_distance' }), 'out_of_range');
  assert.equal(reachOf({ only: 'turned_off_stores' }), 'stores_off');
  assert.equal(reachOf(row(1, 'A')), null);
  assert.equal(reachOf({ unavailable_kind: 'origin_excluded' }), null, 'held back is its own list');
});

test('a line’s rows: the ones to choose, the ones out of reach, the ones held back', () => {
  const ranking = { ...opts([]).ranking, held_back: [held], items: [
    row(1, 'Red Onions 1kg'),
    row(2, 'Sweet Onions 2lb', { unavailable_kind: 'stores_off', store_id: 2,
      offer: { store: 'GreenLeaf Grocers Kitsilano', price: 3, distance_km: 2.9, on_trip: false } }),
  ] };
  const far = row(3, 'Organic Onions', { offer: { store: 'MegaSave Richmond', price: 5, distance_km: 13.9, on_trip: false } });
  const c = lineChoices({ ...ranking, out_of_reach: [far] } as typeof ranking);
  assert.deepEqual(c.choosable.map((x) => x.product), ['Red Onions 1kg']);
  assert.deepEqual(c.outOfReach.map((x) => [x.item.product, x.reach, x.store, x.storeId, x.distanceKm]), [
    ['Sweet Onions 2lb', 'stores_off', 'GreenLeaf Grocers Kitsilano', 2, 2.9],
    ['Organic Onions', 'out_of_range', 'MegaSave Richmond', null, 13.9],
  ], 'a list of its own counts as beyond the distance unless it says otherwise');
  assert.deepEqual(c.held, [held]);
  assert.equal(reachText(c.outOfReach[0], 5), 'Only at GreenLeaf Grocers Kitsilano, which you turned off');
  assert.equal(reachText(c.outOfReach[1], 5), 'Only beyond your 5 km: MegaSave Richmond, 14 km away');
  assert.equal(reachText({ ...c.outOfReach[1], store: '', distanceKm: null }, 10), 'Only beyond your 10 km');
  assert.equal(reachText({ ...c.outOfReach[0], store: '' }, 5), 'Only at a store, which you turned off');
});

test('the store "Turn it back on" means: by id, else the turned-off store of that name', () => {
  const stores = { v: 1, products_total: 0, stores: [
    { id: 1, name: 'Pantry Mart Downtown', address: '', distance_km: 0.3, in_range: true, off: false, sells: null },
    { id: 2, name: 'GreenLeaf Grocers Kitsilano', address: '', distance_km: 2.9, in_range: true, off: true, sells: null },
  ] } as MealStores;
  const x = lineChoices({ ...opts([]).ranking, items: [row(2, 'Sweet Onions', { unavailable_kind: 'stores_off',
    offer: { store: 'GreenLeaf Grocers Kitsilano', price: 3, distance_km: 2.9, on_trip: false } })] }).outOfReach[0];
  assert.deepEqual(storeToTurnOn(x, stores), { id: 2, name: 'GreenLeaf Grocers Kitsilano' }, 'by name');
  assert.deepEqual(storeToTurnOn({ ...x, store: '', storeId: 1 }, stores), { id: 1, name: 'Pantry Mart Downtown' });
  assert.equal(storeToTurnOn({ ...x, store: 'Elsewhere' }, stores), null);
  assert.equal(storeToTurnOn(x, null), null);
});

test('nothing to choose: said plainly, with what there is and the row’s own answers', () => {
  const off = lineChoices({ ...opts([]).ranking, items: [row(2, 'A', { unavailable_kind: 'stores_off' })] });
  assert.equal(nothingText('yellow onion', { outOfReach: off.outOfReach, held: [held] }),
    'Nothing can be chosen for yellow onion as your plan stands: every product for it is sold only at stores you '
    + 'turned off or held back by your origin rule (below). Go back to Meals for other recipes, or skip it.');
  assert.equal(nothingText('saffron', { outOfReach: [], held: [] }),
    'Nothing can be chosen for saffron as your plan stands: no store in reach sells a product for it. Go back to '
    + 'Meals for other recipes, or skip it.');
});
