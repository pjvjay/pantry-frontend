// The shopping list: Your list for the whole period (trip, then store section), the same list as
// text for Copy and Print, one trip as in-store mode draws it with the ticked lines in the basket,
// and the Shop stage's "Check your plan" and strategy tiles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  NOT_STOCKED, OTHER_SECTION, bySection, checkPlan, heldProducts, instoreView, listAgainstRule, listCountText, listOf,
  listOriginNote, listText, periodList, sectionName, shopRows, storeGroups, storeLabels, strategyTiles, tickedText,
  tripChangeText, tripList, tripStores, warningCountsText,
} from '../src/mealplan/shoplist.ts';
import { strategyOf } from '../src/mealplan/board.ts';
import { countryRules } from '../src/mealplan/origin.ts';
import type { MealSchedule, PlanWarning, TripDiff, TripLine } from '../src/types.ts';
import { D, add, line, planWith, run, schedule, trip } from './helpers/mealplan.ts';

const real: MealSchedule = JSON.parse(readFileSync(new URL('./fixtures/mealplan-schedule.json',
  import.meta.url), 'utf8'));

const meal = (title: string, n: number) =>
  ({ meal_id: `k#${n}`, recipe_key: `starter:${title}`, title, date: D(n), slot: 'dinner' as const });

// A line in a store section: the category on the line and on its product, as pantry-api sends it.
function lc(pid: number, name: string, category: string | null, over: Partial<TripLine> = {}): TripLine {
  const l = line(pid, name, over);
  return { ...l, category, product: { ...l.product, category } };
}

test("a section is the line's category in words, and Other when pantry-api names none", () => {
  assert.equal(sectionName('produce'), 'Produce');
  assert.equal(sectionName('DAIRY'), 'Dairy');
  assert.equal(sectionName(null), OTHER_SECTION);
  assert.equal(sectionName('  '), OTHER_SECTION);
  assert.equal(listOf(['A']), 'A');
  assert.equal(listOf(['A', 'B', 'C']), 'A, B and C');
});

test('a product bought twice on a trip is one line: its packs, prices and recipes together', () => {
  const t = trip(D(1), [
    line(11, 'Chicken Thighs', { storage: 'fridge', packs: 1, price: 5.76, for_meals: [meal('Chicken Biryani', 2)] }),
    line(11, 'Chicken Thighs', { storage: 'freezer', freeze_on_arrival: true, packs: 2, price: 11.52,
      for_meals: [meal('Chicken Biryani', 6), meal('Butter Chicken', 7)] }),
    lc(12, 'Whole Milk 1L', 'dairy', { packs: null, packs_basis: 'amount_unknown', need_qty: 750, need_uom: 'ml',
      price: null, for_meals: [] }),
  ]);
  const rows = shopRows(t);
  assert.equal(rows.length, 2);
  const [chicken, milk] = rows;
  assert.equal(chicken.name, 'Chicken Thighs 1kg', 'the pack size, said once');
  assert.equal(chicken.amount, '3 packs');
  assert.equal(chicken.priceText, '$17.28');
  assert.deepEqual(chicken.recipes, ['Chicken Biryani', 'Butter Chicken']);
  assert.equal(chicken.forText, 'for Chicken Biryani and Butter Chicken');
  assert.deepEqual(chicken.notes, ['freeze 2 on arrival']);
  // an amount nobody knows is said as the need, and a price nobody knows is never $0.00
  assert.equal(milk.amount, 'need 750 ml');
  assert.equal(milk.price, null);
  assert.equal(milk.priceText, 'price unknown');
  assert.equal(milk.forText, '');
  // some prices known, some not: "at least"
  const half = shopRows(trip(D(1), [line(11, 'Rice', { price: 4 }), line(11, 'Rice', { storage: 'freezer', price: null })]));
  assert.equal(half[0].priceText, 'at least $4.00');
  assert.equal(shopRows(trip(D(1), [line(1, 'Salt', { packs: null, need_qty: null })]))[0].amount, 'amount unknown');
  // the same product at two stores is two places to pick it up
  const two = shopRows(trip(D(1), [line(11, 'Rice', { store: 'A' }), line(11, 'Rice', { store: 'B' })]));
  assert.deepEqual(two.map((r) => r.store), ['A', 'B']);
  // nobody in range stocks it: still on the list, said so
  const gone = shopRows(trip(D(1), [line(5, 'Saffron', { store: null, stocked: false, price: null })]));
  assert.equal(gone[0].store, NOT_STOCKED);
  assert.deepEqual(gone[0].notes, ['no store in range stocks it now']);
});

test('sections run as a store is walked, the cold food last, others by name, Other at the end', () => {
  const t = trip(D(1), ['frozen', 'dairy', null, 'household', 'pantry', 'meat', 'produce', 'bakery']
    .map((c, i) => lc(i + 1, `P${i}`, c)));
  assert.deepEqual(bySection(shopRows(t)).map((s) => s.name),
    ['Produce', 'Bakery', 'Pantry', 'Meat', 'Dairy', 'Frozen', 'Household', OTHER_SECTION]);
});

test('Your list: every trip by date, its day and stores, its lines by section', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  const lists = periodList(strategyOf(real, 'fresh'), s.draft);
  assert.deepEqual(lists.map((l) => l.date), ['2026-10-10', '2026-10-13']);
  const [first] = lists;
  assert.equal(first.heading, 'Sat 10 Oct · Pantry Mart Downtown and GreenLeaf Grocers Kitsilano');
  assert.equal(first.look.kind, 'suggested');
  assert.equal(first.items, 3);
  assert.equal(first.cost, '$118.83');
  assert.equal(first.manyStores, true, 'two stores: each line names its own');
  assert.deepEqual(first.storeLabels, { 'Pantry Mart Downtown': 'Pantry Mart', 'GreenLeaf Grocers Kitsilano': 'GreenLeaf Grocers' });
  assert.deepEqual(first.sections.map((x) => x.name), ['Pantry', 'Meat', 'Dairy']);
  assert.equal(lists[1].manyStores, false);
  assert.equal(listCountText(lists), '4 items on 2 trips');
  assert.deepEqual(periodList(undefined, s.draft), []);
});

test("a day approved under the other strategy is said so on Your list", () => {
  const t = trip(D(1), [line(1, 'Rice')]);
  const sc = schedule(1, [], [t]);
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  s = run(s, { type: 'setPrefs', prefs: { strategy: 'fewest_trips' } });
  s = run(s, { type: 'approveTrip', trip: t, strategy: 'fewest_trips', rev: s.draft.rev });
  s = run(s, { type: 'setPrefs', prefs: { strategy: 'fresh' } });
  assert.equal(tripList(sc.strategies[0].trips[0], s.draft).look.kind, 'elsewhere');
  // under the strategy it was approved in, pantry-api sends the trip as approved
  assert.equal(tripList({ ...t, status: 'approved' }, s.draft, 'fewest_trips').look.kind, 'approved');
});

test("a line on a trip to two stores names its store by the fewest words that tell them apart", () => {
  assert.deepEqual(storeLabels(['Pantry Mart Downtown', 'GreenLeaf Grocers Kitsilano']),
    { 'Pantry Mart Downtown': 'Pantry Mart', 'GreenLeaf Grocers Kitsilano': 'GreenLeaf Grocers' });
  assert.deepEqual(storeLabels(['Pantry Mart Downtown', 'Pantry Mart Kitsilano', 'Save On']),
    { 'Pantry Mart Downtown': 'Pantry Mart Downtown', 'Pantry Mart Kitsilano': 'Pantry Mart Kitsilano', 'Save On': 'Save On' });
  assert.deepEqual(storeLabels(['Costco', NOT_STOCKED]), { Costco: 'Costco', [NOT_STOCKED]: 'Not stocked' });
});

test('the list as text: each trip with its sections and lines, the total and the notice', () => {
  const s = planWith(7);
  const t = trip(D(1), [
    lc(1, 'Cilantro', 'produce', { store: 'A', price: 1.16, for_meals: [meal('Chicken Biryani', 1)] }),
    lc(2, 'Whole Milk 1kg', 'dairy', { store: 'B', packs: 2, price: 5.86 }),
  ], { stores: ['A', 'B'], total_cost: 7.02 });
  const text = listText([tripList(t, s.draft)], 'Shopping list · Fri 9 Oct – Thu 15 Oct · Shop fresh',
    'Total $7.02', 'Prices are demo data.');
  assert.equal(text, [
    'Shopping list · Fri 9 Oct – Thu 15 Oct · Shop fresh',
    '',
    'Sat 10 Oct · A and B · $7.02',
    '  Produce',
    '  - 1 pack · Cilantro 1kg · $1.16 (for Chicken Biryani; at A)',
    '  Dairy',
    '  - 2 packs · Whole Milk 1kg · $5.86 (at B)',
    '',
    'Total $7.02',
    'Prices are demo data.',
  ].join('\n'));
  // one store: the lines do not repeat it
  const one = listText([tripList(trip(D(1), [line(1, 'Rice', { price: 2 })]), s.draft)], 'List', 'Total $2.00');
  assert.match(one, /- 1 pack · Rice 1kg · \$2\.00\n/);
  assert.doesNotMatch(one, /at Pantry Mart/);
});

const CANADA = { country: 'Canada', claim: 'From Canada', status: 'evidenced' as const, preferred_rank: 1 };
const UNKNOWN = { country: null, claim: 'Origin unknown', status: 'unknown' as const, preferred_rank: null };
const UNCLEAR = { country: null, claim: 'Origin unclear: sources disagree', status: 'conflicting' as const, preferred_rank: null };

test('each row says where its product comes from, as the basket does; an older API says nothing', () => {
  const t = trip(D(1), [
    line(11, 'Chicken Thighs', { origin: CANADA }),
    line(11, 'Chicken Thighs', { storage: 'freezer', freeze_on_arrival: true, origin: CANADA }),
    line(12, 'Garlic', { origin: UNCLEAR }),
    line(13, 'Rice'),
  ]);
  assert.deepEqual(shopRows(t).map((r) => [r.name, r.origin?.status ?? null]),
    [['Chicken Thighs 1kg', 'evidenced'], ['Garlic 1kg', 'conflicting'], ['Rice 1kg', null]]);
});

test('Your list\'s one line, and the list as text, while the plan has country rules', () => {
  const s = planWith(7);
  const rules = countryRules(s.draft.settings);
  const t = trip(D(1), [
    lc(1, 'Cilantro', 'produce', { price: 1.16, origin: UNKNOWN, for_meals: [meal('Chicken Biryani', 1)] }),
    lc(2, 'Ground Beef', 'meat', { price: 6.79, origin: CANADA }),
    lc(3, 'Garlic', 'produce', { price: 0.68, origin: UNCLEAR }),
  ], { total_cost: 8.63 });
  const lists = [tripList(t, s.draft)];
  assert.equal(listOriginNote(lists, rules), 'No US products · 2 products to check on the label');
  assert.equal(listAgainstRule(lists, rules), null);
  assert.equal(listText(lists, 'List', 'Total $8.63', '', rules), [
    'List',
    'No US products · 2 products to check on the label',
    '',
    'Sat 10 Oct · Pantry Mart Downtown · $8.63',
    '  Produce',
    '  - 1 pack · Cilantro 1kg · $1.16 (for Chicken Biryani; origin unknown: check the label)',
    '  - 1 pack · Garlic 1kg · $0.68 (origin unclear: check the label)',
    '  Meat',
    '  - 1 pack · Ground Beef 1kg · $6.79 (from Canada)',
    '',
    'Total $8.63',
  ].join('\n'));
  // no rules: the list as it always was
  const free = countryRules({});
  assert.equal(listOriginNote(lists, free), null);
  assert.doesNotMatch(listText(lists, 'List', 'Total $8.63', '', free), /Canada|label/);
  // an older API's trip: the rule alone, and nothing on the lines
  const old = [tripList(trip(D(1), [line(1, 'Rice', { price: 2 })]), s.draft)];
  assert.equal(listOriginNote(old, rules), 'No US products');
  assert.match(listText(old, 'List', 'Total $2.00', '', rules), /- 1 pack · Rice 1kg · \$2\.00\n/);
});

test('Your list counts each product once, however many trips buy it, and says one against the rule apart', () => {
  const s = planWith(7);
  const rules = countryRules(s.draft.settings);
  const US = { country: 'United States', claim: 'From United States', status: 'evidenced' as const, preferred_rank: null };
  const MADE = { country: 'Canada', claim: 'Made in Canada, ingredients may be imported', status: 'evidenced' as const,
    preferred_rank: 1 };
  // garlic on both trips is one product to check, as Check ingredients counts it; the chicken, approved
  // before its evidence came in, is from the United States
  const lists = [
    tripList(trip(D(1), [lc(1, 'Garlic', 'produce', { origin: UNCLEAR }), lc(2, 'Chicken Breast', 'meat', { origin: US })]),
      s.draft),
    tripList(trip(D(4), [lc(1, 'Garlic', 'produce', { origin: UNCLEAR }), lc(3, 'Olive Oil', 'pantry', { origin: MADE }),
      lc(4, 'Cilantro', 'produce', { origin: UNKNOWN })]), s.draft),
  ];
  assert.equal(listOriginNote(lists, rules), 'No US products · 2 products to check on the label');
  assert.equal(listAgainstRule(lists, rules), '1 product here is from the United States, against your rule: Chicken Breast 1kg');
  const text = listText(lists, 'List', 'Total', '', rules);
  assert.deepEqual(text.split('\n').slice(0, 3), ['List', 'No US products · 2 products to check on the label',
    '1 product here is from the United States, against your rule: Chicken Breast 1kg']);
  assert.match(text, /Chicken Breast 1kg · .*\(from the United States: against your rule\)/);
  // the copied list keeps a processing claim's caveat, as the tag does
  assert.match(text, /Olive Oil 1kg · .*\(made in Canada, ingredients may be imported\)/);
  // with the rule off, nothing is against it
  assert.equal(listAgainstRule(lists, countryRules({ preference: ['Canada'] })), null);
});

test('in the store, a row keeps its origin', () => {
  const v = instoreView(trip(D(1), [line(1, 'Rice', { origin: UNCLEAR }), line(2, 'Beef', { origin: CANADA })]), []);
  assert.deepEqual(v.toGet.flatMap((g) => g.sections.flatMap((x) => x.rows.map((r) => r.origin?.status))),
    ['conflicting', 'evidenced']);
});

test('in the store: by store in the trip\'s order, then section; nobody stocks it last', () => {
  const rows = shopRows(trip(D(1), [
    lc(1, 'Rice', 'pantry', { store: 'B' }),
    line(2, 'Saffron', { store: null, stocked: false }),
    lc(3, 'Basil', 'produce', { store: 'A' }),
    lc(4, 'Milk', 'dairy', { store: 'A' }),
  ]));
  const groups = storeGroups(rows, ['A', 'B']);
  assert.deepEqual(groups.map((g) => g.store), ['A', 'B', NOT_STOCKED]);
  assert.deepEqual(groups[0].sections.map((s) => s.name), ['Produce', 'Dairy']);
});

test('in the store: a ticked line goes to the basket, and the count and the money follow it', () => {
  const t = trip(D(1), [
    lc(1, 'Basil', 'produce', { price: 2.5 }),
    lc(2, 'Milk', 'dairy', { price: 3 }),
    lc(3, 'Saffron', 'pantry', { price: null }),
  ], { total_cost: 5.5, total_is_floor: true });
  let v = instoreView(t, []);
  assert.equal(v.count, '0 of 3');
  assert.equal(v.spent, '$0.00');
  assert.equal(v.cost, 'at least $5.50');
  assert.deepEqual(v.toGet[0].sections.map((s) => s.name), ['Produce', 'Pantry', 'Dairy']);
  v = instoreView(t, [2, 1]);
  assert.equal(v.count, '2 of 3');
  assert.equal(v.spent, '$5.50');
  assert.deepEqual(v.basket.map((r) => r.productId), [1, 2], 'in the order of the list, not of the ticks');
  assert.deepEqual(v.toGet.flatMap((g) => g.sections.flatMap((s) => s.rows.map((r) => r.productId))), [3]);
  assert.equal(tickedText(v.basket[1], true, v), 'Milk 1kg in the basket: 2 of 3, $5.50 so far.');
  // an unknown price in the basket makes it "at least"; a product no longer on the trip is ignored
  v = instoreView(t, [1, 2, 3, 99]);
  assert.equal(v.count, '3 of 3');
  assert.equal(v.spent, 'at least $5.50');
  assert.equal(tickedText(v.basket[0], false, instoreView(t, [2])), 'Basil 1kg back on the list: 1 of 3, $3.00 so far.');
  assert.match(tickedText(v.basket[2], true, v), /Everything is in the basket\.$/);
  assert.equal(instoreView(t, [3]).spent, 'price unknown');
});

test('Check your plan: the diet, the total against the budget, the days, the stores and how to shop', () => {
  let s = planWith(14, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  const st = strategyOf(real, 'fresh');
  let items = checkPlan(s.draft, st, real);
  assert.deepEqual(items.map((x) => x.key), ['diet', 'countries', 'budget', 'days', 'stores', 'strategy']);
  const by = (k: string) => items.find((x) => x.key === k)!;
  assert.deepEqual([by('diet').value, by('diet').note], ['Anything', 'no allergies set']);
  assert.deepEqual([by('countries').label, by('countries').value, by('countries').note, by('countries').change],
    ['Countries', 'No US products', 'Canada first', 'where food comes from']);
  assert.deepEqual([by('budget').value, by('budget').note, by('budget').over], ['$219.40', 'no budget set', false]);
  assert.deepEqual([by('days').value, by('days').note], ['Fri 9 Oct – Thu 22 Oct', '2 weeks · you shop any day']);
  assert.equal(by('stores').value, 'Pantry Mart Downtown and GreenLeaf Grocers Kitsilano');
  assert.match(by('stores').note, /^within 5 km of /);
  assert.deepEqual([by('strategy').value, by('strategy').note], ['Shop fresh', '2 trips · recommended']);
  assert.equal(by('budget').change, 'the budget');
  // a vegetarian plan with a leave-out list and a budget, shopping at weekends
  s = run(s, { type: 'setPrefs', prefs: { diet: 'vegetarian', avoid: ['peanuts', 'dairy'], budget: 100,
    shop_weekdays: [5, 6] } });
  items = checkPlan(s.draft, st, real);
  assert.deepEqual([by('diet').value, by('diet').note], ['Vegetarian', 'avoiding peanuts and milk']);
  assert.deepEqual([by('budget').value, by('budget').note, by('budget').over], ['$219.40', '$119.40 over your $100.00 budget', true]);
  assert.equal(by('days').note, '2 weeks · you shop at weekends');
  s = run(s, { type: 'setPrefs', prefs: { budget: 250 } });
  items = checkPlan(s.draft, st, real);
  assert.equal(by('budget').note, '$30.60 left of your $250.00 budget');
  // before any trip: the budget alone
  items = checkPlan(s.draft, undefined, null);
  assert.deepEqual([by('budget').value, by('budget').note], ['$250.00 budget', 'no trips to add up yet']);
  assert.equal(by('stores').value, 'None yet');
  assert.equal(by('strategy').note, 'trips not worked out yet');
  // a total with an unknown price in it is a floor, and what is left of the budget is at most
  const floorSt = { ...st!, total_is_floor: true };
  items = checkPlan(s.draft, floorSt, real);
  assert.deepEqual([by('budget').value, by('budget').note], ['at least $219.40', 'at most $30.60 left of your $250.00 budget']);
  assert.deepEqual(tripStores(st), ['Pantry Mart Downtown', 'GreenLeaf Grocers Kitsilano']);
});

test('the two strategies as tiles: trips and total, the recommended one, and the difference', () => {
  const tiles = strategyTiles(real);
  assert.deepEqual(tiles.map((t) => [t.name, t.label, t.hint, t.extra]), [
    ['fresh', 'Shop fresh', '2 trips · $219.40', 'Recommended · 1 note'],
    ['fewest_trips', 'Fewest trips', '1 trip · $221.28', '$1.88 more · 1 note'],
  ]);
  // an "at least" total is no ground for more or less
  const floor: MealSchedule = { ...real, strategies: real.strategies.map((s, i) => (i === 1 ? { ...s, total_is_floor: true } : s)) };
  assert.equal(strategyTiles(floor)[1].extra, '1 note');
  // the cheaper one says so
  const cheaper: MealSchedule = { ...real, strategies: real.strategies.map((s, i) => (i === 1 ? { ...s, total_cost: 210 } : s)) };
  assert.equal(strategyTiles(cheaper)[1].extra, '$9.40 less · 1 note');
  // trips approved under Shop fresh are kept as they are under Fewest trips too: its tile says so
  const approved = [{ date: D(1), fingerprint: 'a'.repeat(64), strategy: 'fresh' as const, snapshot: [] },
    { date: D(4), fingerprint: 'b'.repeat(64), strategy: 'fresh' as const, snapshot: [] }];
  assert.deepEqual(strategyTiles(real, approved).map((t) => t.extra),
    ['Recommended · 1 note', '$1.88 more · keeps your 2 approved trips as they are · 1 note']);
  assert.equal(strategyTiles(real, approved.slice(0, 1))[1].extra, '$1.88 more · keeps your 1 approved trip as it is · 1 note');
  assert.equal(warningCountsText({ must_fix: 2, decide: 0, note: 1, should_fix: 1 }), '2 must fix, 1 should fix, 1 note');
  assert.equal(warningCountsText({ must_fix: 0, decide: 0, note: 0 }), 'no warnings');
});

// ─── A trip changed since it was approved ────────────────────

const diffOf = (over: Partial<TripDiff>): TripDiff => ({ added: [], removed: [], changed: [], text: ['…'], ...over });
const gone = (product_id: number, name: string, storage: 'fridge' | 'freezer' | 'pantry' = 'fridge') =>
  ({ product_id, name, packs: 1, storage });
const heldWarning = (product_id: number | null, code = 'origin_excluded'): PlanWarning => ({
  level: 'decide', code, message: 'held back by the origin rule', strategy: null,
  remedies: [{ op: 'resolve', recipe_key: 'lib:fried_rice' }], meal_ids: ['m1'], product_id, trip_date: null,
  recipe_key: 'lib:fried_rice',
});

test("the products the country rule now holds back are the schedule's origin_excluded warnings", () => {
  const sc = { ...schedule(1, []), warnings: [heldWarning(10), heldWarning(11), heldWarning(12, 'not_stocked'),
    heldWarning(null)] };
  assert.deepEqual([...heldProducts(sc)], [10, 11]);
  assert.deepEqual([...heldProducts(null)], []);
});

test('a changed trip says what is gone, and that the country rule left out a product it now holds back', () => {
  const t = trip(D(3), [], { status: 'needs_review', diff: diffOf({
    removed: [gone(10, 'Boneless Skinless Chicken Breast 500g')] }) });
  assert.equal(tripChangeText(t, new Set([10])),
    'Boneless Skinless Chicken Breast 500g is no longer on it: your country rule now leaves it out.');
  // the same diff without the rule's warning: gone, and no reason made up
  assert.equal(tripChangeText(t, new Set()), 'Boneless Skinless Chicken Breast 500g is no longer on it.');
});

test('a changed trip names what is new, what is gone and a different number of packs, each once', () => {
  const t = trip(D(3), [], { status: 'needs_review', diff: diffOf({
    removed: [gone(10, 'Chicken Breast'), gone(10, 'Chicken Breast', 'freezer'), gone(11, 'Ground Beef'),
      gone(12, 'Leeks')],
    added: [{ product_id: 20, name: 'Chicken Thighs', packs: 2, storage: 'fridge' }],
    changed: [{ product_id: 30, name: 'Whole Milk 1L', packs_before: 1, packs_after: 2, storage: 'fridge' },
      { product_id: 31, name: 'Eggs', packs_before: null, packs_after: 1, storage: 'fridge' }],
  }) });
  assert.equal(tripChangeText(t, new Set([10, 11])),
    'Chicken Breast and Ground Beef are no longer on it: your country rule now leaves them out. '
    + 'Leeks is no longer on it. Chicken Thighs is new on it. Whole Milk 1L: 2 packs instead of 1. '
    + 'Eggs: a different number of packs.');
});

test('a product moved from the fridge to the freezer is kept another way, not gone and new', () => {
  const t = trip(D(3), [], { status: 'needs_review', diff: diffOf({
    removed: [gone(40, 'Salmon Fillets')], added: [{ product_id: 40, name: 'Salmon Fillets', packs: 1, storage: 'freezer' }],
  }) });
  assert.equal(tripChangeText(t, new Set([40])), 'Salmon Fillets: now kept in the freezer.');
});

test('past three products a changed trip counts the rest', () => {
  const t = trip(D(3), [], { status: 'needs_review', diff: diffOf({
    removed: [gone(1, 'A'), gone(2, 'B'), gone(3, 'C'), gone(4, 'D')] }) });
  assert.equal(tripChangeText(t, new Set([1, 2, 3, 4])),
    'A, B and 2 more are no longer on it: your country rule now leaves them out.');
  assert.equal(tripChangeText(trip(D(3), [], { status: 'needs_review' }), new Set([1])), '');
});
