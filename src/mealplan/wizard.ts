// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The meal plan as six stages with a progress indicator, each named for what the shopper does
// there: Set up (optional: every answer has a default), Pick meals, Check ingredients, Place on
// days, Shop and Calendar. The stage is in the address (#/plan?step=1..6), so the browser's
// Back goes to the stage before and a stage can be bookmarked; Google's return from its consent
// page (#/plan?calendar=...) lands on Calendar. The plan's old address, #/mealplan, is read the
// same way: the shell rewrites it (routes.ts), and this module accepts it too, so a stage asked
// for under the old name is never lost on the way.
//
// Moving on from a stage needs what the later ones work from, its gate:
//   2 Pick meals: at least one meal;
//   3 Check ingredients: every recipe's products checked, and every ingredient the plan cannot
//     buy nearby answered (back to Pick meals for another recipe, another product, or "skip this
//     ingredient");
//   5 Shop: at least one approved trip, which the Calendar exports.
// A gate is ok, pending (an answer is on its way: Next waits for it, shows how long it has been
// waiting, and moves on by itself once the answer is in if the shopper pressed it; the stages
// after it stay reachable) or blocked, with the words Next shows. An edit that blocks an earlier
// gate never moves the shopper off the stage they are on: the stepper and Next say what to fix.
import { DEFAULT_ALLIES, EXCLUDED_BY_DEFAULT, PREFERRED_FIRST, USABLE_RESOLVE, recipeTitle } from './model.ts';
import type { MealPlanState } from './model.ts';
import type { PlanSettings } from '../types.ts';

export type StepNo = 1 | 2 | 3 | 4 | 5 | 6;

// optional: the stage can be passed by without a visit (Set up: every answer has a default, and
// Pick meals restates them with a way back to each).
export const STEPS: readonly { n: StepNo; name: string; optional?: boolean }[] = [
  { n: 1, name: 'Set up', optional: true },
  { n: 2, name: 'Pick meals' },
  { n: 3, name: 'Check ingredients' },
  { n: 4, name: 'Place on days' },
  { n: 5, name: 'Shop' },
  { n: 6, name: 'Calendar' },
];

export const LAST_STEP: StepNo = 6;

export const isStep = (n: unknown): n is StepNo =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= LAST_STEP;

export const stepName = (n: StepNo): string => STEPS[n - 1].name;

export const isOptional = (n: StepNo): boolean => STEPS[n - 1].optional === true;

// The quiet line over a stage's heading, which is the stage's name: "Step 2 of 6", and
// "Step 1 of 6 · optional" for Set up.
export const stepCaption = (n: StepNo): string =>
  `Step ${n} of ${LAST_STEP}${isOptional(n) ? ' · optional' : ''}`;

// Where a stage lives: '#/plan?step=3'.
export const stepHash = (n: StepNo): string => `#/plan?step=${n}`;

// Whether the address is the meal plan's, under its name or its old one ('#/plan',
// '#/mealplan?step=2'); the shopping plan on its own (#/shop) is not.
export function isPlanHash(hash: string): boolean {
  const path = hash.replace(/^#\/?/, '').split('?')[0].replace(/\/+$/, '');
  return path === 'plan' || path === 'mealplan';
}

// The stage the address asks for, or null when it names none (or one that is not a stage).
// Google's return from its consent page carries ?calendar= and belongs to the Calendar stage.
export function stepFromHash(hash: string): StepNo | null {
  const query = hash.split('?')[1];
  if (!isPlanHash(hash) || query === undefined) return null;
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
  unanswered: number;              // ingredients the plan cannot buy nearby, not yet answered
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
          + `checked: try again, or take ${f.failed.length === 1 ? 'it' : 'them'} out in Pick meals` };
      }
      if (f.checking.length) {
        // by name for one or two; a count for more, which Next's bar can still show on one line
        const which = f.checking.length > 2 ? `${f.checking.length} recipes` : listOf(f.checking);
        return { step: n, state: 'pending', text: `Checking the products for ${which}…` };
      }
      if (f.basket === 'waiting') return { step: n, state: 'pending', text: 'Checking the ingredients…' };
      if (f.basket === 'error') {
        return { step: n, state: 'blocked', text: 'The ingredients could not be checked: try again' };
      }
      if (f.unanswered > 0) {
        return { step: n, state: 'blocked', text: `Answer ${plural(f.unanswered, 'ingredient', 'ingredients')} `
          + 'the plan cannot buy nearby: another product, skip it, or other meals' };
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

// The stage to show. With none asked: where the shopper was last in this page, else Pick meals
// for a plan with no recipes (Set up is optional: its defaults are restated at the top of Pick
// meals, each with a way back to it) and Place on days for one that has them (the Assistant's
// "Open in Meal plan" asks for it itself). Never further than the plan allows.
export function routeStep(asked: StepNo | null, f: WizardFacts, last: StepNo | null,
  hasRecipes: boolean): StepNo {
  const want = asked ?? last ?? (hasRecipes ? 4 : 2);
  return Math.min(want, furthest(f)) as StepNo;
}

// What Next says while it waits on a pending gate, before the time it has waited: the gate's own
// words are longer ("Checking the products for Dal…") and stay under the button.
export function waitWords(g: Gate): string {
  return g.step === 3 ? 'Checking ingredients…' : 'Checking…';
}

// A wait as a clock reads it: "0:04", "1:15", "12:00".
export function clockText(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// One stage in the progress indicator. done: before the current one; attention: a done stage
// whose gate an edit has since blocked, and why; reachable: it can be opened from here.
export interface StepView {
  n: StepNo;
  name: string;
  optional: boolean;
  state: 'done' | 'current' | 'ahead';
  reachable: boolean;
  attention: string | null;
}

export function stepViews(current: StepNo, f: WizardFacts): StepView[] {
  const reach = furthest(f);
  return STEPS.map(({ n, name, optional }) => {
    const g = gate(n, f);
    return {
      n, name, optional: optional === true,
      state: n < current ? 'done' : n === current ? 'current' : 'ahead',
      reachable: n <= reach,
      attention: n < current && g.state === 'blocked' ? g.text : null,
    };
  });
}

// ─── Set up: the origin rules ────────────────────────────────

// The plan's origin rules as Set up shows them: leave out United States products (the one hard
// rule), prefer Canada, then the other countries in the shopper's order. Countries excluded
// some other way (the Assistant, an imported plan) are kept as they are.
export interface OriginRules {
  excludeUS: boolean;
  preferCanada: boolean;
  allies: string[];
  otherExcluded: string[];
}

export function originRules(st: PlanSettings): OriginRules {
  const ex = st.exclude_origin ?? [];
  const pref = st.preference ?? [];
  return {
    excludeUS: ex.includes(EXCLUDED_BY_DEFAULT),
    preferCanada: pref.includes(PREFERRED_FIRST),
    allies: pref.filter((c) => c !== PREFERRED_FIRST),
    otherExcluded: ex.filter((c) => c !== EXCLUDED_BY_DEFAULT),
  };
}

// The settings for the rules: Canada first when preferred, then the allies in order.
export function originSettings(r: OriginRules): Required<Pick<PlanSettings, 'exclude_origin' | 'preference'>> {
  return {
    exclude_origin: [...(r.excludeUS ? [EXCLUDED_BY_DEFAULT] : []), ...r.otherExcluded],
    preference: [...(r.preferCanada ? [PREFERRED_FIRST] : []), ...r.allies],
  };
}

// The list with one country moved up (-1) or down (+1); unchanged at either end.
export function moveCountry(list: readonly string[], country: string, by: -1 | 1): string[] {
  const i = list.indexOf(country);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return [...list];
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// Default allies the shopper took off the list, to add back.
export const alliesToAdd = (allies: readonly string[]): string[] =>
  DEFAULT_ALLIES.filter((c) => !allies.includes(c));

// "United Kingdom, France, Germany and 12 more"
export function alliesText(allies: readonly string[]): string {
  if (!allies.length) return 'no other countries';
  if (allies.length <= 3) return listOf([...allies]);
  return `${allies.slice(0, 3).join(', ')} and ${allies.length - 3} more`;
}
