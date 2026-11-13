// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Where the plan's food comes from, in the shopper's words, on every screen that shows a product.
// Two things are said, and kept apart:
//   - the plan's country rules (Set up's "Where food comes from"): the countries it leaves out,
//     which is a hard rule, and the countries it prefers, which is only an order (Canada first by
//     default, model.ts);
//   - what each product's evidence says (pantry-api's BasketOrigin, the same on a basket line and
//     a trip line): a country, a country it was made in from ingredients that may come from
//     elsewhere, sources that disagree, or nothing at all.
// The origin is the product's own label claim ("Product of", "Made in", where its ingredients come
// from), never who owns the brand.
//
// The rule can leave out only what the evidence says is from a country it excludes. Most products
// say nothing, so they stay in the plan, and while the plan excludes a country each of them is
// flagged "Origin unknown: check the label"; with nothing excluded, not knowing is no reason to
// look. Sources that disagree always ask for the label.
//
// The words here: the plan's rules in a few words (ruleText, firstText, preferenceText); a
// product's origin tag (originTag, drawn by components/matchmarks.tsx OriginTag); the products
// found, counted by country (originTally, tallyText); what the rule did and what it cannot do
// (ruleDid, coveredText); what it left out of one line ("Instead of …": insteadOf) and why a
// line cannot be bought at all (excludedText); and the labels a list asks the shopper to read
// (listOriginText).
import type { BasketOrigin, HeldBackProduct, PlanSettings } from '../types.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "A", "A or B", "A, B or C"
export const listOr = (parts: readonly string[]): string => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} or ${parts[parts.length - 1]}`);

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

// The countries English names with "the" before them.
const WITH_THE = new RegExp('^(united |netherlands$|philippines$|bahamas$|gambia$|maldives$|comoros$|seychelles$'
  + '|czech republic$|dominican republic$|central african republic$|democratic republic|isle of man$)|islands$', 'i');

// A country as a sentence says it: "the United States", "the Netherlands", "Canada".
export const theCountry = (c: string): string => (WITH_THE.test(c.trim()) ? `the ${c.trim()}` : c.trim());

// ─── The plan's rules ────────────────────────────────────────

export interface CountryRules {
  excluded: string[];              // the countries the plan leaves out: a hard rule
  preferred: string[];             // the countries it prefers, in order: only an order
  first: string | null;            // the first of them
}

export function countryRules(st: PlanSettings | null | undefined): CountryRules {
  const clean = (xs: readonly string[] | undefined) => [...new Set((xs ?? []).map((c) => c.trim()).filter(Boolean))];
  const preferred = clean(st?.preference);
  return { excluded: clean(st?.exclude_origin), preferred, first: preferred[0] ?? null };
}

// Whether the plan says anything about countries at all.
export const hasRules = (r: CountryRules): boolean => r.excluded.length > 0 || r.preferred.length > 0;

const excludes = (r: CountryRules, country: string | null | undefined): boolean => r.excluded.some((c) => same(c, country));

// The rule, as the setup strip and the lists head it: "No US products" for the default (the words
// shoppers use), "No products from China", "No products from the United States or China", and
// "Any country" when nothing is left out.
export function ruleText(r: CountryRules): string {
  if (!r.excluded.length) return 'Any country';
  if (r.excluded.length === 1 && same(r.excluded[0], 'United States')) return 'No US products';
  return `No products from ${listOr(r.excluded.map(theCountry))}`;
}

// The preference in two words: "Canada first", or "no preference".
export const firstText = (r: CountryRules): string => (r.first ? `${r.first} first` : 'no preference');

// The whole order, for Set up's summary: "Canada first, then 15 more".
export function preferenceText(r: CountryRules): string {
  const more = r.preferred.length - 1;
  return more > 0 ? `${firstText(r)}, then ${more} more` : firstText(r);
}

// ─── A product's origin ──────────────────────────────────────

// preferred: from the plan's first country; country: from another one; made: made there from
// ingredients that may be imported (a processing claim); excluded: from a country the plan leaves
// out (a product planned before that evidence came in); unclear: the sources disagree; unknown: no
// source says.
export type OriginKind = 'preferred' | 'country' | 'made' | 'excluded' | 'unclear' | 'unknown';

export interface OriginWords {
  kind: OriginKind;
  country: string;                 // the country the evidence names, '' when none
  lead: string;                    // said before the words to a screen reader: "From "
  text: string;                    // "Canada", "Made in Canada", "Origin unknown"
  note: string;                    // "preferred", "ingredients may be imported", "check the label", ''
  words: string;                   // the tag: "Canada · preferred", "Origin unknown: check the label"
  label: string;                   // all of it as a sentence, for the tag's title
  check: boolean;                  // read the label in the store
}

// pantry-api words a processing claim "Made in Canada, ingredients may be imported".
const MADE = /^made in /i;

function tag(kind: OriginKind, t: { country?: string; lead?: string; text: string; note?: string; label: string;
  check?: boolean }): OriginWords {
  const note = t.note ?? '';
  const sep = kind === 'unclear' || kind === 'unknown' ? ': ' : ' · ';
  return { kind, country: t.country ?? '', lead: t.lead ?? '', text: t.text, note,
    words: note ? `${t.text}${sep}${note}` : t.text, label: t.label, check: t.check ?? false };
}

// A product's origin as its tag says it, measured against the plan's rules.
export function originTag(o: BasketOrigin, r: CountryRules): OriginWords {
  if (o.status === 'conflicting') {
    return tag('unclear', { text: 'Origin unclear', note: 'check the label', check: true,
      label: 'Origin unclear: the sources disagree, so check the label' });
  }
  const country = o.status === 'evidenced' && o.country ? o.country.trim() : '';
  if (!country) {
    return r.excluded.length
      ? tag('unknown', { text: 'Origin unknown', note: 'check the label', check: true,
        label: 'Origin unknown: no source says, so check the label' })
      : tag('unknown', { text: 'Origin unknown', label: 'Origin unknown: no source says where it comes from' });
  }
  const made = MADE.test(o.claim.trim());
  const text = made ? `Made in ${theCountry(country)}` : country;
  const lead = made ? '' : 'From ';
  const where = `${made ? 'Made in' : 'From'} ${theCountry(country)}`;
  if (excludes(r, country)) {
    return tag('excluded', { country, lead, text, note: 'your rule leaves it out',
      label: `${where}, which your rule leaves out` });
  }
  if (made) {
    return tag('made', { country, text, note: 'ingredients may be imported',
      label: `${where}; its ingredients may be imported` });
  }
  if (same(country, r.first)) {
    return tag('preferred', { country, lead, text, note: 'preferred', label: `${where}, your first preference` });
  }
  return tag('country', { country, lead, text, label: where });
}

// The same where pantry-api may have said nothing of it (an older API's trip line): null then.
export const originWords = (o: BasketOrigin | null | undefined, r: CountryRules): OriginWords | null =>
  (o ? originTag(o, r) : null);

// ─── The products found, by country ──────────────────────────

export interface OriginTally {
  told: boolean;                   // pantry-api said where the products come from (an older one did not)
  products: number;                // the products counted, each once
  countries: { country: string; n: number }[];   // the evidenced ones, most first
  unknown: number;                 // no country: no source says, or the sources disagree
}

// Each product once, however many lines buy it. Items pantry-api said nothing of are left out,
// and `told` is false when it said nothing of any.
export function originTally(items: Iterable<{ id: number; origin?: BasketOrigin | null }>, r: CountryRules): OriginTally {
  const seen = new Map<number, BasketOrigin>();
  for (const it of items) if (it.origin && !seen.has(it.id)) seen.set(it.id, it.origin);
  const by = new Map<string, number>();
  let unknown = 0;
  for (const o of seen.values()) {
    const country = o.status === 'evidenced' && o.country ? o.country.trim() : '';
    if (country) by.set(country, (by.get(country) ?? 0) + 1);
    else unknown += 1;
  }
  // most first; a tie in the plan's order of preference, then by name
  const rank = (c: string) => {
    const i = r.preferred.findIndex((p) => same(p, c));
    return i === -1 ? r.preferred.length : i;
  };
  const countries = [...by.entries()].map(([country, n]) => ({ country, n }))
    .sort((a, b) => b.n - a.n || rank(a.country) - rank(b.country) || a.country.localeCompare(b.country, 'en'));
  return { told: seen.size > 0, products: seen.size, countries, unknown };
}

// "Canada 7 · Italy 2 · Mexico 2 · India 1 · 5 unknown: check the label"; '' when nothing was said.
// Each count keeps to its word (a no-break space), so a narrow line never leaves a number alone.
export function tallyText(t: OriginTally, r: CountryRules): string {
  if (!t.told) return '';
  const unknown = t.unknown ? `${t.unknown}\u00a0unknown${r.excluded.length ? ': check the label' : ''}` : '';
  return [...t.countries.map((c) => `${c.country}\u00a0${c.n}`), unknown].filter(Boolean).join(' · ');
}

// ─── What the rule did ───────────────────────────────────────

// The first line of Check ingredients' origin summary: the rule, and what it did across the whole
// basket ("No US products", "your rule left out 6 products"). heldBack: origin_held_back, absent
// from an older API, when the rule alone is said: nothing is claimed from a count that never came.
// Preferences alone: "Any country", "Canada first". null when the plan has no rules.
export function ruleDid(r: CountryRules, heldBack: number | undefined): { rule: string; did: string } | null {
  if (!hasRules(r)) return null;
  const rule = ruleText(r);
  if (!r.excluded.length) return { rule, did: firstText(r) };
  if (heldBack === undefined) return { rule, did: '' };
  return { rule, did: heldBack > 0 ? `your rule left out ${plural(heldBack, 'product', 'products')}`
    : 'your rule had nothing to leave out' };
}

// The same as one line: "No US products · your rule left out 6 products".
export function ruleDidText(r: CountryRules, heldBack: number | undefined): string | null {
  const x = ruleDid(r, heldBack);
  return x && [x.rule, x.did].filter(Boolean).join(' · ');
}

// What the rules cannot do, in plain words: they act only on products whose origin is known.
export function coveredText(r: CountryRules, t: OriginTally): string | null {
  if (!hasRules(r) || !t.told || !t.products) return null;
  if (!t.unknown) return 'Every product found says where it comes from, so your rules cover them all.';
  if (r.excluded.length) {
    const stay = t.unknown === 1 ? 'the 1 whose origin is not known stays'
      : `the ${t.unknown} whose origin is not known stay`;
    return `Only products known to be from ${listOr(r.excluded.map(theCountry))} can be left out: ${stay} in your plan.`;
  }
  const known = t.products - t.unknown;
  return `Your preferences can only favour products whose origin is known: ${known} of ${t.products} here.`;
}

// ─── One line ────────────────────────────────────────────────

// What the rule left out of a line the plan still buys: "Instead of Ground Beef Medium 900g ·
// Product of USA", and "· and 1 more" past the first; its label says that the rule did it.
export interface InsteadOf {
  text: string;
  label: string;
}

export function insteadOf(held: readonly HeldBackProduct[] | undefined): InsteadOf | null {
  if (!held?.length) return null;
  const [first, ...rest] = held;
  const claim = first.claim.trim() || `From ${theCountry(first.country)}`;
  return {
    text: `Instead of ${first.product} · ${claim}${rest.length ? ` · and ${rest.length} more` : ''}`,
    label: `Your rule left out ${first.product} (${claim})${rest.length ? ` and ${rest.length} more` : ''}.`,
  };
}

// Why a line cannot be bought at all because of the rule: the shopper's own pick is from a
// country it leaves out ("Your chosen product, Ground Beef Medium 900g, is from the United States
// (Product of USA), which your rule leaves out"), or every product near them is. product: the
// line's product as the row names it (null for none); held: its held_back (absent from an older
// API, when the line's own origin or the rule names the country instead).
export function excludedText(l: { pinned: boolean; productId: number | null; product: string | null;
  origin: BasketOrigin | null; held?: readonly HeldBackProduct[] }, r: CountryRules): string {
  const held = l.held ?? [];
  if (l.pinned && l.product) {
    const h = held.find((x) => x.product_id === l.productId);
    const country = h?.country || (l.origin?.status === 'evidenced' ? l.origin.country ?? '' : '');
    const claim = h?.claim.trim() ?? '';
    const from = country ? `${theCountry(country)}${claim ? ` (${claim})` : ''}, which your rule leaves out`
      : 'a country your rule leaves out';
    return `Your chosen product, ${l.product}, is from ${from}`;
  }
  const countries = [...new Set(held.map((h) => h.country.trim()).filter(Boolean))];
  const named = countries.length ? countries : r.excluded;
  return named.length ? `Every product nearby is from ${listOr(named.map(theCountry))}, which your rule leaves out`
    : 'Every product nearby is from a country your rule leaves out';
}

// What makes two lines blocked by the rule the same problem: the shopper's own pick, or the first
// product held back; null for a line the rule does not block.
export function blockKey(l: { kind: string | null; pinned: boolean; productId: number | null;
  ingredient: string; held?: readonly HeldBackProduct[] }): string | null {
  if (l.kind !== 'origin_excluded') return null;
  if (l.pinned && l.productId !== null) return `pin:${l.productId}`;
  const first = l.held?.[0];
  return first ? `held:${first.product_id}` : `ingredient:${l.ingredient.trim().toLowerCase()}`;
}

// ─── A list ──────────────────────────────────────────────────

// The one line over a shopping list while the plan has rules: the rule, then what the list asks of
// the shopper in the store ("No US products · 4 to check on the label"), or that every product
// says where it is from. A product from an excluded country (planned before the evidence came) is
// named. Only the rule is said when pantry-api said nothing of the products. null with no rules.
export function listOriginText(r: CountryRules, origins: readonly (BasketOrigin | null | undefined)[]): string | null {
  if (!hasRules(r)) return null;
  const head = r.excluded.length ? ruleText(r) : `${ruleText(r)} · ${firstText(r)}`;
  const tags = origins.map((o) => originWords(o, r)).filter((w): w is OriginWords => w !== null);
  if (!tags.length) return head;
  const out = tags.filter((w) => w.kind === 'excluded').length;
  const check = tags.filter((w) => w.check).length;
  const parts = [
    out ? `${out} from ${listOr(r.excluded.map(theCountry))}` : '',
    check ? `${check} to check on the label` : '',
    !out && !check && tags.every((w) => w.kind !== 'unknown') ? 'every product says where it comes from' : '',
  ].filter(Boolean);
  return [head, ...parts].join(' · ');
}

// A row's origin in a few words for the copied and printed list: "from Canada", "made in Canada",
// "origin unclear: check the label"; '' when there is nothing to tell the shopper (no answer, or an
// unknown origin while nothing is left out).
export function originListWords(o: BasketOrigin | null | undefined, r: CountryRules): string {
  const w = originWords(o, r);
  if (!w || (w.kind === 'unknown' && !w.check)) return '';
  const where = `${MADE.test(w.text) ? 'made in' : 'from'} ${theCountry(w.country)}`;
  if (w.kind === 'excluded') return `${where}: your rule leaves it out`;
  if (w.country) return where;
  return w.words.charAt(0).toLowerCase() + w.words.slice(1);
}
