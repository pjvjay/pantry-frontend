// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Options on a meal-plan trip line: the words around the chat cart's Options dialog when it is
// opened from a trip, and the edit a choice makes. pantry-api ranks the products for every
// recipe line the trip line's purchase covers (/mealplan/alternatives); choosing one pins it on
// each of those lines, as one undo step, and the plan is re-scheduled with no model call. Nothing
// here works a fact out: names, amounts and totals are shown as the server gave them.
//
// The wizard's Check ingredients stage opens the same dialog on an ingredient, with no trip: the
// ranking then covers every line in the plan that buys the product, with no trip cost, and the
// words say which recipes a choice changes rather than which trip. An ingredient the plan buys
// nothing for is asked by its recipe line instead (line mode, below): its rows are what could
// fill it, and when none can be chosen the sheet says why and offers the row's own answers.
import { dayLabel } from './dates.ts';
import type { PlanEdit } from './model.ts';
import { listOr, theCountry } from './origin.ts';
import { distanceLabel, kmText } from './stores.ts';
import type {
  AlternativeRanking, CoveredLine, HeldBack, MealPlanDraft, MealStores, OutOfReachRow, RankedAlternative, Trip,
  TripLine, TripLineOptions, TripLineOptionsRequest, TripStrategy,
} from '../types.ts';

const money = (v: number | null | undefined) =>
  (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : 'price unknown');

const listOf = (parts: string[]) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// The data attribute on a trip line's Options button, so focus can find the line again once a
// choice has redrawn the trip with another product: '2026-10-10:122', or 'plan:122' for an
// ingredient across the plan.
export const tripLineKey = (date: string | null | undefined, productId: number) => `${date ?? 'plan'}:${productId}`;

// The Options button's name: what it opens and what the line buys now, the way the chat cart's
// line says it ("Options for Table Salt 1kg: now 1 pack, $1.54 at Pantry Mart Downtown"). It
// starts with the button's visible word, so speech input can say it.
export function tripOptionsLabel(ln: TripLine): string {
  const packs = ln.packs === null ? 'amount unknown'
    : `${ln.packs} ${ln.packs === 1 ? 'pack' : 'packs'}`;
  const where = ln.store ? ` at ${ln.store}` : '';
  const stock = ln.stocked ? '' : '; no store in range sells it now';
  return `Options for ${ln.product.name}: now ${packs}, ${money(ln.price)}${where}${stock}`;
}

// The product a covered line ends up with after a choice: the one chosen, or with null (back to
// the planner's pick) the planner's own.
const productFor = (c: CoveredLine, productId: number | null) =>
  (productId === null ? c.planner_product_id : productId);

// The pins a choice makes, as one edit (so one Undo puts it all back): `productId` pinned on
// every recipe line the purchase covers, or with null each line back to the planner's pick. A
// pin equal to the planner's pick is no pin. null when the plan already has exactly this.
export function optionsEdit(lines: readonly CoveredLine[], productId: number | null,
  pins: MealPlanDraft['pins']): PlanEdit | null {
  const edits: PlanEdit[] = [];
  for (const c of lines) {
    const want = productFor(c, productId) === c.planner_product_id ? null : productId;
    const now = pins[c.recipe_key]?.[String(c.line_no)] ?? null;
    if (want !== now) {
      edits.push({ type: 'pinProduct', recipeKey: c.recipe_key, lineNo: c.line_no, productId: want });
    }
  }
  if (!edits.length) return null;
  return edits.length === 1 ? edits[0] : { type: 'batch', edits };
}

// Where focus goes after a choice: the trip line that now buys what was chosen (the first
// covered line's product when going back to the planner's picks).
export function chosenLineKey(o: TripLineOptions, productId: number | null): string {
  const first = o.lines[0];
  const pid = (first ? productFor(first, productId) : null) ?? o.product_id;
  return pid === null ? '' : tripLineKey(o.trip_date, pid);
}

// "Pepperoni Pizza (line 3) and Chicken Biryani (lines 7 and 9)"
export function coveredText(lines: readonly CoveredLine[]): string {
  const byTitle = new Map<string, number[]>();
  for (const c of lines) byTitle.set(c.title, [...(byTitle.get(c.title) ?? []), c.line_no]);
  return listOf([...byTitle.entries()].map(([title, nums]) =>
    `${title} (${nums.length === 1 ? 'line' : 'lines'} ${listOf(nums.map(String))})`));
}

// The dialog's description: which recipe lines the purchase is for and on which trip, what these
// meals need on it, and that a choice holds for every meal of those recipes. The header names
// the recipe and line, as the plan asks of the meal-plan context.
export function optionsDescription(o: TripLineOptions): string {
  const r = o.ranking;
  const date = o.trip_date ?? null;
  const need = r.need ? `These meals need ${r.need}${date ? ' on this trip' : ''}.`
    : (r.need_note ? `${r.need_note}.` : 'No amount is compared for this line.');
  const recipes = listOf([...new Set(o.lines.map((c) => c.title))]);
  if (!date) {
    return `For ${coveredText(o.lines)}. ${need} A choice here changes it in every ${recipes} `
      + 'meal in the plan.';
  }
  return `For ${coveredText(o.lines)}, bought on the ${dayLabel(date)} trip. ${need} `
    + `A choice here is used for every ${recipes} meal in the plan.`;
}

// Said above the rows when the line's own product can no longer be bought, so it has no row: no
// store in range sells it now, or the plan's country rule leaves it out (the shopper's own pick of
// a product whose evidence came in since, which pantry-api lists among what the rule holds back).
export function stockNotice(o: TripLineOptions): string {
  if (o.product_id === null) return '';
  const then = `Choose another product, or ${o.trip_date ? 'leave it off the trip' : 'skip this ingredient'}.`;
  const held = o.ranking.held_back.find((h) => h.product_id === o.product_id);
  if (held) {
    return `${o.product} is from ${theCountry(held.country)}${held.verbatim ? ` (${held.verbatim})` : ''}, `
      + `which your rule leaves out. ${then}`;
  }
  if (o.stocked) return '';
  return `${o.product} is no longer sold at a store in range. ${then}`;
}

// What a screen reader hears after a choice, from the two answers' own numbers:
// "Table Salt 1kg is now Sea Salt 500g on the Sat 10 Oct trip. Trip $118.20, was $118.83."
// Across the plan: "Table Salt 1kg is now Sea Salt 500g in Pepperoni Pizza and Chicken Biryani."
export function choiceAnnouncement(o: TripLineOptions, productName: string,
  before: Trip | undefined, after: Trip | undefined): string {
  if (!o.trip_date) {
    const recipes = listOf([...new Set(o.lines.map((c) => c.title))]);
    return o.product_id === null
      ? `${o.ranking.ingredient || o.lines[0]?.ingredient || 'The ingredient'}: ${productName} chosen in ${recipes}.`
      : `${o.product} is now ${productName} in ${recipes}.`;
  }
  const head = `${o.product} is now ${productName} on the ${dayLabel(o.trip_date)} trip.`;
  if (!after) return `${head} The trips changed: see the Shopping plan.`;
  const was = before?.total_cost ?? null;
  const now = after.total_cost;
  const change = was !== null && now !== null && was.toFixed(2) !== now.toFixed(2)
    ? `, was ${money(was)}` : '';
  return `${head} Trip ${after.total_is_floor && now !== null ? 'at least ' : ''}${money(now)}${change}.`;
}

// A schedule refusal of one of the shopper's pins (a product since held back, or no longer sold
// in range), as the edit that takes that pin off, and the button's words. null for any other
// refusal, or one that does not name the line.
export function pinFix(code: string | null, detail: unknown)
  : { edit: PlanEdit; label: string } | null {
  if (code !== 'pin_invalid' || typeof detail !== 'object' || detail === null) return null;
  const d = detail as { recipe_key?: unknown; line_no?: unknown };
  if (typeof d.recipe_key !== 'string' || typeof d.line_no !== 'number'
    || !Number.isInteger(d.line_no)) return null;
  return { edit: { type: 'pinProduct', recipeKey: d.recipe_key, lineNo: d.line_no, productId: null },
    label: 'Use the planner’s product for that line' };
}

// The same refusal in the shopper's words when the country rule is why: pantry-api's own ("… is
// held back by the origin rule: it is evidenced as United States (ingredients), which this plan
// excludes") reads as jargon. The line is named from the plan (its recipe's title, its
// ingredient). null for any other refusal, which is said as pantry-api said it.
export function heldPinText(code: string | null, detail: unknown, d: MealPlanDraft,
  title: (recipeKey: string) => string): string | null {
  if (code !== 'pin_invalid' || typeof detail !== 'object' || detail === null) return null;
  const x = detail as { recipe_key?: unknown; line_no?: unknown; unavailable_kind?: unknown };
  if (x.unavailable_kind !== 'origin_excluded') return null;
  const key = typeof x.recipe_key === 'string' && d.recipes[x.recipe_key] ? x.recipe_key : null;
  const ingredient = key ? d.resolved[key]?.lines.find((l) => l.line_no === x.line_no)?.name ?? '' : '';
  const where = key ? ` ${ingredient ? `for ${ingredient} ` : ''}in ${title(key)}` : '';
  const excluded = d.settings.exclude_origin ?? [];
  const from = excluded.length ? `from ${listOr(excluded.map(theCountry))}, which your rule leaves out`
    : 'from a country your rule leaves out';
  return `The product you chose${where} is ${from}, so the trips cannot be worked out. Choose another in Check `
    + 'ingredients, or use the planner’s product for that line.';
}

// ─── An ingredient with no product (line mode) ───────────────

// What the plan asks for: one product across the plan, or one recipe line with none.
export type OptionsAsk = { productId: number } | { line: { recipeKey: string; lineNo: number } };

export function optionsRequest(draft: MealPlanDraft, ask: OptionsAsk, tripDate: string | null,
  strategy: TripStrategy, limit: number): TripLineOptionsRequest {
  return {
    draft, ...(tripDate ? { trip_date: tripDate } : {}),
    ...('productId' in ask ? { product_id: ask.productId }
      : { line: { recipe_key: ask.line.recipeKey, line_no: ask.line.lineNo } }),
    strategy, limit,
  };
}

// The sheet's heading: "Options for Yellow Onion", or with no product "Options for Yellow Onion:
// nothing chosen yet".
export const optionsTitle = (ingredient: string, hasProduct: boolean): string =>
  `Options for ${ingredient}${hasProduct ? '' : ': nothing chosen yet'}`;

// A line's rows as the sheet shows them: those that can be chosen, those out of reach (sold only
// at stores turned off, only beyond the distance, or nowhere), and those the origin rule holds
// back.
export function lineChoices(r: AlternativeRanking): { choosable: RankedAlternative[]; outOfReach: OutOfReachRow[];
  held: HeldBack[] } {
  return { choosable: r.items, outOfReach: r.out_of_reach ?? [], held: r.held_back };
}

// Why a row is out of reach: "Only at GreenLeaf Grocers Kitsilano, which you turned off", "Only
// beyond your 5 km", "No store stocks it".
export function reachText(x: OutOfReachRow, maxKm: number | null | undefined): string {
  if (x.why === 'stores_off') {
    const n = x.stores.length;
    return `Only at ${n ? listOf(x.stores) : 'stores'}, which you turned off`;
  }
  if (x.why === 'out_of_range') return `Only beyond your ${maxKm == null ? 'distance' : distanceLabel(maxKm)}`;
  return 'No store stocks it';
}

// Its nearest offer: "$8.99 at MegaSave Richmond, 14 km away"; '' with none.
export function nearestText(x: OutOfReachRow): string {
  const n = x.nearest;
  if (!n) return '';
  return `${money(n.price)} at ${n.store}${n.distance_km !== null ? `, ${kmText(n.distance_km)} away` : ''}`;
}

// The stores "Turn it back on" means: those it is sold at that the shopper turned off, by name.
export function storesToTurnOn(x: OutOfReachRow, stores: MealStores | null): { id: number; name: string }[] {
  if (x.why !== 'stores_off') return [];
  return (stores?.stores ?? []).filter((s) => s.off && x.stores.includes(s.name)).map((s) => ({ id: s.id, name: s.name }));
}

// Said when nothing can be chosen: what there is, and what can be done, in the row's own words.
export function nothingText(ingredient: string, c: { outOfReach: OutOfReachRow[]; held: HeldBack[] }): string {
  const why = [
    c.outOfReach.some((x) => x.why === 'stores_off') ? 'sold only at stores you turned off' : '',
    c.outOfReach.some((x) => x.why === 'out_of_range') ? 'sold only beyond your distance' : '',
    c.outOfReach.some((x) => x.why === 'not_stocked') ? 'stocked at no store' : '',
    c.held.length ? 'held back by your origin rule' : '',
  ].filter(Boolean);
  const or = why.length < 2 ? why.join('') : `${why.slice(0, -1).join(', ')} or ${why[why.length - 1]}`;
  const what = why.length ? `every product for it is ${or} (below)` : 'no store in reach sells a product for it';
  return `Nothing can be chosen for ${ingredient} as your plan stands: ${what}. Go back to Pick meals for other `
    + 'recipes, or skip it.';
}
