// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The Meal plan tab as six stages with a progress indicator: Basics, Meals, Ingredients,
// Schedule, Shopping plan and Calendar. The stage is in the address (#/mealplan?step=1..6), so
// the browser's Back goes to the stage before and a stage can be bookmarked; Google's return
// from its consent page (#/mealplan?calendar=...) lands on Calendar.
//
// Moving on from a stage needs what the later ones work from, its gate:
//   2 Meals: at least one meal;
//   3 Ingredients: every recipe's products checked, and every ingredient no store nearby sells
//     answered (back to Meals for another recipe, another product, or "skip this ingredient");
//   5 Shopping plan: at least one approved trip, which the Calendar exports.
// A gate is ok, pending (an answer is on its way: Next waits for it, but the stages after it
// stay reachable) or blocked, with the words Next shows. An edit that blocks an earlier gate
// never moves the shopper off the stage they are on: the stepper and Next say what to fix.
import { USABLE_RESOLVE, recipeTitle } from './model.ts';
import type { MealPlanState } from './model.ts';

export type StepNo = 1 | 2 | 3 | 4 | 5 | 6;

export const STEPS: readonly { n: StepNo; name: string }[] = [
  { n: 1, name: 'Basics' },
  { n: 2, name: 'Meals' },
  { n: 3, name: 'Ingredients' },
  { n: 4, name: 'Schedule' },
  { n: 5, name: 'Shopping plan' },
  { n: 6, name: 'Calendar' },
];

export const LAST_STEP: StepNo = 6;

export const isStep = (n: unknown): n is StepNo =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= LAST_STEP;

export const stepName = (n: StepNo): string => STEPS[n - 1].name;

// "Stage 2 of 6: Meals", the stage heading.
export const stepTitle = (n: StepNo): string => `Stage ${n} of ${LAST_STEP}: ${stepName(n)}`;

// Where a stage lives: '#/mealplan?step=3'.
export const stepHash = (n: StepNo): string => `#/mealplan?step=${n}`;

// The stage the address asks for, or null when it names none (or one that is not a stage).
// Google's return from its consent page carries ?calendar= and belongs to the Calendar stage.
export function stepFromHash(hash: string): StepNo | null {
  const [path, query] = hash.replace(/^#\/?/, '').split('?');
  if (path !== 'mealplan' || query === undefined) return null;
  const q = new URLSearchParams(query);
  if (q.has('calendar')) return LAST_STEP;
  const raw = q.get('step');
  const n = raw !== null && /^\d$/.test(raw) ? Number(raw) : NaN;
  return isStep(n) ? n : null;
}

// What the gates are decided from.
export interface WizardFacts {
  meals: number;
  checking: string[];              // recipes whose products are being checked, by title
  failed: string[];                // recipes whose products could not be checked
  // the ingredients as the plan would buy them: still to come, could not be had, or answered
  // for the plan as it is now
  basket: 'waiting' | 'error' | 'ok';
  unanswered: number;              // ingredients no store nearby sells, not yet answered
  approved: number;                // approved trips
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const listOf = (parts: string[]) => (parts.length < 2 ? parts.join('')
  : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`);

// The facts from the plan, the last resolve call and the basket. A recipe still waiting for its
// products counts as failed once that call failed: it is not tried again on its own (the
// store's retryResolve does that).
export function wizardFacts(s: MealPlanState, resolveFailed: boolean,
  basket: { state: WizardFacts['basket']; unanswered: number }): WizardFacts {
  const d = s.draft;
  const keys = Object.keys(d.recipes);
  const waiting = keys.filter((k) => !d.resolved[k]);
  const broken = keys.filter((k) => d.resolved[k] && !USABLE_RESOLVE.includes(d.resolved[k].status));
  const title = (k: string) => recipeTitle(s, k);
  return {
    meals: d.meals.length,
    checking: resolveFailed ? [] : waiting.map(title),
    failed: [...(resolveFailed ? waiting : []), ...broken].map(title),
    basket: basket.state,
    unanswered: basket.unanswered,
    approved: d.trips.length,
  };
}

export type GateState = 'ok' | 'pending' | 'blocked';

export interface Gate {
  step: StepNo;
  state: GateState;
  text: string;                    // what to do, '' when ok
}

const ok = (step: StepNo): Gate => ({ step, state: 'ok', text: '' });

// What moving on from stage `n` needs, and whether the plan has it.
export function gate(n: StepNo, f: WizardFacts): Gate {
  switch (n) {
    case 2:
      return f.meals > 0 ? ok(n) : { step: n, state: 'blocked', text: 'Add at least one meal' };
    case 3:
      if (f.failed.length) {
        return { step: n, state: 'blocked', text: `The products for ${listOf(f.failed)} could not be `
          + `checked: try again, or take ${f.failed.length === 1 ? 'it' : 'them'} out in Meals` };
      }
      if (f.checking.length) {
        return { step: n, state: 'pending', text: `Checking the products for ${listOf(f.checking)}…` };
      }
      if (f.basket === 'waiting') return { step: n, state: 'pending', text: 'Checking the ingredients…' };
      if (f.basket === 'error') {
        return { step: n, state: 'blocked', text: 'The ingredients could not be checked: try again' };
      }
      if (f.unanswered > 0) {
        return { step: n, state: 'blocked', text: `Answer ${plural(f.unanswered, 'ingredient', 'ingredients')} `
          + 'no store nearby sells: another product, skip it, or other meals' };
      }
      return ok(n);
    case 5:
      return f.approved > 0 ? ok(n)
        : { step: n, state: 'blocked', text: 'Approve at least one shopping trip' };
    default:
      return ok(n);
  }
}

// What stops Next on stage `current`: the first gate up to and including it that is not ok, so
// a meal taken out on Schedule stops Next there too.
export function nextBlock(current: StepNo, f: WizardFacts): Gate | null {
  for (const { n } of STEPS) {
    if (n > current) break;
    const g = gate(n, f);
    if (g.state !== 'ok') return g;
  }
  return null;
}

// The furthest stage the plan can be on: no gate before it is blocked.
export function furthest(f: WizardFacts): StepNo {
  let n: StepNo = 1;
  while (n < LAST_STEP && gate(n, f).state !== 'blocked') n = (n + 1) as StepNo;
  return n;
}

// The stage to show. With none asked: where the shopper was last in this page, else Basics for
// a plan with no recipes and Schedule for one that has them (the Assistant's "Open in Meal plan"
// asks for Schedule itself). Never further than the plan allows.
export function routeStep(asked: StepNo | null, f: WizardFacts, last: StepNo | null,
  hasRecipes: boolean): StepNo {
  const want = asked ?? last ?? (hasRecipes ? 4 : 1);
  return Math.min(want, furthest(f)) as StepNo;
}

// One stage in the progress indicator. done: before the current one; attention: a done stage
// whose gate an edit has since blocked, and why; reachable: it can be opened from here.
export interface StepView {
  n: StepNo;
  name: string;
  state: 'done' | 'current' | 'ahead';
  reachable: boolean;
  attention: string | null;
}

export function stepViews(current: StepNo, f: WizardFacts): StepView[] {
  const reach = furthest(f);
  return STEPS.map(({ n, name }) => {
    const g = gate(n, f);
    return {
      n, name,
      state: n < current ? 'done' : n === current ? 'current' : 'ahead',
      reachable: n <= reach,
      attention: n < current && g.state === 'blocked' ? g.text : null,
    };
  });
}
