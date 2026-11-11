// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// "Build a week for me": the week planner (pantry-api's /plan/week) picks dinners from the
// recipe library for the plan's days, under its budget, diet, leave-out list and origin rules,
// and they go into the plan as one edit the shopper can undo (board.weekEdit in 'add' mode: each
// dinner on the first free dinner, the rest in the tray). Here: the request, the week's dinners,
// and the words around them. components/useBuildWeek.ts makes the calls; Pick meals and Home use
// it.
//
// The planner speaks of what a product contains in fewer words than the plan does (PLANNER_TAGS,
// pantry-api's ALLOWED_TAGS; it ignores any other with a note). The plan's diet and leave-out
// list are said in those words where they can be, and never more broadly than the shopper asked,
// except that the catalog tags fish as meat, so leaving meat out leaves fish out too. What the
// planner's words cannot say (sesame, fish or shellfish on their own, mustard, sulphites, honey
// for a vegan) and what its product tags miss (a "Cheddar Cheese" line bought as a product with
// no dairy tag) is caught afterwards: when the plan has a diet or leaves something out, every
// dinner is checked against the meal-plan catalog's own verdict (the one Pick meals hides
// recipes by), and one that does not fit is left out and named.
import { avoidOf, budgetOf, dietOf, libraryRef } from './model.ts';
import type { WeekDinner } from './board.ts';
import type { AvoidTag, CatalogRecipe, Diet, MealPlanDraft, MealPrefs, WeekPlan } from '../types.ts';

export const PLANNER_TAGS = ['meat', 'dairy', 'egg', 'gluten', 'nuts', 'soy'] as const;
export type PlannerTag = typeof PLANNER_TAGS[number];

// Pescatarian leaves out meat; the planner cannot tell fish from it, so its fish go as well.
const DIET_TAGS: Record<Diet, readonly PlannerTag[]> = {
  any: [], pescatarian: ['meat'], vegetarian: ['meat'], vegan: ['meat', 'dairy', 'egg'],
};

// The leave-out choices the planner has a word for. Fish and shellfish are not here: its only
// word for them is meat, and leaving out every meat for a fish allergy would be far more than
// was asked; the catalog's verdict leaves those dinners out instead.
const AVOID_WORDS: Partial<Record<AvoidTag, PlannerTag>> = {
  dairy: 'dairy', egg: 'egg', gluten: 'gluten', soy: 'soy', peanuts: 'nuts', tree_nuts: 'nuts', nuts: 'nuts',
};

// The plan's diet and leave-out list in the planner's words, each once, in PLANNER_TAGS order.
export function weekExcludeTags(p: MealPrefs): PlannerTag[] {
  const want = new Set<PlannerTag>(DIET_TAGS[dietOf(p)]);
  for (const t of avoidOf(p)) {
    const word = AVOID_WORDS[t];
    if (word) want.add(word);
  }
  return PLANNER_TAGS.filter((t) => want.has(t));
}

// What /plan/week is asked (hub.ts WeekOptions): a dinner a day for the plan's days, under the
// plan's budget (for the whole period: the dinners must fit inside it), diet and origin rules.
export interface WeekRequest {
  days: number;
  max_total_budget: number | null;
  exclude_tags: string[];
  exclude_origin: string[];
  preference: string[];
}

export function weekRequest(d: MealPlanDraft): WeekRequest {
  return {
    days: d.days,
    max_total_budget: budgetOf(d.prefs),
    exclude_tags: weekExcludeTags(d.prefs),
    exclude_origin: [...(d.settings.exclude_origin ?? [])],
    preference: [...(d.settings.preference ?? [])],
  };
}

// The week's dinners, in its order, as board.weekEdit takes them.
export const weekDinners = (week: Pick<WeekPlan, 'days'>): WeekDinner[] =>
  week.days.map((day) => ({ slug: day.recipe_slug, name: day.recipe_name }));

// Whether the dinners need the catalog's verdict: only a plan with a diet or a leave-out list.
export const dietChecked = (p: MealPrefs): boolean => dietOf(p) !== 'any' || avoidOf(p).length > 0;

export interface LeftOut {
  name: string;
  why: string;                     // the catalog's words: "contains dairy"
}

// The dinners the catalog says fit the plan's diet and leave-out list (`recipes`: its answer, for
// every slot); the rest, each named once with the catalog's reason. A dinner the catalog does not
// list is kept: the planner's own filter is all there is to go on.
export function fitting(dinners: readonly WeekDinner[], recipes: readonly CatalogRecipe[])
  : { kept: WeekDinner[]; left: LeftOut[] } {
  const byKey = new Map(recipes.map((r) => [r.key, r]));
  const kept: WeekDinner[] = [];
  const left: LeftOut[] = [];
  for (const dinner of dinners) {
    const r = byKey.get(libraryRef(dinner.slug).key);
    if (!r || r.fits) kept.push(dinner);
    else if (!left.some((x) => x.name === dinner.name)) left.push({ name: dinner.name, why: r.why_not ?? 'it does not fit' });
  }
  return { kept, left };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const listOf = (parts: string[]) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// The toast once the dinners are in: "Added 6 dinners", and what did not go on a day.
export function builtText(added: number, trayed: number, left: number): string {
  return [
    `Added ${plural(added, 'dinner', 'dinners')}`,
    trayed ? `${trayed} ${trayed === 1 ? 'waits' : 'wait'} in the tray` : '',
    left ? `${left} left out for your diet` : '',
  ].filter(Boolean).join(' · ');
}

// Which dinners the diet check left out, and why: shown under the button after a build.
export function leftText(left: readonly LeftOut[]): string | null {
  if (!left.length) return null;
  const named = listOf(left.map((x) => `${x.name} (${x.why})`));
  return `Left out for your diet: ${named}.`;
}

// Why nothing could be added when the planner's every dinner was left out.
export function noneFitText(left: readonly LeftOut[]): string {
  return `No dinner the planner found fits your diet: ${listOf(left.map((x) => `${x.name} ${x.why}`))}.`;
}
