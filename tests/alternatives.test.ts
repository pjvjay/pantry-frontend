import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cartChangeText, cartLineKey, cartTotal, chipReasons, coversText, footText, isPinned, lineNotes,
  linesOf, money, movedText, needText, optionsLabel, priceLine, purchaseLineNo, replaceCard,
  replyBeforeChange, rowsOf, storeText,
  swapAnnouncement, swapBlocked, swapNotice, unitPriceText,
} from '../src/alternatives.ts';
import type {
  AlternativeRanking, CartLine, CartSummary, PlanCardData, RankedAlternative,
} from '../src/types.ts';

// A row as pantry-api returned it for spaghetti_bolognese line 2 (demo mode, downtown, 5 km).
function row(over: Partial<RankedAlternative> = {}): RankedAlternative {
  return {
    rank: 2, current: false, product_id: 37, product: 'Ground Beef Lean', brand: 'Fraser Farms',
    size: '450g', tier: 'same', match: 'exact',
    offer: { store: 'GreenLeaf Grocers Kitsilano', price: 6.79, distance_km: 3.0, on_trip: false },
    packs: 1, pack_fit: 'unknown', cost_for_need: null, unit_price: 1.51, unit_basis: '100 g',
    trip: { total: 28.54, delta: 1.68, stores: ['Pantry Mart Downtown'], stops_delta: 0,
            merges_with_line: null, moved_items: [] },
    origin: { status: 'unknown', country: '', claim: '', label: 'Origin not checked',
              verbatim: '', source: '', demo: false },
    rating: { avg: 4.5, count: 6, synthetic: true }, says_organic: false,
    reasons: [
      { code: 'match', text: "Matches every word of 'Ground Beef'", tone: 'plus' },
      { code: 'pack', text: 'Recipe gives no amount', tone: 'unknown' },
      { code: 'origin', text: 'Origin not checked', tone: 'unknown' },
      { code: 'trip', text: '$1.68 more on your trip', tone: 'minus' },
      { code: 'rating', text: '4.5 of 5 from 6 reviews (demo)', tone: 'info' },
    ],
    rank_reason: 'Below #1: $1.68 more on your trip.',
    ...over,
  };
}

function ranking(items: RankedAlternative[], over: Partial<AlternativeRanking> = {}): AlternativeRanking {
  return {
    line_no: 2, lines: [2], ingredient: 'Ground Beef', need: '', need_qty: null, need_uom: null,
    order: ['tier', 'semantic_key', 'pack_fit', 'preference', 'trip_total', 'cost_for_need',
            'rating', 'id'],
    ranking_text: 'Products that are the same ingredient come first.', items, held_back: [],
    total: items.length, unavailable: 0,
    counts: { exact: 0, no_new_stop: 0, preferred_origin: 0, says_organic: 0, rated: 0 },
    data_note: 'Store prices, stock at every store and reviews are demo data.', ...over,
  };
}

const line: CartLine = {
  ingredient: 'Ground Beef', product: 'Ground Beef Extra Lean 300g', product_id: 36,
  store: 'Pantry Mart Downtown', price: 6.27, trip_store: 'Pantry Mart Downtown', trip_price: 6.27,
  line_no: 2, also_lines: [],
};

test('an unknown amount is never shown as zero', () => {
  assert.equal(money(0), '$0.00');
  assert.equal(money(null), 'price unknown');
  assert.equal(money(undefined), 'price unknown');
  assert.equal(money(Number.NaN), 'price unknown');
});

test("a cart's total is its trip's, or its lines' when the plan chose no trip", () => {
  assert.equal(cartTotal({ total_cost: 20, trip: { stores: ['A'], total_cost: 26.86 } }), 26.86);
  assert.equal(cartTotal({ total_cost: 20, trip: null }), 20);
  assert.equal(cartTotal({}), null);
});

test('a purchase covering several lines is pinned when any of them is', () => {
  const shared: CartLine = { ...line, line_no: 2, also_lines: [5] };
  assert.deepEqual(linesOf(shared), [2, 5]);
  assert.equal(isPinned(shared, [5]), true);
  assert.equal(isPinned(shared, [3]), false);
  assert.equal(isPinned(shared, undefined), false);
  assert.deepEqual(linesOf({ ingredient: 'x', product: 'y' }), []);
});

test("the line's button says what it opens and what the cart holds now", () => {
  assert.equal(optionsLabel(line, false), 'See options for Ground Beef: now Ground Beef Extra '
    + 'Lean 300g, $6.27 at Pantry Mart Downtown');
  assert.match(optionsLabel(line, true), /\(changed by you\)$/);
  // no trip, no store, no price: said, not made up
  assert.equal(optionsLabel({ ingredient: 'Salt', product: 'Sea Salt' }, false),
    'See options for Salt: now Sea Salt, price unknown');
  assert.equal(cartLineKey(4, 2), '4:2');
});

test("the button's name keeps every note drawn inside it, so a screen reader hears them", () => {
  const doubtful: CartLine = { ...line, packs: 2, match: 'generic', confidence: 0.72,
                               origin_status: 'unknown' };
  assert.deepEqual(lineNotes(doubtful, true), [
    { text: 'origin unclear', flag: true, title: 'origin unknown' },
    { text: 'closest match', flag: true },
    { text: 'check this pick', flag: true, title: 'the planner is 72% sure of this pick' },
  ]);
  assert.equal(optionsLabel(doubtful, true, true), 'See options for Ground Beef: now Ground Beef '
    + 'Extra Lean 300g ×2, $6.27 at Pantry Mart Downtown (changed by you); origin unclear, '
    + 'closest match, check this pick');
  // a known origin is a plain note; with no origin asked for, its absence is not a flag
  const sure: CartLine = { ...line, origin_country: 'Canada', match: 'exact', confidence: 0.95 };
  assert.deepEqual(lineNotes(sure, true), [{ text: 'Canada', flag: false }]);
  assert.match(optionsLabel(sure, false, true), /Pantry Mart Downtown; Canada$/);
  assert.deepEqual(lineNotes(line, false), []);
  assert.equal(optionsLabel(line, false, false), optionsLabel(line, false));
});

test("the cart's pick sits on top and the rest split by tier, in rank order", () => {
  const current = row({ rank: 1, current: true, product_id: 36 });
  const other = row({ rank: 3, tier: 'other', match: 'substitute', product_id: 51 });
  const same = row({ rank: 2 });
  const { current: top, same: s, other: o } = rowsOf(ranking([other, current, same]));
  assert.equal(top?.product_id, 36);
  assert.deepEqual(s.map((x) => x.rank), [2]);
  assert.deepEqual(o.map((x) => x.rank), [3]);
  // a pick that matches none of the line's words is not the same ingredient either
  const outside = row({ rank: 4, current: false, tier: 'outside', product_id: 9 });
  assert.deepEqual(rowsOf(ranking([outside])).other.map((x) => x.product_id), [9]);
  assert.equal(rowsOf(ranking([])).current, null);
});

test('chips are the match, origin and rating reasons, in that order', () => {
  assert.deepEqual(chipReasons(row()).map((r) => r.code), ['match', 'origin', 'rating']);
  assert.deepEqual(chipReasons(row({ reasons: [] })), []);
});

test('the price says what the recipe costs only when the amount was compared', () => {
  assert.deepEqual(priceLine(row()), {
    main: '$6.79 a pack', note: 'Amount not compared: Recipe gives no amount' });
  const compared = row({
    cost_for_need: 13.58, packs: 2, pack_fit: 'covers',
    reasons: [{ code: 'pack', text: "Covers the recipe's 900 g in 2 packs", tone: 'plus' }],
  });
  assert.deepEqual(priceLine(compared), {
    main: 'For this recipe $13.58',
    note: "$6.79 a pack; the cart buys 2. Covers the recipe's 900 g in 2 packs" });
});

test('unit price and store say unknown or catalog price instead of guessing', () => {
  assert.equal(unitPriceText(row()), '$1.51 / 100 g');
  assert.equal(unitPriceText(row({ unit_price: null, unit_basis: '' })), 'unit price unknown');
  assert.equal(storeText(row({ trip: null })), 'GreenLeaf Grocers Kitsilano, 3.0 km');
  assert.equal(storeText(row({ offer: { store: 'Pantry Mart Downtown', price: 1, distance_km: 0.2,
    on_trip: true } })), 'Pantry Mart Downtown, 0.2 km · on your trip');
  assert.equal(storeText(row({ offer: { store: '', price: 1, distance_km: null, on_trip: false } })),
    'catalog price (the plan has no shopping location)');
});

test("a row whose best trip skips the lowest-price store says where the trip buys it", () => {
  // live: Ground Beef Lean is $6.79 at GreenLeaf, but the trip stays at Pantry Mart Downtown and
  // the re-priced cart pays that store's price; the row must not imply the cart pays $6.79 there
  assert.equal(storeText(row()), 'Lowest price at GreenLeaf Grocers Kitsilano, 3.0 km; '
    + 'your best trip buys it at Pantry Mart Downtown instead');
  const two = row({ trip: { total: 30, delta: 1, stores: ['A', 'B', 'C'], stops_delta: 1,
    merges_with_line: null, moved_items: [] } });
  assert.match(storeText(two), /buys it at A, B or C instead$/);
  // the trip does stop at the offer's store: nothing to add
  const at = row({ trip: { total: 30, delta: 1, stores: ['A', 'GreenLeaf Grocers Kitsilano'],
    stops_delta: 1, merges_with_line: null, moved_items: [] } });
  assert.equal(storeText(at), 'GreenLeaf Grocers Kitsilano, 3.0 km');
  // no figure is made up for the trip store's price
  assert.doesNotMatch(storeText(row()), /\$/);
});

test('moved purchases are named with both stores', () => {
  assert.deepEqual(movedText(row({ trip: { total: 30, delta: 2, stores: ['B'], stops_delta: 0,
    merges_with_line: null, moved_items: [{ product_id: 4, product: 'Fresh Garlic',
      from_store: 'A', to_store: 'B' }] } })), ['Fresh Garlic moves from A to B']);
  assert.deepEqual(movedText(row({ trip: null })), []);
});

test('the header states the need, the lines a purchase covers and what is not listed', () => {
  assert.equal(needText(ranking([])), 'The recipe gives no amount for this line.');
  assert.equal(needText(ranking([], { need: '500 g' })), 'Your recipe needs 500 g.');
  assert.equal(coversText(ranking([])), '');
  assert.match(coversText(ranking([], { lines: [2, 5, 7] })), /^This purchase covers lines 2, 5 and 7;/);
  assert.deepEqual(footText(ranking([row()], { total: 5, unavailable: 2 })),
    ['+4 more ranked below these', '2 more not sold at a store in range']);
  assert.deepEqual(footText(ranking([row()])), []);
});

test('"Use this" is blocked while the assistant answers and on the sim gateway', () => {
  assert.equal(swapBlocked(false, 'pantry'), '');
  assert.match(swapBlocked(true, 'pantry'), /assistant is answering/);
  assert.match(swapBlocked(false, 'gateway-sim'), /pantry-sim gateway/);
});

test('a swap replaces only the card it was chosen from', () => {
  const a: PlanCardData = { kind: 'plan', ref: 0, summary: { recipe_name: 'A' } };
  const b: PlanCardData = { kind: 'plan', ref: 3, summary: { recipe_name: 'B' } };
  const c: PlanCardData = { kind: 'plan', ref: 7, pinned_lines: [2], summary: { recipe_name: 'B' } };
  assert.deepEqual(replaceCard([a, b], 3, c), [a, c]);
  assert.equal(replaceCard([a, b], 5, c), null);
  assert.equal(replaceCard([{ kind: 'week', summary: {} }], 0, c), null);
});

test("the announcement reads the new product and both totals from the carts' numbers", () => {
  const before: CartSummary = { lines: [line], trip: { stores: ['A'], total_cost: 26.86 } };
  const after: CartSummary = {
    lines: [{ ...line, product: 'Ground Beef Lean' }], trip: { stores: ['A'], total_cost: 28.54 } };
  assert.equal(swapAnnouncement(before, after, 2),
    'Ground Beef now Ground Beef Lean. Trip $28.54, was $26.86.');
  // same total: no "was"; no trip: the lines' total
  assert.equal(swapAnnouncement({ total_cost: 10 }, { total_cost: 10, lines: [line] }, 2),
    'Ground Beef now Ground Beef Extra Lean 300g. Total $10.00.');
  // a line found through also_lines
  assert.match(swapAnnouncement(before, { lines: [{ ...line, line_no: 1, also_lines: [2] }] }, 2),
    /^Ground Beef now/);
});

test('after a swap that joins another purchase, focus goes to the purchase that holds the line', () => {
  // red onion (line 6) swapped to Fresh Garlic, which line 2 already buys: one purchase, line 2
  const garlic: CartLine = { ingredient: 'garlic + red onion', product: 'Fresh Garlic',
                             line_no: 2, also_lines: [6] };
  const merged: CartSummary = { lines: [{ ...line, line_no: 1 }, garlic] };
  assert.equal(purchaseLineNo(merged, 6), 2);
  assert.equal(purchaseLineNo(merged, 2), 2);
  assert.equal(purchaseLineNo(merged, 1), 1);
  // a line the cart no longer holds keeps its own number (nothing to focus, nothing made up)
  assert.equal(purchaseLineNo(merged, 9), 9);
});

test("the answer's sentences are marked as describing the cart before the shopper's change", () => {
  const planned: PlanCardData = { kind: 'plan', ref: 1, pinned_lines: [], summary: {} };
  assert.equal(replyBeforeChange([planned]), '');
  assert.equal(replyBeforeChange([{ kind: 'plan', ref: 1, summary: {} }]), '');
  assert.match(replyBeforeChange([planned, { ...planned, ref: 4, pinned_lines: [2] }]),
    /before your change/);
});

test('the chat says whether the assistant still has to hear about a swap', () => {
  assert.match(swapNotice('[cart] The shopper changed line 2'), /next message/);
  assert.match(swapNotice(''), /back to what the assistant last saw/);
});

test("a cart change told to the model is recorded in the chat in the shopper's words", () => {
  const e = { line_no: 2, ingredient: 'Ground Beef', recipe_name: 'Spaghetti Bolognese',
    from: { name: 'Ground Beef Extra Lean 300g' }, to: { name: 'Ground Beef Lean' }, undone: false,
    total_before: 26.86, total_after: 28.54 };
  assert.equal(cartChangeText(e), 'Told the assistant: line 2 (Ground Beef) of Spaghetti '
    + 'Bolognese: Ground Beef Extra Lean 300g → Ground Beef Lean, total $28.54 (was $26.86).');
  assert.match(cartChangeText({ ...e, undone: true, total_before: 28.54, total_after: 28.54 }),
    /back to the planner's pick, Ground Beef Lean \(was Ground Beef Extra Lean 300g\), total \$28\.54\.$/);
});
