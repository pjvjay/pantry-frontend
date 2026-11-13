// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Home: where this week's plan stands, so the shopper can pick it up where they left it. A
// greeting for the time of day, the plan's six steps as a task list (as GOV.UK's task list pages
// do), each with a state in words and a line of what it has produced so far ("8 dinners and 7
// snacks picked", "14 of 16 found nearby · 2 to answer", "2 trips · $62.10 of $90"), one
// "Continue" to the step to do next, and the next trip to shop for.
//
// A step's state comes from the same facts as the plan's own gates (mealplan/wizard.ts), the
// ingredients as the basket last answered, and the trips as the schedule last answered:
//   Done              finished: nothing more to do there for now
//   In progress       started, or waiting on a check that is under way
//   Next              the step to do next, not started yet
//   Needs attention   something there stops the plan going on (an ingredient nobody nearby sells,
//                     a check that failed, a trip changed since it was approved)
//   Cannot start yet  it waits on an earlier step
//   Changed           done once, and the plan has moved on since (the events handed to a calendar
//                     are no longer the plan's)
// "Next" is the first step that is not done; Continue opens it. Set up is optional and every
// answer in it has a default, so it is always done. Calendar is done once its events have gone to
// a calendar (the file downloaded, or a Google sync written: mealplan/exported.ts) and until they
// change; the console cannot look into the calendar app itself, so that is all it can say.
import { includeCounts } from '../calendar.ts';
import type { BasketCounts } from './basket.ts';
import { costText, money, strategyOf, tripLook, tripPriced, tripToShop } from './board.ts';
import type { TripLook } from './board.ts';
import { addDays, dayLabel, daysBetween } from './dates.ts';
import type { CivilDate } from './dates.ts';
import { DIET_LABELS, SLOTS, approvedElsewhere, budgetOf, dietOf } from './model.ts';
import type { MealPlanState, Slot } from './model.ts';
import { countryRules, listOriginText, ruleText } from './origin.ts';
import { listOf, shopRows } from './shoplist.ts';
import { changedSinceText, exportState, exportedText } from './exported.ts';
import type { ExportMark } from './exported.ts';
import { STEPS, furthest } from './wizard.ts';
import type { StepNo, WizardFacts } from './wizard.ts';
import type { CalendarTiming, MealPlanDraft, MealSchedule } from '../types.ts';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// ─── The greeting ────────────────────────────────────────────

// By the shopper's own clock: morning from 5, afternoon from noon, evening from 6.
export function greeting(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

// "Thu 12 Nov – Wed 25 Nov"
export const periodText = (d: MealPlanDraft): string =>
  `${dayLabel(d.start_date)} – ${dayLabel(addDays(d.start_date, d.days - 1))}`;

// The heading over the plan's steps, named for the time the plan covers: "This week" for a week,
// "These two weeks" for a fortnight, "These 10 days" otherwise.
export function planHeading(days: number): string {
  if (days === 7) return 'This week';
  if (days === 14) return 'These two weeks';
  return `These ${days} days`;
}

// The recipe whose picture heads Home: the one cooked first, else the first one picked.
export function firstRecipe(d: MealPlanDraft): string | null {
  const rank = (sl: Slot | null) => (sl === null ? SLOTS.length : SLOTS.indexOf(sl));
  const placed = d.meals.filter((m) => m.date !== null)
    .sort((a, b) => (a.date as string).localeCompare(b.date as string) || rank(a.slot) - rank(b.slot));
  return placed[0]?.recipe_key ?? Object.keys(d.recipes)[0] ?? null;
}

// ─── What each step has produced ─────────────────────────────

const SLOT_WORDS: Record<Slot, [string, string]> = {
  breakfast: ['breakfast', 'breakfasts'], lunch: ['lunch', 'lunches'], dinner: ['dinner', 'dinners'],
  snack: ['snack', 'snacks'],
};

// "3 dinners picked", "8 dinners and 7 snacks picked"; a count of meals for three kinds or more.
export function pickedText(d: MealPlanDraft): string {
  const n = d.meals.length;
  if (!n) return 'No meals yet';
  const slotOf = (m: MealPlanDraft['meals'][number]) => m.slot ?? d.recipes[m.recipe_key]?.slot ?? null;
  const by = SLOTS.map((sl) => [sl, d.meals.filter((m) => slotOf(m) === sl).length] as const).filter(([, c]) => c > 0);
  if (!by.length || by.length > 2 || by.reduce((t, [, c]) => t + c, 0) !== n) return `${plural(n, 'meal', 'meals')} picked`;
  return `${listOf(by.map(([sl, c]) => plural(c, SLOT_WORDS[sl][0], SLOT_WORDS[sl][1])))} picked`;
}

// The ingredients counted (mealplan/basket.ts): found nearby, still to answer, skipped.
export { basketCounts } from './basket.ts';
export type { BasketCounts } from './basket.ts';

// A budget as people say it: "$90", "$92.50".
const budgetText = (b: number) => (Number.isInteger(b) ? `$${b}` : money(b));

// ─── The task list ───────────────────────────────────────────

// The words of a Tag (components/ui.tsx): Done, In progress, Next, Cannot start yet, Needs attention,
// Changed.
export type HomeTag = 'done' | 'progress' | 'next' | 'blocked' | 'attention' | 'changed';

export interface HomeTask {
  n: StepNo;
  name: string;
  tag: HomeTag;
  produces: string;
  open: boolean;                   // the plan can be opened on this step now
}

export interface HomeTasks {
  tasks: HomeTask[];
  next: StepNo;                    // the step Continue opens
  done: boolean;                   // every step is done: the week is planned
}

// complete: nothing more to do. partial: begun. pending: a check is under way. problem: something
// stops the plan. ready: there is something to act on, not touched yet. stale: done once, and
// changed since. empty: nothing there yet.
type Progress = 'complete' | 'partial' | 'pending' | 'problem' | 'ready' | 'stale' | 'empty';

interface StepState {
  state: Progress;
  produces: string;
}

// The schedule as Home has it: its last answer, and whether the call for it failed.
export interface ScheduleFacts {
  answer: MealSchedule | null;
  failed: boolean;
}

// The period, the budget, the diet when there is one, and the country rule when the plan leaves a
// country out ("no US products"), so the rule is on Home before any trip is.
function setupStep(d: MealPlanDraft): StepState {
  const budget = budgetOf(d.prefs);
  const diet = dietOf(d.prefs);
  const rules = countryRules(d.settings);
  const rule = rules.excluded.length ? ruleText(rules) : '';
  return { state: 'complete', produces: [periodText(d), budget === null ? 'no budget' : `${budgetText(budget)} budget`,
    diet === 'any' ? '' : DIET_LABELS[diet], rule.charAt(0).toLowerCase() + rule.slice(1)].filter(Boolean).join(' · ') };
}

function ingredientsStep(f: WizardFacts, basket: BasketCounts | null): StepState {
  if (!f.meals) return { state: 'empty', produces: 'Once you pick meals' };
  if (f.failed.length) return { state: 'problem', produces: `Products for ${listOf(f.failed)} could not be checked` };
  if (f.checking.length) {
    const which = f.checking.length > 2 ? plural(f.checking.length, 'recipe', 'recipes') : listOf(f.checking);
    return { state: 'pending', produces: `Checking the products for ${which}…` };
  }
  if (f.basket === 'error') return { state: 'problem', produces: 'The ingredients could not be checked' };
  if (f.basket === 'waiting' || !basket) return { state: 'pending', produces: 'Checking the ingredients…' };
  if (!basket.lines) return { state: 'complete', produces: 'Nothing to buy' };
  const found = `${basket.found} of ${basket.lines} found nearby`;
  if (f.unanswered > 0) return { state: 'problem', produces: `${found} · ${f.unanswered} to answer` };
  return { state: 'complete', produces: basket.skipped ? `${found} · ${basket.skipped} skipped` : found };
}

function placeStep(d: MealPlanDraft): StepState {
  const meals = d.meals.length;
  const placed = d.meals.filter((m) => m.date !== null).length;
  if (!meals) return { state: 'empty', produces: 'Once you pick meals' };
  if (placed === meals) return { state: 'complete', produces: `${plural(meals, 'meal', 'meals')} placed` };
  if (placed) return { state: 'partial', produces: `${placed} of ${meals} meals placed` };
  return { state: 'empty', produces: `${plural(meals, 'meal', 'meals')} to place` };
}

function shopStep(s: MealPlanState, sc: ScheduleFacts): StepState {
  const d = s.draft;
  if (!sc.answer) {
    if (sc.failed) return { state: 'problem', produces: 'The trips could not be worked out' };
    // trips are made for the meals on days; none there, none to wait for
    return d.meals.some((m) => m.date !== null) ? { state: 'pending', produces: 'Working out the trips…' }
      : { state: 'empty', produces: 'Once meals are on days' };
  }
  const st = strategyOf(sc.answer, d.prefs.strategy);
  const trips = st?.trips ?? [];
  if (!st || !trips.length) return { state: 'empty', produces: 'No trips yet' };
  const looks = trips.map((t) => tripLook(t, approvedElsewhere(d, t.date, st.name)).kind);
  const approved = looks.filter((k) => k !== 'suggested').length;
  const review = looks.filter((k) => k === 'review').length;
  const total = costText(st.total_cost, st.total_is_floor, trips.some(tripPriced));
  const budget = budgetOf(d.prefs);
  const cost = budget === null || total === 'price unknown' ? total : `${total} of ${budgetText(budget)}`;
  const count = plural(trips.length, 'trip', 'trips');
  if (review) return { state: 'problem', produces: `${count} · ${review} changed since you approved · ${cost}` };
  if (approved === trips.length) return { state: 'complete', produces: `${count}, all approved · ${cost}` };
  if (approved) return { state: 'partial', produces: `${count} · ${approved} approved · ${cost}` };
  return { state: 'ready', produces: `${count} · ${cost}` };
}

// mark: when this plan's events last went to a calendar (mealplan/exported.ts), if they have;
// timing: the times and reminders the Calendar stage would send now.
function calendarStep(s: MealPlanState, sc: ScheduleFacts, mark: ExportMark | null,
  timing: CalendarTiming | null): StepState {
  if (!s.draft.trips.length) return { state: 'empty', produces: 'Once a trip is approved' };
  const a = sc.answer?.approved_schedule ?? null;
  if (!sc.answer) return sc.failed ? { state: 'problem', produces: 'The events could not be worked out' }
    : { state: 'pending', produces: 'Working out the events…' };
  if (!a || a.v !== 1 || !Array.isArray(a.cooks)) return { state: 'empty', produces: 'Nothing to add yet' };
  if (a.blocked?.length) return { state: 'problem', produces: a.blocked[0].message };
  if (!a.exportable) return { state: 'problem', produces: 'A trip needs your review first' };
  const n = Object.values(includeCounts(a)).reduce((t, x) => t + x, 0);
  if (!n) return { state: 'empty', produces: 'Nothing to add yet' };
  const ready = `${plural(n, 'event', 'events')} ready`;
  const sent = exportState(mark, a, timing);
  if (sent === 'current' && mark) return { state: 'complete', produces: exportedText(mark) };
  if (sent === 'partial' && mark) return { state: 'partial', produces: exportedText(mark, n) };
  if (sent === 'changed' && mark) return { state: 'stale', produces: `${ready} · ${changedSinceText(mark.how)}` };
  return { state: 'ready', produces: ready };
}

// The six steps with their state and what they have produced, and the one to continue with.
// exported: this plan's mark from mealplan/exported.ts, null when its events never went to a calendar;
// timing: the times and reminders the Calendar stage would send now, which the mark is compared with.
export function homeTasks(s: MealPlanState, f: WizardFacts, basket: BasketCounts | null, sc: ScheduleFacts,
  exported: ExportMark | null = null, timing: CalendarTiming | null = null): HomeTasks {
  const d = s.draft;
  const states: Record<StepNo, StepState> = {
    1: setupStep(d),
    2: f.meals > 0 ? { state: 'complete', produces: pickedText(d) } : { state: 'empty', produces: 'No meals yet' },
    3: ingredientsStep(f, basket),
    4: placeStep(d),
    5: shopStep(s, sc),
    6: calendarStep(s, sc, exported, timing),
  };
  const reach = furthest(f);
  const next = STEPS.find(({ n }) => n > 1 && states[n].state !== 'complete')?.n ?? 6;
  const tasks = STEPS.map(({ n, name }): HomeTask => {
    const { state, produces } = states[n];
    const open = n <= reach;
    let tag: HomeTag;
    if (state === 'complete') tag = 'done';
    else if (state === 'problem') tag = 'attention';
    else if (state === 'stale') tag = 'changed';
    else if (n === next) tag = state === 'partial' || state === 'pending' ? 'progress' : 'next';
    else if (!open || state === 'empty') tag = 'blocked';
    else tag = 'progress';
    return { n, name, tag, produces, open };
  });
  return { tasks, next, done: STEPS.every(({ n }) => states[n].state === 'complete') };
}

// ─── The next trip ───────────────────────────────────────────

export interface NextTrip {
  date: CivilDate;
  when: string;                    // "Today", "Tomorrow", or the day
  day: string;                     // "Fri 13 Nov"
  stores: string;                  // "Pantry Mart Downtown and GreenLeaf Grocers Kitsilano"
  items: string;                   // "25 items"
  cost: string;                    // "$112.05", "at least $4.00", "price unknown"
  look: TripLook;
  // how far the shopper got in the store (in-store mode's ticks), once anything is in the basket
  basket: { done: number; total: number; text: string } | null;
  // the plan's country rule and the labels this trip asks the shopper to read ("No US products ·
  // 2 to check on the label"); null while the plan has no rules
  origin: string | null;
}

// The first trip of the strategy shown from today on, approved or not (its state says which);
// none when the plan has no trip left to shop for. A day approved under the other way to shop is
// shown as approved, with its approved list (board.ts tripToShop), the one in-store mode opens.
// ticked: the products in that trip's basket (mealplan/shopping.ts), so a trip begun in the store
// says how far it got ("3 of 8 in the basket").
export function nextTrip(s: MealPlanState, sc: MealSchedule | null, today: CivilDate,
  tickedOn: (date: CivilDate) => readonly number[] = () => []): NextTrip | null {
  const d = s.draft;
  const st = strategyOf(sc, d.prefs.strategy);
  const first = [...(st?.trips ?? [])].filter((x) => daysBetween(today, x.date) >= 0)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  if (!first || !st) return null;
  const t = tripToShop(sc, d, first.date) ?? first;
  const ahead = daysBetween(today, t.date);
  const day = dayLabel(t.date);
  const rows = shopRows(t);
  const has = new Set(tickedOn(t.date));
  const done = rows.filter((r) => has.has(r.productId)).length;
  return {
    date: t.date, day, when: ahead === 0 ? 'Today' : ahead === 1 ? 'Tomorrow' : day,
    stores: t.stores.length ? listOf(t.stores) : 'No store chosen yet',
    items: plural(rows.length, 'item', 'items'),
    cost: costText(t.total_cost, t.total_is_floor, tripPriced(t)),
    look: tripLook(t, approvedElsewhere(d, t.date, st.name)),
    basket: done ? { done, total: rows.length,
      text: done === rows.length ? 'All in the basket' : `${done} of ${rows.length} in the basket` } : null,
    origin: listOriginText(countryRules(d.settings), rows.map((r) => r.origin)),
  };
}
