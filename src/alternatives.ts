// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The words of a chat cart's Options dialog and of a swap, built from what pantry and the hub
// return. Nothing here works a fact out: a price, store, trip total or reason is shown as the
// ranking states it, and what the ranking does not know is said to be unknown, never zero.
import type {
  AlternativeRanking, AltReason, CartLine, CartSummary, PlanCardData, RankedAlternative,
} from './types.ts';

export const money = (v: number | null | undefined) =>
  (typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : 'price unknown');

// What the cart costs: the recommended trip's total, or the lines' when the plan chose no trip.
export function cartTotal(summary: CartSummary): number | null {
  const value = summary.trip ? summary.trip.total_cost : summary.total_cost;
  return typeof value === 'number' ? value : null;
}

// Every recipe line a purchase covers: a swap applies to all of them.
export const linesOf = (line: CartLine): number[] =>
  (line.line_no == null ? [] : [line.line_no, ...(line.also_lines ?? [])]);

// The shopper chose this purchase's product (the hub pins every line it covers).
export const isPinned = (line: CartLine, pinned: readonly number[] | undefined) =>
  !!pinned && linesOf(line).some((n) => pinned.includes(n));

// Where the cart buys the line and at what price: the trip's store when the plan chose a trip.
export function whereBought(line: CartLine): { store: string; price: number | null } {
  if (line.trip_store) return { store: line.trip_store, price: line.trip_price ?? line.price ?? null };
  return { store: line.store ?? '', price: line.price ?? null };
}

// The cart line's button name: what it opens, for which ingredient, and what the cart holds now
// ("See options for Garlic: now Fresh Garlic, $0.89 at Pantry Mart Downtown").
export function optionsLabel(line: CartLine, pinned: boolean): string {
  const { store, price } = whereBought(line);
  const now = `${line.product}, ${money(price)}${store ? ` at ${store}` : ''}`;
  return `See options for ${line.ingredient}: now ${now}${pinned ? ' (changed by you)' : ''}`;
}

// Names one line of one card in the page, so focus can find that line again after a swap has
// drawn the card anew under its new ref.
export const cartLineKey = (ref: number, lineNo: number) => `${ref}:${lineNo}`;

// The ranking as the dialog lays it out: the cart's pick on its own at the top, then the other
// rows in rank order under "Same ingredient" and "Not the same ingredient".
export function rowsOf(r: AlternativeRanking): {
  current: RankedAlternative | null; same: RankedAlternative[]; other: RankedAlternative[];
} {
  const rest = r.items.filter((it) => !it.current).sort((a, b) => a.rank - b.rank);
  return {
    current: r.items.find((it) => it.current) ?? null,
    same: rest.filter((it) => it.tier === 'same'),
    other: rest.filter((it) => it.tier !== 'same'),
  };
}

export const reasonOf = (item: RankedAlternative, code: string): AltReason | undefined =>
  item.reasons.find((x) => x.code === code);

// The reasons shown as chips on a row: what it is (match), where it is from (origin) and what
// shoppers say (rating). Price and trip have their own lines; every reason is under "All reasons".
export const chipReasons = (item: RankedAlternative): AltReason[] =>
  ['match', 'origin', 'rating'].flatMap((code) => reasonOf(item, code) ?? []);

// The row's price in bold, and the note under it. With the recipe's amount and the pack size
// known: what that amount costs. Otherwise the pack's price, with pantry's reason the amount was
// not compared ("Recipe gives no amount", "Pack in ml, recipe in g").
export function priceLine(item: RankedAlternative): { main: string; note: string } {
  const pack = reasonOf(item, 'pack')?.text ?? '';
  const packs = item.packs > 1 ? `; the cart buys ${item.packs}` : '';
  if (item.cost_for_need != null) {
    return { main: `For this recipe ${money(item.cost_for_need)}`,
             note: `${money(item.offer.price)} a pack${packs}${pack ? `. ${pack}` : ''}` };
  }
  return { main: `${money(item.offer.price)} a pack`,
           note: `Amount not compared${pack ? `: ${pack}` : ''}${packs}` };
}

export const unitPriceText = (item: RankedAlternative) =>
  (item.unit_price != null && item.unit_basis
    ? `${money(item.unit_price)} / ${item.unit_basis}` : 'unit price unknown');

// Where the offer is: the store and its distance, or the catalog price when the plan has no
// shopping location.
export function storeText(item: RankedAlternative): string {
  const o = item.offer;
  if (!o.store) return 'catalog price (the plan has no shopping location)';
  const km = o.distance_km != null ? `, ${o.distance_km.toFixed(1)} km` : '';
  return `${o.store}${km}${o.on_trip ? ' · on your trip' : ''}`;
}

// The other purchases a swap would send to another store.
export const movedText = (item: RankedAlternative): string[] =>
  (item.trip?.moved_items ?? []).map((m) => `${m.product} moves from ${m.from_store} to ${m.to_store}`);

export function needText(r: AlternativeRanking): string {
  return r.need ? `Your recipe needs ${r.need}.` : 'The recipe gives no amount for this line.';
}

export function coversText(r: AlternativeRanking): string {
  if (r.lines.length < 2) return '';
  const nums = r.lines.map(String);
  return `This purchase covers lines ${nums.slice(0, -1).join(', ')} and ${nums[nums.length - 1]};`
    + ' a choice here applies to all of them.';
}

// What the list does not show: rows past the limit, products sold only out of range.
export function footText(r: AlternativeRanking): string[] {
  const out: string[] = [];
  const more = r.total - r.items.length;
  if (more > 0) out.push(`+${more} more ranked below these`);
  if (r.unavailable > 0) out.push(`${r.unavailable} more not sold at a store in range`);
  return out;
}

// Why "Use this" cannot be pressed now, in the words the hub would refuse with; '' when it can.
export function swapBlocked(answering: boolean, target: string): string {
  if (target === 'gateway-sim') {
    return 'Cart changes need the pantry server; this conversation plans through the pantry-sim '
      + 'gateway.';
  }
  if (answering) return 'The assistant is answering; choose again when it finishes.';
  return '';
}

// The cards with the one at `oldRef` replaced by a swap's card; null when no card has that ref.
export function replaceCard(cards: readonly PlanCardData[], oldRef: number,
                            card: PlanCardData): PlanCardData[] | null {
  const at = cards.findIndex((c) => c.ref === oldRef);
  if (at < 0) return null;
  return cards.map((c, i) => (i === at ? card : c));
}

const lineFor = (summary: CartSummary, lineNo: number) =>
  (summary.lines ?? []).find((l) => linesOf(l).includes(lineNo));

// What a screen reader hears after a swap, from the two carts' own numbers:
// "Garlic now Fraser Farms Garlic 200g. Trip $41.20, was $41.70."
export function swapAnnouncement(before: CartSummary, after: CartSummary, lineNo: number): string {
  const line = lineFor(after, lineNo);
  const was = cartTotal(before);
  const now = cartTotal(after);
  const what = line ? `${line.ingredient} now ${line.product}.` : `Line ${lineNo} changed.`;
  const label = after.trip ? 'Trip' : 'Total';
  const change = was != null && now != null && was.toFixed(2) !== now.toFixed(2)
    ? `, was ${money(was)}` : '';
  return `${what} ${label} ${money(now)}${change}.`;
}

// The chat's line after a swap: whether the assistant still has to hear about it.
export const swapNotice = (note: string) => (note
  ? 'You changed the cart. The assistant sees the change with your next message.'
  : 'The cart is back to what the assistant last saw.');

// The chat's record of a change the next turn told the model about.
export function cartChangeText(e: { line_no: number; ingredient: string; recipe_name: string;
  from: { name: string }; to: { name: string }; undone: boolean;
  total_before: number | null; total_after: number | null }): string {
  const change = e.undone
    ? `back to the planner's pick, ${e.to.name} (was ${e.from.name})`
    : `${e.from.name} → ${e.to.name}`;
  const totals = e.total_before != null && e.total_before !== e.total_after
    ? `, total ${money(e.total_after)} (was ${money(e.total_before)})`
    : `, total ${money(e.total_after)}`;
  return `Told the assistant: line ${e.line_no} (${e.ingredient}) of ${e.recipe_name}: `
    + `${change}${totals}.`;
}
