// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The wizard's Check ingredients stage: every chosen recipe's ingredients as the plan would buy them
// (/mealplan/basket), each with its product, the store and how far it is, the price, where it is
// from and its labels. Nothing is worked out here: a fact the basket does not give is unknown.
// An ingredient the plan cannot buy nearby is said so, with why (its product, or every product
// nearby, from a country the plan leaves out; none stocked, none within the distance, only at
// stores the shopper turned off: then turning one back on is an answer too), and needs an answer
// before Place on days: other meals (back to Pick meals), another product (its Options), or "skip
// this ingredient" where skipping means the plan buys nothing for it (LineView.skippable).
//
// How sure each row is, in words as well as a mark: how well its product matches the recipe's
// line (lineGrade: "Same item", "Closest match", "Your choice"). Where each product comes from is
// its origin tag, measured against the plan's country rules (mealplan/origin.ts); a row the rule
// left something out for says what ("Your rule left out …"), and the stage's header says what the
// rule did across the basket (originSummary).
import { GROUP_LABELS, nameWithSize } from '../alternatives.ts';
import { recipePicture } from './images.ts';
import type { PictureSource } from './images.ts';
import { lineKey, mealsOf, recipeTitle } from './model.ts';
import type { MealPlanState, Slot } from './model.ts';
import {
  blockKey, countryRules, coveredText, excludedText, leftOutText, originTag, originTally, ruleDid, tallyText,
} from './origin.ts';
import type { CountryRules, OriginWords } from './origin.ts';
import type { BasketLine, HeldBackProduct, MealBasket, MealPlanDraft, ResolvedLine, UnavailableKind } from '../types.ts';

const money = (v: number) => `$${v.toFixed(2)}`;

const listOf = (parts: string[]) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// JSON with object keys sorted, so the same plan always gives the same text.
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(',')}]`;
  if (x && typeof x === 'object') {
    return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(x ?? null);
}

// What the basket depends on: the recipes and their servings, how many meals each has (and
// for how many), the products resolved and pinned, where the household shops and the budget.
// Not where the meals sit: moving one on Place on days does not ask for the basket again.
export function basketKey(d: MealPlanDraft): string {
  return stable({
    recipes: Object.fromEntries(Object.entries(d.recipes).map(([k, r]) => [k, r.servings ?? null])),
    meals: d.meals.map((m) => `${m.recipe_key}:${m.servings ?? ''}`).sort(),
    resolved: Object.fromEntries(Object.entries(d.resolved).map(([k, r]) =>
      [k, [r.status, r.servings, r.lines.map((ln) => ln.product_id)]])),
    pins: d.pins,
    settings: d.settings,
    household: d.prefs.household_servings,
    budget: d.prefs.budget ?? null,
  });
}

// How well the product the plan buys matches the recipe's line. The products check says how the
// line's words met the catalog (ResolvedLine.match): every word as written ("exact"), with the
// purchase form swapped or dropped ("form": cumin powder for Cumin Ground), or only once its
// describing words were dropped ("generic": light brown sugar for Brown Sugar), the loosest, and
// what pantry-api reports when nothing in the catalog is the same item; a product the shopper chose
// in Options is theirs. A row whose product is not the check's pick (a pin made since, an older
// answer) gets no grade rather than a guess, and neither does a row with no product.
export type GradeKind = 'same' | 'form' | 'closest' | 'yours';

export interface MatchGrade {
  kind: GradeKind;
  label: string;
}

export const GRADE_LABELS: Record<GradeKind, string> = {
  same: GROUP_LABELS.same_item, form: `${GROUP_LABELS.same_item}, another form`, closest: 'Closest match',
  yours: 'Your choice',
};

export function lineGrade(ln: Pick<BasketLine, 'product' | 'pinned'>, picked: ResolvedLine | undefined): MatchGrade | null {
  if (!ln.product) return null;
  if (ln.pinned) return { kind: 'yours', label: GRADE_LABELS.yours };
  if (!picked || picked.product_id !== ln.product.id || !picked.match) return null;
  const kind: GradeKind = picked.match === 'exact' ? 'same' : picked.match === 'form' ? 'form' : 'closest';
  return { kind, label: GRADE_LABELS[kind] };
}

// Why an ingredient cannot be bought, as the row and the task list say it. For the origin rule
// the row's own words are better (lineView: its product named, or the countries the products
// nearby are from); these are what is known without the line.
export function unavailableHeading(kind: UnavailableKind | null | undefined, excluded: readonly string[]): string {
  switch (kind) {
    case 'origin_excluded':
      return excludedText({ pinned: false, productId: null, product: null, origin: null },
        countryRules({ exclude_origin: [...excluded] }));
    case 'not_stocked': return 'No store nearby stocks it';
    case 'out_of_range': return 'Sold only beyond your distance';
    case 'stores_off': return 'Sold only at stores you turned off';
    default: return 'Not sold nearby';
  }
}

// What is wrong with an ingredient's row, for its look and its bold label: nothing nearby can
// be bought (why, in unavailableHeading's words), or no product matches it at all. null: the
// plan buys it. An unmatched row stays unmatched once skipped; the row says it was skipped.
export type IssueKind = UnavailableKind | 'no_product' | 'unknown';

export interface LineIssue {
  kind: IssueKind;
  label: string;
}

// heading: the row's own words for why it cannot be bought, when it has better ones than the kind's.
export function lineIssue(l: { available: boolean; productId: number | null; kind: UnavailableKind | null;
  heading?: string }, excluded: readonly string[] = []): LineIssue | null {
  if (l.available && l.productId !== null) return null;
  if (!l.available && l.kind) return { kind: l.kind, label: l.heading || unavailableHeading(l.kind, excluded) };
  if (l.productId === null) return { kind: 'no_product', label: 'No product matches it' };
  return { kind: 'unknown', label: unavailableHeading(null, excluded) };
}

export function storeText(line: BasketLine): string {
  if (!line.store) return 'no store nearby';
  const km = line.store.distance_km;
  return km === null ? line.store.name : `${line.store.name} · ${km.toFixed(1)} km`;
}

export interface LineView {
  key: string;                     // lineKey(recipe, line_no)
  recipeKey: string;
  lineNo: number;
  ingredient: string;
  need: string;
  productId: number | null;
  product: string | null;          // "Whole Milk 1L"
  productName: string | null;      // "Whole Milk", what its picture is asked by
  store: string;
  storeName: string | null;        // where it is bought, by the store's own name ("Your stores" lights it)
  price: string;                   // a pack
  cost: string;                    // this recipe's share, all its meals
  origin: OriginWords;             // where its product comes from, as its tag says it
  held: HeldBackProduct[];         // what the origin rule left out for it ([] also from an older API)
  leftOut: string | null;          // the same, said under a row the plan still buys
  blockKey: string | null;         // the product the origin rule blocks it on, to say once (mealplan/check.ts)
  grade: MatchGrade | null;        // how well the product matches the line, null when not known
  labels: string[];
  pinned: boolean;
  shared: string;                  // "also bought for Chicken Fried Rice"
  available: boolean;
  kind: UnavailableKind | null;    // why it cannot be bought, as pantry-api says it
  heading: string;                 // the same, in words
  issue: LineIssue | null;         // what is wrong with the row, null when the plan buys it
  // pantry-api's own reason, '' when it gives none, or when the heading says it in plainer words
  // (the origin rule's, which names the line's own product)
  why: string;
  // Skip this ingredient is an answer only where it means the plan buys nothing for the line:
  // /mealplan/schedule buys what the resolve picked unless no store in range sells it. So not for a
  // product the origin rule holds back, which the schedule still buys when the planner picked it
  // (before its evidence came in) and refuses when the shopper did; another product or other meals
  // answer that, and a skip kept from before is not counted.
  skippable: boolean;
  skipped: boolean;
  // nothing more to do: sold nearby, skipped by the shopper, or its recipe has no meals now
  answered: boolean;
  optionsLabel: string;
}

export interface RecipeView {
  key: string;
  title: string;
  status: string;
  meals: number;
  lines: LineView[];
  unanswered: number;
  slot: Slot;
  picture: PictureSource | null;
}

function lineView(s: MealPlanState, rules: CountryRules, recipeKey: string, meals: number, ln: BasketLine): LineView {
  const excluded = s.draft.settings.exclude_origin ?? [];
  const p = ln.product;
  const product = p ? nameWithSize(p.name, p.size) : null;
  const k = lineKey(recipeKey, ln.line_no);
  const others = ln.shared_with.filter((x) => x !== recipeKey && s.draft.recipes[x]).map((x) => recipeTitle(s, x));
  const price = ln.price === null ? 'price unknown' : `${money(ln.price)} a pack`;
  const store = storeText(ln);
  const labels = [...(p?.labels ?? [])];
  if (p?.says_organic && !labels.some((l) => /organic/i.test(l))) labels.push('says organic');
  if (p?.demo_product) labels.push('demo product');
  const kind = ln.available ? null : ln.unavailable_kind ?? null;
  const picked = s.draft.resolved[recipeKey]?.lines.find((r) => r.line_no === ln.line_no);
  const held = ln.held_back ?? [];
  const ruled = kind === 'origin_excluded';
  const skippable = !(ruled && p !== null);
  const skipped = skippable && (s.skipped ?? []).includes(k);
  const heading = ln.available ? ''
    : ruled ? excludedText({ pinned: ln.pinned, productId: p?.id ?? null, product, origin: ln.origin, held }, rules)
      : unavailableHeading(ln.unavailable_kind, excluded);
  return {
    key: k, recipeKey, lineNo: ln.line_no, ingredient: ln.ingredient, need: ln.need,
    productId: p?.id ?? null, product, productName: p?.name ?? null, store, storeName: ln.store?.name ?? null, price,
    cost: ln.cost_for_need === null ? '' : `${money(ln.cost_for_need)} for these meals`,
    origin: originTag(ln.origin, rules),
    held, leftOut: ln.available ? leftOutText(held) : null,
    blockKey: blockKey({ kind, pinned: ln.pinned, productId: p?.id ?? null, ingredient: ln.ingredient, held }),
    grade: lineGrade(ln, picked),
    labels, pinned: ln.pinned,
    shared: others.length ? `also bought for ${listOf(others)}` : '',
    available: ln.available, kind, heading,
    issue: lineIssue({ available: ln.available, productId: p?.id ?? null, kind, heading }, excluded),
    why: ruled && p !== null ? '' : ln.why_unavailable ?? '',
    skippable, skipped, answered: ln.available || skipped || meals === 0,
    optionsLabel: product
      ? `Options for ${ln.ingredient}: now ${product}, ${ln.price === null ? 'price unknown' : money(ln.price)}`
        + `${ln.store ? ` at ${ln.store.name}` : ''}${ln.available ? '' : '; not sold nearby'}`
      : `Options for ${ln.ingredient}: nothing chosen yet${ln.available ? '' : ', not sold nearby'}`,
  };
}

// The basket for the recipes still in the plan, in the basket's order, with the skips the
// shopper made. A recipe's meals are the plan's own count, which may be newer than the answer.
export function basketView(b: MealBasket, s: MealPlanState): { recipes: RecipeView[]; unanswered: LineView[] } {
  const rules = countryRules(s.draft.settings);
  const recipes = b.recipes.filter((r) => s.draft.recipes[r.key]).map((r) => {
    const meals = mealsOf(s.draft, r.key).length;
    const lines = r.lines.map((ln) => lineView(s, rules, r.key, meals, ln));
    const mine = s.draft.recipes[r.key];
    return { key: r.key, title: r.title || recipeTitle(s, r.key), status: r.status, meals, lines,
      unanswered: lines.filter((l) => !l.answered).length, slot: mine.slot,
      picture: recipePicture(r.image, mine.ref.doc) };
  });
  return { recipes, unanswered: recipes.flatMap((r) => r.lines.filter((l) => !l.answered)) };
}

export const unansweredCount = (b: MealBasket | null, s: MealPlanState): number =>
  (b ? basketView(b, s).unanswered.length : 0);

// The ingredients of the recipes that have meals: how many lines, how many a store nearby sells,
// how many still need an answer, and how many the shopper chose to do without.
export interface BasketCounts {
  lines: number;
  found: number;
  unanswered: number;
  skipped: number;
}

export function basketCounts(b: MealBasket, s: MealPlanState): BasketCounts {
  const v = basketView(b, s);
  const lines = v.recipes.filter((r) => r.meals > 0).flatMap((r) => r.lines);
  return { lines: lines.length, found: lines.filter((l) => l.issue === null).length,
    unanswered: v.unanswered.length, skipped: lines.filter((l) => l.skipped).length };
}

// What the plan's country rules did, for the stage's header, while the plan has any: the rule and
// what it left out across the whole basket ("No US products · your rule left out 6 products"), the
// products the plan buys counted by country ("Canada 7 · Italy 1 · 5 unknown: check the label"), and
// what the rules cannot do (they act only on products whose origin is known). Each product counts
// once, however many lines buy it, and only the ones bought: of the recipes that have meals, the
// lines a store nearby sells. null when the plan has no rules.
export interface OriginSummary {
  rule: string;                    // "No US products"
  did: string;                     // "your rule left out 6 products", '' when nothing can be said
  tally: string;
  covered: string | null;
}

export function originSummary(b: MealBasket, s: MealPlanState): OriginSummary | null {
  const rules = countryRules(s.draft.settings);
  const head = ruleDid(rules, b.origin_held_back);
  if (head === null) return null;
  const bought = b.recipes.filter((r) => s.draft.recipes[r.key] && mealsOf(s.draft, r.key).length > 0)
    .flatMap((r) => r.lines.flatMap((l) => (l.available && l.product ? [{ id: l.product.id, origin: l.origin }] : [])));
  const tally = originTally(bought, rules);
  // nothing bought and nothing left out: there is nothing yet for the rule to have done
  const did = rules.excluded.length && !tally.products && !b.origin_held_back ? '' : head.did;
  return { rule: head.rule, did, tally: tallyText(tally, rules), covered: coveredText(rules, tally) };
}

// Whether the basket's total leaves out a price: some ingredient it buys has none.
export const basketAtLeast = (b: MealBasket): boolean =>
  b.recipes.some((r) => r.lines.some((ln) => ln.available && ln.product !== null && ln.price === null));
