// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Options on a meal-plan trip line: the words around the chat cart's Options dialog when it is
// opened from a trip, and the edit a choice makes. pantry-api ranks the products for every
// recipe line the trip line's purchase covers (/mealplan/alternatives); choosing one pins it on
// each of those lines, as one undo step, and the plan is re-scheduled with no model call. Nothing
// here works a fact out: names, amounts and totals are shown as the server gave them.
import { dayLabel } from './dates.ts';
import type { PlanEdit } from './model.ts';
import type { CoveredLine, MealPlanDraft, Trip, TripLine, TripLineOptions } from '../types.ts';

const money = (v: number | null | undefined) =>
  (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : 'price unknown');

const listOf = (parts: string[]) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// The data attribute on a trip line's Options button, so focus can find the line again once a
// choice has redrawn the trip with another product: '2026-10-10:122'.
export const tripLineKey = (date: string, productId: number) => `${date}:${productId}`;

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
  const pid = first ? productFor(first, productId) : null;
  return tripLineKey(o.trip_date, pid ?? o.product_id);
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
  const need = r.need ? `These meals need ${r.need} on this trip.`
    : (r.need_note ? `${r.need_note}.` : 'No amount is compared for this line.');
  const recipes = listOf([...new Set(o.lines.map((c) => c.title))]);
  return `For ${coveredText(o.lines)}, bought on the ${dayLabel(o.trip_date)} trip. ${need} `
    + `A choice here is used for every ${recipes} meal in the plan.`;
}

// Said above the rows when the line's own product can no longer be bought, so it has no row.
export function stockNotice(o: TripLineOptions): string {
  return o.stocked ? ''
    : `${o.product} is no longer sold at a store in range. Choose another product, or leave it `
      + 'off the trip.';
}

// What a screen reader hears after a choice, from the two answers' own numbers:
// "Table Salt 1kg is now Sea Salt 500g on the Sat 10 Oct trip. Trip $118.20, was $118.83."
export function choiceAnnouncement(o: TripLineOptions, productName: string,
  before: Trip | undefined, after: Trip | undefined): string {
  const head = `${o.product} is now ${productName} on the ${dayLabel(o.trip_date)} trip.`;
  if (!after) return `${head} The trips changed: see the Shop band.`;
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
