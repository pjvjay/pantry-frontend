// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The shopping list, which the Shop stage leads with, and the same list for one trip in the
// store, to tick off:
//
//   Your list (Shop, and #/shop): one list for the whole period, every trip of the strategy
//     shown, each trip under its day and stores, then its lines by store section (the line's
//     category from pantry-api, "Other" when it names none). Each line says how many to buy, what,
//     what it costs, which recipes it is for and where it comes from (its origin, as the basket says
//     it: mealplan/origin.ts). Copy list and Print list give the same list as text (listText).
//   In-store mode (#/shop/trip/<date>): one trip, by store and then section, with the lines the
//     shopper has ticked moved to "In the basket" at the end, and how far along the trip is
//     (instoreView). The ticks themselves are kept in mealplan/shopping.ts, outside the plan. A
//     trip approved and since changed says what changed over the list (tripChangeText).
//
// A product bought twice on one trip (some for the fridge and some to freeze, as Fewest trips
// can do) is one line here: in the store it is one thing to pick up, so many packs. The trip
// sheet keeps the two apart, as pantry-api sends them.
//
// The sections run in the order most stores are walked, with the cold food last, so it spends the
// least time out of a fridge: produce, bakery, the shelves (pantry), deli, meat, seafood, dairy,
// frozen. A section this list does not know comes after those, by name, and "Other" last.
//
// Nothing is worked out here that pantry-api did not say: a price it does not know stays
// unknown, and a total with an unknown price in it is "at least".
import { nameWithSize } from '../alternatives.ts';
import { placeText, weekdaysText } from './basics.ts';
import { costText, money, tripLook, tripPriced } from './board.ts';
import type { TripLook } from './board.ts';
import { addDays, dayLabel } from './dates.ts';
import type { CivilDate } from './dates.ts';
import { AVOID_LABELS, DIET_LABELS, STRATEGY_NAMES, approvedElsewhere, avoidOf, budgetOf, dietOf } from './model.ts';
import { againstRule, countryRules, firstText, hasRules, listOriginText, originListWords, ruleText } from './origin.ts';
import type { CountryRules } from './origin.ts';
import type {
  ApprovedTrip, BasketOrigin, MealPlanDraft, MealSchedule, StrategyResult, Trip, TripDiffLine, TripLine, TripStrategy,
  WarningCounts,
} from '../types.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "A", "A and B", "A, B and C"
export const listOf = (parts: readonly string[]): string => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// ─── Sections ────────────────────────────────────────────────

export const OTHER_SECTION = 'Other';
// Where a line no store in range sells is listed, so it is still on the list.
export const NOT_STOCKED = 'Not stocked within range';

const WALK = ['produce', 'bakery', 'pantry', 'deli', 'meat', 'seafood', 'dairy', 'frozen'];

// A line's section, as its heading reads: "Produce", or "Other" when pantry-api names none.
export function sectionName(category: string | null | undefined): string {
  const c = (category ?? '').trim();
  return c ? c.charAt(0).toUpperCase() + c.slice(1).toLowerCase() : OTHER_SECTION;
}

// Where a section comes in the walk: the known ones in WALK's order, others after them by name,
// then Other.
function compareSections(a: string, b: string): number {
  const rank = (s: string) => {
    if (s === OTHER_SECTION) return WALK.length + 1;
    const i = WALK.indexOf(s.toLowerCase());
    return i === -1 ? WALK.length : i;
  };
  return rank(a) - rank(b) || a.localeCompare(b, 'en');
}

// ─── Lines ───────────────────────────────────────────────────

// One thing to pick up: a product at a store, with every line of the trip that buys it.
export interface ShopRow {
  key: string;                     // '<store>|<product id>'
  productId: number;
  name: string;                    // "Whole Milk 1L": the pack size said once
  productName: string;             // "Whole Milk", what its picture is asked by
  amount: string;                  // "2 packs", "need 750 g", "amount unknown"
  price: number | null;            // the known prices of its packs, null when none is known
  priceText: string;               // "$5.86", "at least $5.86", "price unknown"
  priceFloor: boolean;             // some price in it is unknown
  recipes: string[];               // the recipes it is bought for, each once, in the plan's order
  forText: string;                 // "for Chicken Biryani and Pepperoni Pizza"
  store: string;                   // the store, or NOT_STOCKED
  section: string;                 // "Produce"
  notes: string[];                 // "freeze 1 on arrival", "no store in range stocks it now"
  origin: BasketOrigin | null;     // where it comes from; null when pantry-api did not say (an older one)
}

const qtyText = (q: number) => (Number.isInteger(q) ? String(q) : q.toFixed(1));

// How many to buy: the packs when every line knows them, else what the recipes need, else unknown.
function amountOf(lines: readonly TripLine[]): string {
  if (lines.every((ln) => ln.packs !== null)) {
    return plural(lines.reduce((t, ln) => t + (ln.packs ?? 0), 0), 'pack', 'packs');
  }
  const uoms = new Set(lines.map((ln) => ln.need_uom));
  if (uoms.size === 1 && lines.every((ln) => ln.need_qty !== null && ln.need_uom)) {
    return `need ${qtyText(lines.reduce((t, ln) => t + (ln.need_qty ?? 0), 0))} ${lines[0].need_uom}`;
  }
  return 'amount unknown';
}

// One row per product and store, in the order pantry-api lists the trip's lines.
export function shopRows(trip: Trip): ShopRow[] {
  const groups = new Map<string, TripLine[]>();
  for (const ln of trip.lines) {
    const key = `${ln.store ?? NOT_STOCKED}|${ln.product.id}`;
    groups.set(key, [...(groups.get(key) ?? []), ln]);
  }
  return [...groups.entries()].map(([key, lines]) => {
    const first = lines[0];
    const known = lines.filter((ln) => ln.price !== null);
    const price = known.length ? known.reduce((t, ln) => t + (ln.price ?? 0), 0) : null;
    const floor = known.length > 0 && known.length < lines.length;
    const recipes = [...new Set(lines.flatMap((ln) => ln.for_meals.map((m) => m.title)))];
    const frozen = lines.filter((ln) => ln.freeze_on_arrival).reduce((t, ln) => t + (ln.packs ?? 0), 0);
    const notes = [
      frozen > 0 ? `freeze ${frozen} on arrival` : null,
      lines.some((ln) => !ln.stocked) ? 'no store in range stocks it now' : null,
    ].filter((x): x is string => x !== null);
    return {
      key, productId: first.product.id,
      name: nameWithSize(first.product.name, first.product.unit_size), productName: first.product.name,
      amount: amountOf(lines), price, priceFloor: floor,
      priceText: price === null ? 'price unknown' : `${floor ? 'at least ' : ''}${money(price)}`,
      recipes, forText: recipes.length ? `for ${listOf(recipes)}` : '',
      store: first.store ?? NOT_STOCKED, section: sectionName(first.category ?? first.product.category),
      notes, origin: lines.find((ln) => ln.origin)?.origin ?? null,
    };
  });
}

export interface ShopSection {
  name: string;
  rows: ShopRow[];
}

// Rows by section, in the walk's order; rows keep their order within a section.
export function bySection(rows: readonly ShopRow[]): ShopSection[] {
  const out = new Map<string, ShopRow[]>();
  for (const r of rows) out.set(r.section, [...(out.get(r.section) ?? []), r]);
  return [...out.entries()].sort(([a], [b]) => compareSections(a, b)).map(([name, rs]) => ({ name, rows: rs }));
}

// ─── Your list: the whole period ─────────────────────────────

export interface TripList {
  date: CivilDate;
  day: string;                     // "Fri 13 Nov"
  stores: string[];
  heading: string;                 // "Fri 13 Nov · Pantry Mart Downtown and GreenLeaf Grocers Kitsilano"
  look: TripLook;                  // approved, suggested, changed since approved, …
  items: number;
  cost: string;                    // "$112.05", "at least $4.00", "price unknown"
  manyStores: boolean;             // more than one store: each line names its own
  storeLabels: Record<string, string>;   // what a line calls its store (storeLabels)
  sections: ShopSection[];
}

// What a line calls its store on a trip to more than one: the fewest of the name's first words
// (two at least) that no other store of the trip begins with, so "Pantry Mart Downtown" and
// "GreenLeaf Grocers Kitsilano" are "Pantry Mart" and "GreenLeaf Grocers", while two branches of
// one chain keep the words that tell them apart. The trip's heading names each store in full.
export function storeLabels(stores: readonly string[]): Record<string, string> {
  const words = (x: string) => x.trim().split(/\s+/);
  const out: Record<string, string> = {};
  for (const s of stores) {
    const mine = words(s);
    const others = stores.filter((x) => x !== s).map(words);
    let n = Math.min(2, mine.length);
    const clash = (k: number) => others.some((o) => o.slice(0, k).join(' ') === mine.slice(0, k).join(' '));
    while (n < mine.length && clash(n)) n += 1;
    out[s] = mine.slice(0, n).join(' ');
  }
  return out;
}

export function tripList(trip: Trip, d: MealPlanDraft, strategy = d.prefs.strategy): TripList {
  const rows = shopRows(trip);
  const day = dayLabel(trip.date);
  const stores = [...new Set(rows.map((r) => r.store))];
  return {
    date: trip.date, day, stores: trip.stores,
    heading: trip.stores.length ? `${day} · ${listOf(trip.stores)}` : day,
    look: tripLook(trip, approvedElsewhere(d, trip.date, strategy)),
    items: rows.length,
    cost: costText(trip.total_cost, trip.total_is_floor, tripPriced(trip)),
    manyStores: stores.length > 1,
    storeLabels: storeLabels(stores),
    sections: bySection(rows),
  };
}

// Every trip of the strategy shown, by date.
export function periodList(st: StrategyResult | undefined, d: MealPlanDraft): TripList[] {
  return [...(st?.trips ?? [])].sort((a, b) => a.date.localeCompare(b.date)).map((t) => tripList(t, d, st?.name));
}

// "47 items on 4 trips"
export function listCountText(lists: readonly TripList[]): string {
  const items = lists.reduce((t, l) => t + l.items, 0);
  return `${plural(items, 'item', 'items')} on ${plural(lists.length, 'trip', 'trips')}`;
}

// The rows of every trip in a list, in its order.
const rowsOf = (lists: readonly TripList[]): ShopRow[] => lists.flatMap((l) => l.sections.flatMap((s) => s.rows));

// The one line over Your list while the plan has country rules: the rule, and how many of the
// products shown ask the shopper to read the label in the store ("No US products · 4 products to
// check on the label"); null with no rules.
export const listOriginNote = (lists: readonly TripList[], rules: CountryRules): string | null =>
  listOriginText(rules, rowsOf(lists));

// Any product the list still buys from a country the plan leaves out, said apart from that line
// ("1 product here is from the United States, against your rule: …"); null when there is none.
export const listAgainstRule = (lists: readonly TripList[], rules: CountryRules): string | null =>
  againstRule(rules, rowsOf(lists));

// The list as text, for the clipboard and the printer: the heading, then each trip with its
// sections and lines, then the total and the demo's notice. While the plan has country rules
// (rules), the lines under the heading say the rule and any product against it, and each line
// where its product comes from in a few words ("from Canada", "origin unknown: check the label").
//   head: "Shopping list · Thu 12 Nov – Wed 25 Nov · Shop fresh"; total: "Total $214.44"
export function listText(lists: readonly TripList[], head: string, total: string, notice = '',
  rules: CountryRules | null = null): string {
  const ruled = rules !== null && hasRules(rules) ? rules : null;
  const out = [head, ...(ruled ? [listOriginNote(lists, ruled), listAgainstRule(lists, ruled)] : [])]
    .filter((x): x is string => Boolean(x));
  for (const l of lists) {
    out.push('', `${l.heading} · ${l.cost}`);
    for (const s of l.sections) {
      out.push(`  ${s.name}`);
      for (const r of s.rows) {
        const extra = [r.forText, ...r.notes, l.manyStores ? `at ${r.store}` : '',
          ruled ? originListWords(r.origin, ruled) : ''].filter(Boolean).join('; ');
        out.push(`  - ${r.amount} · ${r.name} · ${r.priceText}${extra ? ` (${extra})` : ''}`);
      }
    }
  }
  out.push('', total);
  if (notice.trim()) out.push(notice.trim());
  return out.join('\n');
}

// ─── In-store mode: one trip, ticked off ─────────────────────

export interface StoreGroup {
  store: string;
  sections: ShopSection[];
}

// Rows by store in the trip's order (a store it does not name after them, the lines nobody in
// range stocks last), then by section.
export function storeGroups(rows: readonly ShopRow[], order: readonly string[]): StoreGroup[] {
  const out = new Map<string, ShopRow[]>();
  for (const r of rows) out.set(r.store, [...(out.get(r.store) ?? []), r]);
  const rank = (s: string) => (s === NOT_STOCKED ? order.length + 1 : order.includes(s) ? order.indexOf(s) : order.length);
  return [...out.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b, 'en'))
    .map(([store, rs]) => ({ store, sections: bySection(rs) }));
}

export interface InStoreView {
  day: string;                     // "Fri 13 Nov"
  stores: string[];
  toGet: StoreGroup[];             // what is still to pick up
  basket: ShopRow[];               // ticked, in the list's order
  done: number;                    // rows in the basket
  total: number;                   // rows on the trip
  spent: string;                   // what the basket holds: "$38.40", "at least $38.40"
  cost: string;                    // the trip's total
  count: string;                   // "7 of 12"
}

// The trip as the store sees it, with `ticked` (product ids) in the basket.
export function instoreView(trip: Trip, ticked: readonly number[]): InStoreView {
  const rows = shopRows(trip);
  const has = new Set(ticked);
  const inBasket = (r: ShopRow) => has.has(r.productId);
  const groups = storeGroups(rows, trip.stores);
  const ordered = groups.flatMap((g) => g.sections.flatMap((s) => s.rows));
  const basket = ordered.filter(inBasket);
  const known = basket.filter((r) => r.price !== null);
  const sum = known.reduce((t, r) => t + (r.price ?? 0), 0);
  const floor = basket.some((r) => r.price === null || r.priceFloor);
  return {
    day: dayLabel(trip.date), stores: trip.stores,
    toGet: storeGroups(rows.filter((r) => !inBasket(r)), trip.stores),
    basket, done: basket.length, total: rows.length,
    spent: !basket.length ? money(0) : known.length ? `${floor ? 'at least ' : ''}${money(sum)}` : 'price unknown',
    cost: costText(trip.total_cost, trip.total_is_floor, tripPriced(trip)),
    count: `${basket.length} of ${rows.length}`,
  };
}

// What a tick says to a screen reader: "Whole Milk 1L in the basket: 8 of 12, $41.33 so far."
export function tickedText(row: ShopRow, on: boolean, view: InStoreView): string {
  const where = on ? 'in the basket' : 'back on the list';
  const all = view.total > 0 && view.done === view.total ? ' Everything is in the basket.' : '';
  return `${row.name} ${where}: ${view.count}, ${view.spent} so far.${all}`;
}

// ─── A trip changed since it was approved ────────────────────

// The products the country rule now holds back, as the schedule names them (its origin_excluded
// warnings): planned before their evidence came in, they are bought on no trip.
export function heldProducts(sc: MealSchedule | null): Set<number> {
  const out = new Set<number>();
  for (const w of sc?.warnings ?? []) if (w.code === 'origin_excluded' && w.product_id !== null) out.add(w.product_id);
  return out;
}

// "A", "A and B", "A, B and C", or "A, B and 4 more" past three
const fewNames = (names: readonly string[]) =>
  (names.length <= 3 ? listOf(names) : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`);

// What changed on an approved trip since the shopper approved it, said over the list in the store,
// from pantry-api's diff against the list approved (TripDiff, by product and storage): "Boneless
// Skinless Chicken Breast 500g is no longer on it: your country rule now leaves it out." A product
// in `held` (heldProducts) is gone because of the rule, and the sentence says so. A product kept
// two ways (fridge and freezer) is named once; one that only moved from one to the other is kept
// another way, not gone and new. '' for a trip with no diff.
export function tripChangeText(trip: Trip, held: ReadonlySet<number>): string {
  const diff = trip.diff;
  if (!diff) return '';
  const addedIds = new Set(diff.added.map((x) => x.product_id));
  const removedIds = new Set(diff.removed.map((x) => x.product_id));
  const names = (xs: readonly TripDiffLine[], keep: (x: TripDiffLine) => boolean) =>
    [...new Set(xs.filter(keep).map((x) => x.name))];
  const ruled = names(diff.removed, (x) => !addedIds.has(x.product_id) && held.has(x.product_id));
  const gone = names(diff.removed, (x) => !addedIds.has(x.product_id) && !held.has(x.product_id));
  const fresh = names(diff.added, (x) => !removedIds.has(x.product_id));
  const moved = new Map(diff.added.filter((x) => removedIds.has(x.product_id)).map((x) => [x.product_id, x]));
  const is = (n: readonly string[]) => (n.length === 1 ? 'is' : 'are');
  const out: string[] = [];
  if (ruled.length) {
    out.push(`${fewNames(ruled)} ${is(ruled)} no longer on it: your country rule now leaves `
      + `${ruled.length === 1 ? 'it' : 'them'} out.`);
  }
  if (gone.length) out.push(`${fewNames(gone)} ${is(gone)} no longer on it.`);
  if (fresh.length) out.push(`${fewNames(fresh)} ${is(fresh)} new on it.`);
  for (const c of diff.changed) {
    out.push(typeof c.packs_before === 'number' && typeof c.packs_after === 'number'
      ? `${c.name}: ${plural(c.packs_after, 'pack', 'packs')} instead of ${c.packs_before}.`
      : `${c.name}: a different number of packs.`);
  }
  for (const m of moved.values()) out.push(`${m.name}: now kept in the ${m.storage}.`);
  return out.join(' ');
}

// ─── Check your plan ─────────────────────────────────────────

// The Shop stage opens by restating what the trips were made from, as GOV.UK's "check your
// answers" does before the last step: the diet and its allergies, the country rules, the total
// against the budget, the days, the stores and how to shop, each with a Change that goes back to
// where it is set. `change` finishes "Change" for a screen reader, which hears the link apart from
// its row ("Change the budget").
export interface CheckItem {
  key: 'diet' | 'countries' | 'budget' | 'days' | 'stores' | 'strategy';
  label: string;
  value: string;
  note: string;
  over: boolean;                   // the total is over the budget (the note says by how much)
  change: string;
}

const weeksText = (days: number) => (days === 7 ? '1 week' : days === 14 ? '2 weeks' : plural(days, 'day', 'days'));
const cents = (v: number) => Math.round(v * 100) / 100;

// "any day", "on weekdays", "at weekends", "on Mon, Wed and Sat"
function shopDaysText(days: readonly number[]): string {
  const t = weekdaysText(days);
  return t === 'Every day' ? 'any day' : t === 'Weekdays' ? 'on weekdays' : t === 'Weekends' ? 'at weekends' : `on ${t}`;
}

// The stores the trips go to, in the order they are first visited.
export function tripStores(st: StrategyResult | undefined): string[] {
  const out: string[] = [];
  for (const t of [...(st?.trips ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const s of t.stores) if (!out.includes(s)) out.push(s);
  }
  return out;
}

export function checkPlan(d: MealPlanDraft, st: StrategyResult | undefined, sc: MealSchedule | null): CheckItem[] {
  const p = d.prefs;
  const avoid = avoidOf(p);
  const budget = budgetOf(p);
  const trips = st?.trips ?? [];
  const anyPrice = trips.some(tripPriced);
  const total = trips.length && anyPrice ? st?.total_cost ?? null : null;
  const floor = Boolean(st?.total_is_floor);
  let value: string;
  let note: string;
  let over = false;
  if (!trips.length) {
    value = budget === null ? 'No budget' : `${money(budget)} budget`;
    note = 'no trips to add up yet';
  } else if (total === null) {
    value = 'Price unknown';
    note = budget === null ? 'no budget set' : `your budget is ${money(budget)}`;
  } else {
    value = `${floor ? 'at least ' : ''}${money(total)}`;
    if (budget === null) note = 'no budget set';
    else {
      const left = cents(budget - total);
      over = left < 0;
      note = over ? `${money(-left)} over your ${money(budget)} budget`
        : `${floor ? 'at most ' : ''}${money(left)} left of your ${money(budget)} budget`;
    }
  }
  const stores = tripStores(st);
  const km = d.settings.max_km;
  const other = sc?.strategies.find((s) => s.name !== p.strategy);
  const rules = countryRules(d.settings);
  return [
    { key: 'diet', label: 'Diet', value: DIET_LABELS[dietOf(p)],
      note: avoid.length ? `avoiding ${listOf(avoid.map((t) => AVOID_LABELS[t]))}` : 'no allergies set',
      over: false, change: 'the diet' },
    { key: 'countries', label: 'Countries', value: ruleText(rules), note: firstText(rules), over: false,
      change: 'where food comes from' },
    { key: 'budget', label: 'Total', value, note, over, change: 'the budget' },
    { key: 'days', label: 'Days', value: `${dayLabel(d.start_date)} – ${dayLabel(addDays(d.start_date, d.days - 1))}`,
      note: `${weeksText(d.days)} · you shop ${shopDaysText(p.shop_weekdays)}`, over: false, change: 'the dates' },
    { key: 'stores', label: 'Stores', value: stores.length ? listOf(stores) : 'None yet',
      note: `${km == null ? 'at any distance' : `within ${km} km`} of ${placeText(d.settings)}`,
      over: false, change: 'the stores' },
    { key: 'strategy', label: 'How to shop', value: STRATEGY_NAMES[p.strategy],
      note: st ? [plural(trips.length, 'trip', 'trips'),
        st.recommended ? 'recommended' : other?.recommended ? `${STRATEGY_NAMES[other.name]} is recommended` : '']
        .filter(Boolean).join(' · ') : 'trips not worked out yet',
      over: false, change: 'how to shop' },
  ];
}

// ─── How to shop: the two strategies as tiles ────────────────

// "2 must fix, 1 note", "no warnings"
export function warningCountsText(c: WarningCounts): string {
  return [c.must_fix && `${c.must_fix} must fix`, c.should_fix && `${c.should_fix} should fix`,
    c.decide && `${c.decide} to decide`, c.note && plural(c.note, 'note', 'notes')]
    .filter(Boolean).join(', ') || 'no warnings';
}

export interface StrategyTile {
  name: TripStrategy;
  label: string;                   // "Shop fresh"
  hint: string;                    // "4 trips · $214.44"
  extra: string;                   // "Recommended · 1 note", "$1.88 more · 1 note"
  recommended: boolean;
}

// Each strategy with what it comes to, and what it costs against the other when both totals
// are known exactly (an "at least" is no ground for "more" or "less"). approvals: the plan's
// approved trips. A way to shop other than the one a trip was approved under keeps that trip as it
// is (an approved list is never rewritten), so its figures move towards the other's as trips are
// approved: its tile says why, so it does not seem to have changed by itself.
export function strategyTiles(sc: MealSchedule, approvals: readonly ApprovedTrip[] = []): StrategyTile[] {
  const exact = (s: StrategyResult) =>
    (s.trips.some(tripPriced) && !s.total_is_floor && s.total_cost !== null ? s.total_cost : null);
  return sc.strategies.map((s) => {
    const other = sc.strategies.find((x) => x.name !== s.name);
    const mine = exact(s);
    const theirs = other ? exact(other) : null;
    const diff = mine !== null && theirs !== null ? cents(mine - theirs) : null;
    const vs = diff === null || s.recommended ? ''
      : diff === 0 ? 'the same total' : `${money(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'}`;
    const kept = approvals.filter((a) => a.strategy !== s.name).length;
    return {
      name: s.name, label: STRATEGY_NAMES[s.name], recommended: s.recommended,
      hint: `${plural(s.trips.length, 'trip', 'trips')} · ${costText(s.total_cost, s.total_is_floor, s.trips.some(tripPriced))}`,
      extra: [s.recommended ? 'Recommended' : '', vs,
        kept ? `keeps your ${plural(kept, 'approved trip', 'approved trips')} as ${kept === 1 ? 'it is' : 'they are'}` : '',
        warningCountsText(s.warning_counts)].filter(Boolean)
        .map((x, i) => (i === 0 ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join(' · '),
    };
  });
}
