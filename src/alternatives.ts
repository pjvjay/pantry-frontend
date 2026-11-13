// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The words of a chat cart's Options dialog and of a swap, built from what pantry and the hub
// return. Nothing here works a fact out: a price, store, trip total or reason is shown as the
// ranking states it, and what the ranking does not know is said to be unknown, never zero.
import { countryRules, originTag } from './mealplan/origin.ts';
import type { CountryRules } from './mealplan/origin.ts';
import type {
  AlternativeRanking, AltOrigin, AltReason, BasketOrigin, CartLine, CartSummary, FilteredProduct, HeldBack, MatchGroup,
  PlanCardData, RankedAlternative,
} from './types.ts';

// A product's name with its size, unless the name already says it: "Jasmine Rice 2kg", never
// "Jasmine Rice 2kg 2kg". Case and spaces are ignored ("500 ml" is in "Soy Sauce 500ml").
const squash = (t: string) => t.toLowerCase().replace(/\s+/g, '');
export const sizeInName = (name: string, size: string | null | undefined): boolean =>
  !size || squash(name).includes(squash(size));
export const nameWithSize = (name: string, size: string | null | undefined): string =>
  (sizeInName(name, size) ? name : `${name} ${size}`);

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

// The notes under a cart line's name, as the cart shows them: where the product is from, and the
// planner's own doubts about the pick. `flag` marks a warning; `title` is the longer wording a
// pointer shows; `origin` marks the note that says the origin is not known, which the cart draws
// as a mark with these same words. Sources that disagree make the origin unclear; none at all,
// unknown. Either way the plan asked about origin, so the label is worth a look.
export type LineNote = { text: string; flag: boolean; title?: string; origin?: boolean };

export function lineNotes(line: CartLine, originAsked: boolean): LineNote[] {
  const out: LineNote[] = [];
  if (line.origin_country) out.push({ text: line.origin_country, flag: false });
  else if (originAsked) {
    out.push({ text: `Origin ${line.origin_status === 'conflicting' ? 'unclear' : 'unknown'}: check the label`,
               flag: true, origin: true, title: `origin ${line.origin_status ?? 'unknown'}` });
  }
  if (line.match && line.match !== 'exact') out.push({ text: 'closest match', flag: true });
  // a meal-plan trip line: which meals it is for, and an amount or price it does not know
  if (line.note) out.push({ text: line.note, flag: false });
  if (line.warn) out.push({ text: line.warn, flag: true });
  if (line.confidence != null && line.confidence < 0.85) {
    out.push({ text: 'check this pick', flag: true,
               title: `the planner is ${Math.round(line.confidence * 100)}% sure of this pick` });
  }
  return out;
}

// The cart line's button name: what it opens, for which ingredient, what the cart holds now, and
// the line's notes ("See options for Garlic: now Fresh Garlic, $0.89 at Pantry Mart Downtown;
// closest match"). A button's name is all a screen reader says of it, so the notes drawn inside
// it are repeated here, in the order they are drawn.
export function optionsLabel(line: CartLine, pinned: boolean, originAsked = false): string {
  const { store, price } = whereBought(line);
  const packs = (line.packs ?? 1) > 1 ? ` ×${line.packs}` : '';
  const now = `${line.product}${packs}, ${money(price)}${store ? ` at ${store}` : ''}`;
  const notes = lineNotes(line, originAsked).map((n) => n.text);
  return `See options for ${line.ingredient}: now ${now}${pinned ? ' (changed by you)' : ''}`
    + (notes.length ? `; ${notes.join(', ')}` : '');
}

// Names one line of one card in the page, so focus can find that line again after a swap has
// drawn the card anew under its new ref.
export const cartLineKey = (ref: number, lineNo: number) => `${ref}:${lineNo}`;

// ─── Matching by meaning ─────────────────────────────────────
// pantry matches a line's products by meaning and puts each row in a group, as Amazon's ESCI
// labels do: the same item, one that works instead, or a looser match by meaning alone. The
// dialog shows the rows under those groups; an older pantry gives only `tier`, and then the rows
// are under "Same ingredient" and "Not the same ingredient", as before.

export const GROUP_ORDER: readonly MatchGroup[] = ['same_item', 'works_instead', 'looser_match', 'outside'];
export const GROUP_LABELS: Record<MatchGroup, string> = {
  same_item: 'Same item', works_instead: 'Works instead', looser_match: 'Looser match', outside: 'Not a candidate',
};

// tone: how a group's heading is drawn; 'other' is in --warn, as "Not the same ingredient" was.
export interface RowGroup {
  key: string;
  label: string;
  tone: 'same' | 'instead' | 'other';
  items: RankedAlternative[];
}

const TONES: Record<MatchGroup, RowGroup['tone']> = {
  same_item: 'same', works_instead: 'instead', looser_match: 'other', outside: 'other',
};

// The cart's pick on its own, and the other rows in rank order under their groups: pantry's
// (named by its group_label when it gives one) when the rows have them, else the old tiers.
// Groups with no rows are left out.
export function rowGroups(r: AlternativeRanking): { current: RankedAlternative | null; groups: RowGroup[];
  byMeaning: boolean } {
  const current = r.items.find((it) => it.current) ?? null;
  const rest = r.items.filter((it) => !it.current).sort((a, b) => a.rank - b.rank);
  const byMeaning = r.items.some((it) => it.group != null);
  const groups: RowGroup[] = byMeaning
    ? GROUP_ORDER.map((g) => {
      const items = rest.filter((it) => (it.group ?? 'outside') === g);
      const label = items.find((it) => it.group_label?.trim())?.group_label?.trim() ?? GROUP_LABELS[g];
      return { key: g, label, tone: TONES[g], items };
    })
    : [{ key: 'same', label: 'Same ingredient', tone: 'same', items: rest.filter((it) => it.tier === 'same') },
      { key: 'other', label: 'Not the same ingredient', tone: 'other', items: rest.filter((it) => it.tier !== 'same') }];
  return { current, groups: groups.filter((g) => g.items.length > 0), byMeaning };
}

// A row's match grade, worn on the row as a tag with a glyph, so how sure the match is reads in
// words wherever the row is: its group (pantry's own name for it when it gives one), or with an
// older pantry its tier. kind picks the glyph: a tick for the same item, two arrows for one that
// works instead, ≈ for a looser match, and a bar for the cart's pick that is no candidate at all.
export type GradeKind = 'same' | 'instead' | 'looser' | 'outside';

const GRADE_OF: Record<MatchGroup, GradeKind> = {
  same_item: 'same', works_instead: 'instead', looser_match: 'looser', outside: 'outside',
};

export function rowGrade(item: Pick<RankedAlternative, 'group' | 'group_label' | 'tier'>): { kind: GradeKind; label: string } {
  if (item.group) return { kind: GRADE_OF[item.group], label: item.group_label?.trim() || GROUP_LABELS[item.group] };
  if (item.tier === 'same') return { kind: 'same', label: 'Same ingredient' };
  if (item.tier === 'other') return { kind: 'looser', label: 'Not the same ingredient' };
  return { kind: 'outside', label: GROUP_LABELS.outside };
}

// A row's origin in the basket's terms (BasketOrigin, as pantry-api words it for a basket line), so
// its tag reads as Check ingredients' rows do (mealplan/origin.ts): a country only when the evidence
// resolved, "Made in" for a processing claim, sources that disagree, or nothing known.
export function altBasketOrigin(o: AltOrigin): BasketOrigin {
  const country = o.status === 'resolved' && o.country ? o.country : null;
  if (o.status === 'conflicting') {
    return { country: null, claim: 'Origin unclear: sources disagree', status: 'conflicting', preferred_rank: null };
  }
  if (!country) return { country: null, claim: 'Origin unknown', status: 'unknown', preferred_rank: null };
  return { country, claim: o.claim === 'processing' ? `Made in ${country}, ingredients may be imported` : `From ${country}`,
    status: 'evidenced', preferred_rank: null };
}

// A product the plan's country rule holds back, in the same terms, so its tag names the country its
// evidence matched, against the rule: made there for a processing claim, from there otherwise.
// Sources that disagree are said beside the tag (the row's own words), not by it.
export function heldOrigin(h: HeldBack): BasketOrigin {
  const made = h.field === 'manufactured_in' || /^made in /i.test(h.verbatim.trim());
  return { country: h.country, claim: `${made ? 'Made in' : 'From'} ${h.country}`, status: 'evidenced', preferred_rank: null };
}

// ─── Compare with your pick ──────────────────────────────────
// The plan's pick beside the two best other rows, attribute by attribute, as a comparison table
// reads (NN/g): what a pack costs, the price per unit, the pack's size, where it is sold, where it
// is from and how close a match it is. Nothing is left blank: what pantry does not know says so.
// Where it is from is said in the words of the rows' origin tags below the table, measured against
// the plan's country rules (rules; none for a chat's cart), so the sheet says one thing of it.

export interface CompareColumn {
  productId: number;
  name: string;                    // the product, with its size unless the name says it
  yours: boolean;                  // the plan's pick
  grade: { kind: GradeKind; label: string };
  price: string;                   // "$0.68 a pack", "$2.56 a pack · 2 packs"
  unit: string;                    // "$1.36 / 100 g", "unknown"
  size: string;                    // "~50g", "unknown"
  store: string;                   // "Pantry Mart Downtown, 0.3 km", "catalog price"
  origin: string;                  // "Canada · preferred", "Origin unknown: check the label"
}

export const COMPARE_ROWS: readonly { key: 'price' | 'unit' | 'size' | 'store' | 'origin'; label: string }[] = [
  { key: 'price', label: 'Price' }, { key: 'unit', label: 'Unit price' }, { key: 'size', label: 'Size' },
  { key: 'store', label: 'Store' }, { key: 'origin', label: 'Origin' },
];

function compareColumn(it: RankedAlternative, rules: CountryRules): CompareColumn {
  // The store the price is from: where the row's trip buys it, as packPrice prices it, else the
  // cheapest offer in range. The two differ when the best trip skips the cheapest store (a cart in
  // Ask, often), and one store's name beside another store's price would be untrue.
  const at = it.trip?.buys_at ?? it.offer;
  return {
    productId: it.product_id, name: nameWithSize(it.product, it.size), yours: it.current, grade: rowGrade(it),
    price: `${money(packPrice(it))} a pack${it.packs > 1 ? ` · ${it.packs} packs` : ''}`,
    unit: it.unit_price != null && it.unit_basis ? `${money(it.unit_price)} / ${it.unit_basis}` : 'unknown',
    size: it.size?.trim() || 'unknown',
    store: at.store ? `${at.store}${at.distance_km != null ? `, ${at.distance_km.toFixed(1)} km` : ''}` : 'catalog price',
    origin: originTag(altBasketOrigin(it.origin), rules).words,
  };
}

// The plan's pick first, then the best-ranked others, `size` columns at most. With no pick (a line
// with nothing chosen yet) the best rows alone. Fewer than two columns compare nothing: none.
export function compareColumns(r: AlternativeRanking, rules: CountryRules = countryRules(null), size = 3): CompareColumn[] {
  const current = r.items.find((it) => it.current) ?? null;
  const rest = r.items.filter((it) => !it.current).sort((a, b) => a.rank - b.rank);
  const cols = [...(current ? [current] : []), ...rest].slice(0, size).map((it) => compareColumn(it, rules));
  return cols.length >= 2 ? cols : [];
}

// The note under the dialog's heading: matched by meaning, or by words while the meaning model
// is off, with pantry's own why (its note's "Matched by words:" is not said twice). null from an
// older pantry, which does not say.
export function matchingNote(r: AlternativeRanking): { mode: 'meaning' | 'words'; text: string } | null {
  if (r.matching === 'meaning') return { mode: 'meaning', text: 'Matched by meaning' };
  if (r.matching !== 'words') return null;
  const why = (r.matching_note ?? '').trim().replace(/^matched by words[:.]?\s*/i, '');
  const more = why ? ` ${why.charAt(0).toUpperCase()}${why.slice(1)}` : '';
  return { mode: 'words', text: `Matched by words: the meaning model is off.${more}` };
}

// What a hard rule keeps out, each with why in words: pantry's text, else from its reason.
export function notOffered(r: AlternativeRanking): { item: FilteredProduct; text: string }[] {
  return (r.filtered ?? []).map((item) => {
    const tags = item.tags.length ? item.tags.join(', ') : '';
    const fallback = item.why === 'adds_tags' ? `adds ${tags || 'something your product does not have'}`
      : item.why === 'diet' ? `breaks your diet${tags ? ` (${tags})` : ''}` : 'outside your plan’s rules';
    return { item, text: item.text.trim() || fallback };
  });
}

export const reasonOf = (item: RankedAlternative, code: string): AltReason | undefined =>
  item.reasons.find((x) => x.code === code);

// The reasons shown as chips on a row: what it is (match), where it is from (origin) and what
// shoppers say (rating). Price and trip have their own lines; every reason is under "All reasons".
export const chipReasons = (item: RankedAlternative): AltReason[] =>
  ['match', 'origin', 'rating'].flatMap((code) => reasonOf(item, code) ?? []);

// A row's reasons line: pantry's one-line summary when it gives one (then no chips), else the
// chips.
export function reasonsLine(item: RankedAlternative): { summary: string | null; chips: AltReason[] } {
  const summary = item.summary?.trim() || null;
  return { summary, chips: summary ? [] : chipReasons(item) };
}

// What a pack costs the cart if the shopper chooses the row: the price where the row's trip buys
// it (pantry's buys_at), which is what the re-priced cart charges, or the offer's when the trip
// was not worked out (or the plan has no shopping location).
export const packPrice = (item: RankedAlternative): number =>
  item.trip?.buys_at?.price ?? item.offer.price;

// The row's price in bold, and the note under it. With the recipe's amount and the pack size
// known: what that amount costs (pantry prices it as packPrice does). Otherwise the pack's price,
// with pantry's reason the amount was not compared ("Recipe gives no amount", "Pack in ml, recipe
// in g"). `buyer` is who buys the packs: the cart, or a meal plan's trip.
export function priceLine(item: RankedAlternative, buyer = 'the cart'): { main: string; note: string } {
  const pack = reasonOf(item, 'pack')?.text ?? '';
  const packs = item.packs > 1 ? `; ${buyer} buys ${item.packs}` : '';
  if (item.cost_for_need != null) {
    return { main: `For this recipe ${money(item.cost_for_need)}`,
             note: `${money(packPrice(item))} a pack${packs}${pack ? `. ${pack}` : ''}` };
  }
  return { main: `${money(packPrice(item))} a pack`,
           note: `Amount not compared${pack ? `: ${pack}` : ''}${packs}` };
}

export const unitPriceText = (item: RankedAlternative) =>
  (item.unit_price != null && item.unit_basis
    ? `${money(item.unit_price)} / ${item.unit_basis}` : 'unit price unknown');

const listOf = (names: string[]) => (names.length < 2 ? names.join('')
  : `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`);

const kmText = (km: number | null | undefined) => (km != null ? `, ${km.toFixed(1)} km` : '');

// Where the cart would buy the row's product, or the catalog price when the plan has no shopping
// location. The offer is the lowest price in range, but the trip re-optimised with this product
// may not stop there (a second stop can cost more than it saves): then the row names the store the
// trip buys it at, whose price packPrice shows, and quotes the lowest price as the trip's to skip,
// so the cart's price after "Use this" is the one the row showed. A row whose trip was not worked
// out shows the offer as what it is, the lowest price in range.
export function storeText(item: RankedAlternative): string {
  const o = item.offer;
  if (!o.store) return 'catalog price (the plan has no shopping location)';
  const lowest = `${o.store}${kmText(o.distance_km)}`;
  const buys = item.trip?.buys_at;
  if (buys && buys.store !== o.store) {
    return `${buys.store}${kmText(buys.distance_km)}, where your best trip buys it (lowest price `
      + `in range: ${money(o.price)} at ${lowest})`;
  }
  const stops = item.trip?.stores ?? [];
  if (!item.trip) return `${lowest} · lowest price in range`;
  if (!buys && stops.length > 0 && !stops.includes(o.store)) {
    // an older pantry, without buys_at: the store is known, its price is not
    return `Lowest price at ${lowest}; your best trip buys it at ${listOf(stops)} instead`;
  }
  return `${lowest}${o.on_trip ? ' · on your trip' : ''}`;
}

// The other purchases a swap would send to another store.
export const movedText = (item: RankedAlternative): string[] =>
  (item.trip?.moved_items ?? []).map((m) => `${m.product} moves from ${m.from_store} to ${m.to_store}`);

// The recipe's amount for the line, or pantry's reason there is none to compare packs with. A
// library recipe is planned without amounts, so "the recipe gives none" would be untrue there;
// an older pantry gives no reason, and the line then claims none.
export function needText(r: AlternativeRanking): string {
  if (r.need) return `Your recipe needs ${r.need}.`;
  return r.need_note ? `${r.need_note}.` : 'No amount is compared for this line.';
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

// The links a card offers that this console can follow: in-page routes (`#/<place>...`) whose
// first segment is one it has (`routes`: routes.ts ROUTE_IDS, today's places and the old tab
// names the shell rewrites, so `#/mealplan?step=4` and `#/plan?step=4` both count). A console
// without the place would land on Home instead, so such a link is not drawn.
export function routedLinks(links: readonly { label: string; href: string }[],
                            routes: readonly string[]): { label: string; href: string }[] {
  return links.filter((l) => {
    const tab = /^#\/([^?#/]+)/.exec(l.href)?.[1];
    return tab != null && routes.includes(tab);
  });
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

// The cart line that holds recipe line `lineNo`: its own, or the purchase it joined. Choosing a
// product another line already buys makes one purchase, numbered by the lower line, so after
// such a swap the line the shopper chose from has no element of its own and focus goes there.
export const purchaseLineNo = (summary: CartSummary, lineNo: number): number =>
  lineFor(summary, lineNo)?.line_no ?? lineNo;

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

// Under a turn's carts once the shopper has changed one of them: the assistant's sentences above
// were written for the cart it planned, and stay as written, so their figures may be the old
// ones. Pins mark the change; an undo removes them, and with them this line. '' when unchanged.
export const replyBeforeChange = (plans: readonly PlanCardData[]) =>
  (plans.some((c) => (c.pinned_lines?.length ?? 0) > 0)
    ? 'The sentences above describe the cart before your change.' : '');

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
