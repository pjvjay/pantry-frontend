// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Check ingredients' header and its task list. The header says how far the check has got and what
// it found, in words over a bar: first the products of each recipe ("Checking the products for 4
// recipes…", the bar counting recipes), then the ingredients at the stores ("Checking 35
// ingredients…", no measure yet), then what was found ("33 of 35 found nearby", the bar split into
// found, skipped and still to answer). Under it, the ingredients the plan cannot buy nearby that
// still need an answer, pinned at the top as a short task list, each with its answers: another
// product (its Options), skip this ingredient, or other meals; one sold only at stores the shopper
// turned off can also turn a store back on. The rest of the recipes' rows stay below, quiet.
import type { BasketCounts, LineView, RecipeView } from './basket.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const listOf = (parts: readonly string[]) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// ─── The header ──────────────────────────────────────────────

// What the header is read from: the plan's recipes and how their products check stands (as the
// gates have it, mealplan/wizard.ts), and the basket's counts from its last answer (current or not).
export interface CheckInput {
  recipes: number;                 // recipes in the plan
  checking: readonly string[];     // recipes whose products are being checked, by title
  failed: readonly string[];       // recipes whose products could not be checked, by title
  basket: 'waiting' | 'error' | 'ok';
  counts: BasketCounts | null;
}

// products: the recipes' products are being checked; ingredients: the basket is on its way;
// failed: a check could not be made (its recipe or the stage says what to do); done: found.
export type CheckState = 'products' | 'ingredients' | 'failed' | 'done';

export interface CheckProgress {
  state: CheckState;
  head: string;                    // "33 of 35 found nearby"
  note: string;                    // "2 to answer", "2 skipped", "2 of 4 recipes checked", or ''
  // the bar: found, skipped and to answer out of max; value null while there is nothing to measure
  // yet (the bar sweeps instead)
  value: number | null;
  skipped: number;
  open: number;
  max: number;
}

export function checkProgress(c: CheckInput): CheckProgress {
  const none = { skipped: 0, open: 0 };
  const done = c.recipes - c.checking.length - c.failed.length;
  // one or two recipes by name, more by count, as Next says it
  const which = (titles: readonly string[]) => (titles.length > 2 ? `${titles.length} recipes` : listOf(titles));
  if (c.failed.length) {
    return { state: 'failed', head: `The products for ${which(c.failed)} could not be checked`,
      note: c.recipes > 1 ? `${done} of ${plural(c.recipes, 'recipe', 'recipes')} checked` : '',
      value: done, max: c.recipes, ...none };
  }
  if (c.checking.length) {
    return { state: 'products', head: `Checking the products for ${which(c.checking)}…`,
      note: `${done} of ${plural(c.recipes, 'recipe', 'recipes')} checked`, value: done, max: c.recipes, ...none };
  }
  if (c.basket === 'error') {
    return { state: 'failed', head: 'The ingredients could not be checked', note: '', value: null, max: 1, ...none };
  }
  const n = c.counts;
  if (c.basket === 'waiting' || !n) {
    return { state: 'ingredients',
      head: n?.lines ? `Checking ${plural(n.lines, 'ingredient', 'ingredients')}…` : 'Checking the ingredients…',
      note: 'at the stores near you', value: null, max: 1, ...none };
  }
  if (!n.lines) return { state: 'done', head: 'Nothing to buy yet', note: '', value: 0, max: 0, ...none };
  const note = n.unanswered ? `${n.unanswered} to answer` : n.skipped ? `${n.skipped} skipped` : '';
  return { state: 'done', head: `${n.found} of ${n.lines} found nearby`, note, value: n.found,
    skipped: n.skipped, open: n.unanswered, max: n.lines };
}

// What a screen reader hears once the check is in: the header's words as one sentence.
export function checkedText(p: CheckProgress): string {
  return p.note ? `${p.head}, ${p.note}.` : `${p.head}.`;
}

// ─── The task list ───────────────────────────────────────────

// An answer to an ingredient the plan cannot buy nearby, in the order they are offered: bring a
// store back (only for one sold only at stores turned off), another product, do without it, or
// other meals.
export type Answer = 'stores' | 'product' | 'skip' | 'meals';

export interface AtRisk {
  line: LineView;
  recipe: string;                  // its recipe's title
  answers: Answer[];
}

export function atRiskTasks(recipes: readonly RecipeView[]): AtRisk[] {
  return recipes.flatMap((r) => r.lines.filter((l) => !l.answered).map((line) => ({
    line, recipe: r.title,
    answers: [...(line.kind === 'stores_off' ? ['stores' as const] : []), 'product' as const, 'skip' as const,
      'meals' as const],
  })));
}

// The words on each answer: "Another product" asks Options for one in place of the line's own;
// with nothing chosen for it yet, it chooses one.
export function answerLabel(a: Answer, line: Pick<LineView, 'productId'>): string {
  switch (a) {
    case 'stores': return 'Turn a store back on';
    case 'product': return line.productId === null ? 'Choose a product' : 'Another product';
    case 'skip': return 'Skip this ingredient';
    default: return 'Pick other meals';
  }
}

// "2 ingredients to answer"
export const toAnswerText = (n: number): string => `${plural(n, 'ingredient', 'ingredients')} to answer`;

// What is wrong with a task, in bold, and pantry-api's own reason after it when that adds
// something ("Sold only beyond your distance · no store within 5 km sells it; the nearest offer is
// …"). A reason that starts by saying the same thing stands alone instead ("Sold only at stores you
// turned off: ValueFoods East Van"), so nothing is said twice.
export function issueText(line: Pick<LineView, 'issue' | 'heading' | 'why'>): { head: string; why: string } {
  const head = line.issue?.label ?? line.heading;
  const why = line.why.trim();
  if (why && why.toLowerCase().startsWith(head.toLowerCase())) return { head: why, why: '' };
  return { head, why };
}

// A recipe's own count under its name: its meals and ingredients, and how many of them wait above
// in the task list ("2 meals · 9 ingredients · 1 to answer above").
export function recipeCountText(r: Pick<RecipeView, 'meals' | 'lines' | 'unanswered'>): string {
  return [plural(r.meals, 'meal', 'meals'), plural(r.lines.length, 'ingredient', 'ingredients'),
    r.unanswered ? `${r.unanswered} to answer above` : ''].filter(Boolean).join(' · ');
}
