// Home: the greeting, the plan's six steps as a task list with a state in words and what each
// has produced, the one step Continue opens, and the next trip to shop for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  basketCounts, firstRecipe, greeting, homeTasks, nextTrip, periodText, pickedText, planHeading,
} from '../src/mealplan/home.ts';
import type { BasketCounts, HomeTasks } from '../src/mealplan/home.ts';
import { eventsSignature } from '../src/mealplan/exported.ts';
import type { ExportMark } from '../src/mealplan/exported.ts';
import type { MealPlanState } from '../src/mealplan/model.ts';
import { wizardFacts } from '../src/mealplan/wizard.ts';
import type { ApprovedSchedule, MealBasket, MealSchedule, ResolvedRecipe, Trip } from '../src/types.ts';
import { D, add, line, planWith, run, schedule, trip } from './helpers/mealplan.ts';

const BASKET: MealBasket = JSON.parse(readFileSync(new URL('./fixtures/mealplan-basket.json', import.meta.url), 'utf8'));
const PIZZA = 'starter:pepperoni_pizza';
const RICE = 'starter:chicken_fried_rice';

const resolved = (key: string, title: string): ResolvedRecipe => ({
  key, title, status: 'ok', message: '', servings: 2, servings_basis: 'source', label: null, lines: [],
  not_stocked: [], out_of_range: [], skipped: [], llm_cost_usd: 0, model_used: 'demo', burr_run: '', cached: false,
});

// Pepperoni Pizza twice and Chicken Fried Rice once, their products checked and every meal on a day.
function placedPlan(budget: number | null = null): MealPlanState {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2), add('chicken_fried_rice', 'Chicken Fried Rice', 1));
  s = run(s, { type: 'setResolved', resolved: [resolved(PIZZA, 'Pepperoni Pizza'), resolved(RICE, 'Chicken Fried Rice')] },
    { type: 'place', mealId: `${PIZZA}#1`, date: D(1), slot: 'dinner' },
    { type: 'place', mealId: `${PIZZA}#2`, date: D(3), slot: 'dinner' },
    { type: 'place', mealId: `${RICE}#1`, date: D(2), slot: 'dinner' });
  return budget === null ? s : run(s, { type: 'setPrefs', prefs: { budget } });
}

const ALL_FOUND: BasketCounts = { lines: 16, found: 16, unanswered: 0, skipped: 0 };
const ok = (s: MealPlanState, unanswered = 0) => wizardFacts(s, false, { state: 'ok', unanswered });
const tags = (h: HomeTasks) => h.tasks.map((t) => t.tag);
const lines = (h: HomeTasks) => h.tasks.map((t) => t.produces);

const twoTrips = (over: [Partial<Trip>, Partial<Trip>] = [{}, {}]): Trip[] => [
  trip(D(1), [line(10, 'Chicken Breast', { price: 9.36 }), line(19, 'Whole Milk 1L', { price: 2.93 })],
    { total_cost: 12.29, ...over[0] }),
  trip(D(4), [line(61, 'Flour', { price: 5.62 })], { total_cost: 5.62, ...over[1] }),
];

function withTrips(trips: Trip[], approved: ApprovedSchedule | null = null, rev = 1): MealSchedule {
  const sc = schedule(rev, [], trips);
  sc.strategies[0].total_cost = trips.reduce((t, x) => t + (x.total_cost ?? 0), 0);
  return { ...sc, approved_schedule: approved };
}

const calendar = (trips: number, cooks: number, over: Partial<ApprovedSchedule> = {}): ApprovedSchedule => ({
  trips: Array.from({ length: trips }, (_, i) => ({ id: `fresh-${i}`, strategy: 'fresh' as const, date: D(i + 1),
    status: 'approved' as const, stores: [], total_cost: 1, total_is_floor: false, list_text: '' })),
  actions: [], exportable: true, v: 1,
  cooks: Array.from({ length: cooks }, (_, i) => ({ item_id: `c${i}`, meal_id: `m${i}`, recipe_key: PIZZA,
    title: 'Pepperoni Pizza', calendar_deleted: false, note: null })),
  reminders: [], blocked: [], ...over,
});

test('the greeting follows the clock, and the plan is named by its days', () => {
  assert.deepEqual([4, 5, 11, 12, 17, 18, 23, 0].map(greeting), ['Good evening', 'Good morning', 'Good morning',
    'Good afternoon', 'Good afternoon', 'Good evening', 'Good evening', 'Good evening']);
  assert.equal(periodText(planWith(14).draft), 'Fri 9 Oct – Thu 22 Oct');
});

test('what Pick meals produced, in meals people count: dinners, snacks, or meals for a mix', () => {
  assert.equal(pickedText(planWith(7).draft), 'No meals yet');
  assert.equal(pickedText(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 3)).draft), '3 dinners picked');
  assert.equal(pickedText(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1)).draft), '1 dinner picked');
  assert.equal(pickedText(planWith(14, add('pepperoni_pizza', 'Pepperoni Pizza', 8),
    add('mango_milkshake', 'Mango Milkshake', 7, 'snack')).draft), '8 dinners and 7 snacks picked');
  assert.equal(pickedText(planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1), add('a', 'A', 2, 'lunch'),
    add('b', 'B', 1, 'breakfast')).draft), '4 meals picked');
});

test('while the products are checked: Check ingredients is in progress, and what waits on it says so', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 3));
  const f = wizardFacts(s, false, { state: 'waiting', unanswered: 0 });
  const h = homeTasks(s, f, null, { answer: null, failed: false });
  assert.deepEqual(h.tasks.map((t) => t.name), ['Set up', 'Pick meals', 'Check ingredients', 'Place on days', 'Shop', 'Calendar']);
  assert.deepEqual(tags(h), ['done', 'done', 'progress', 'blocked', 'blocked', 'blocked']);
  assert.deepEqual(lines(h), ['Fri 9 Oct – Thu 15 Oct · no budget', '3 dinners picked',
    'Checking the products for Pepperoni Pizza…', '3 meals to place', 'Once meals are on days', 'Once a trip is approved']);
  assert.equal(h.next, 3);
});

test('a plan ready to shop: everything before Shop is done, Shop is next, Calendar waits for a trip', () => {
  const s = placedPlan(90);
  const h = homeTasks(s, ok(s), ALL_FOUND, { answer: withTrips(twoTrips()), failed: false });
  assert.deepEqual(tags(h), ['done', 'done', 'done', 'done', 'next', 'blocked']);
  assert.deepEqual(lines(h), ['Fri 9 Oct – Thu 15 Oct · $90 budget', '3 dinners picked', '16 of 16 found nearby',
    '3 meals placed', '2 trips · $17.91 of $90', 'Once a trip is approved']);
  assert.equal(h.next, 5);
  assert.deepEqual(h.tasks.map((t) => t.open), [true, true, true, true, true, false]);
});

test('ingredients nobody nearby sells need an answer before the plan goes on', () => {
  const s = placedPlan();
  const h = homeTasks(s, ok(s, 2), { lines: 16, found: 14, unanswered: 2, skipped: 0 },
    { answer: withTrips(twoTrips()), failed: false });
  assert.deepEqual(tags(h), ['done', 'done', 'attention', 'done', 'blocked', 'blocked']);
  assert.equal(h.tasks[2].produces, '14 of 16 found nearby · 2 to answer');
  assert.equal(h.next, 3);
  // answered by doing without: done, and says how many were skipped
  const skipped = homeTasks(s, ok(s), { lines: 16, found: 14, unanswered: 0, skipped: 2 },
    { answer: withTrips(twoTrips()), failed: false });
  assert.equal(skipped.tasks[2].produces, '14 of 16 found nearby · 2 skipped');
  assert.equal(skipped.tasks[2].tag, 'done');
});

test('one trip approved of two: Shop is in progress, and the Calendar has its events ready', () => {
  const trips = twoTrips();
  let s = placedPlan(90);
  s = run(s, { type: 'approveTrip', trip: trips[0], strategy: 'fresh', rev: s.draft.rev });
  const answer = withTrips(twoTrips([{ status: 'approved' }, {}]), calendar(1, 2));
  const h = homeTasks(s, ok(s), ALL_FOUND, { answer, failed: false });
  assert.deepEqual(tags(h), ['done', 'done', 'done', 'done', 'progress', 'progress']);
  assert.equal(h.tasks[4].produces, '2 trips · 1 approved · $17.91 of $90');
  assert.equal(h.tasks[5].produces, '3 events ready');
  assert.equal(h.next, 5);
  // both approved: Shop is done and Calendar is next
  s = run(s, { type: 'approveTrip', trip: trips[1], strategy: 'fresh', rev: s.draft.rev });
  const all = homeTasks(s, ok(s), ALL_FOUND,
    { answer: withTrips(twoTrips([{ status: 'approved' }, { status: 'approved' }]), calendar(2, 3)), failed: false });
  assert.deepEqual(tags(all), ['done', 'done', 'done', 'done', 'done', 'next']);
  assert.equal(all.tasks[4].produces, '2 trips, all approved · $17.91 of $90');
  assert.equal(all.tasks[5].produces, '5 events ready');
  assert.equal(all.next, 6);
});

test('the Calendar is done once its events went to a calendar, and says when the plan moved on since', () => {
  const trips = twoTrips();
  let s = placedPlan(90);
  s = run(s, { type: 'approveTrip', trip: trips[0], strategy: 'fresh', rev: s.draft.rev },
    { type: 'approveTrip', trip: trips[1], strategy: 'fresh', rev: s.draft.rev + 1 });
  const both = twoTrips([{ status: 'approved' }, { status: 'approved' }]);
  const events = calendar(2, 3);
  const sent: ExportMark = { id: s.draft.id, sig: eventsSignature(events), events: 5,
    kinds: ['trips', 'cooks', 'reminders'], timing: '0123abcd', how: 'file', at: '2026-10-09T18:00:00.000Z' };
  const done = homeTasks(s, ok(s), ALL_FOUND, { answer: withTrips(both, events), failed: false }, sent);
  assert.deepEqual(tags(done), ['done', 'done', 'done', 'done', 'done', 'done']);
  assert.equal(done.tasks[5].produces, '5 events downloaded');
  assert.equal(done.done, true, 'the week is planned');
  const google = homeTasks(s, ok(s), ALL_FOUND, { answer: withTrips(both, events), failed: false },
    { ...sent, how: 'google' });
  assert.equal(google.tasks[5].produces, '5 events in Google Calendar');
  // only the trips went: part of the plan is in a calendar, so the step is under way, not done
  const part = homeTasks(s, ok(s), ALL_FOUND, { answer: withTrips(both, events), failed: false },
    { ...sent, kinds: ['trips'], events: 2 });
  assert.deepEqual([part.tasks[5].tag, part.tasks[5].produces, part.next, part.done],
    ['progress', '2 of 5 events downloaded', 6, false]);
  // another cook day since: the events handed over are not the plan's any more
  const moved = homeTasks(s, ok(s), ALL_FOUND, { answer: withTrips(both, calendar(2, 4)), failed: false }, sent);
  assert.equal(moved.tasks[5].tag, 'changed');
  assert.equal(moved.tasks[5].produces, '6 events ready · changed since you downloaded them');
  assert.equal(moved.next, 6);
  assert.equal(moved.done, false);
  // never handed over: ready, and Continue goes there
  const never = homeTasks(s, ok(s), ALL_FOUND, { answer: withTrips(both, events), failed: false });
  assert.deepEqual([never.tasks[5].tag, never.tasks[5].produces, never.next, never.done], ['next', '5 events ready', 6, false]);
});

test('a trip changed since it was approved needs attention, in Shop and in the Calendar', () => {
  const trips = twoTrips();
  let s = placedPlan();
  s = run(s, { type: 'approveTrip', trip: trips[0], strategy: 'fresh', rev: s.draft.rev });
  const answer = withTrips(twoTrips([{ status: 'needs_review' }, {}]), calendar(1, 2, { exportable: false }));
  const h = homeTasks(s, ok(s), ALL_FOUND, { answer, failed: false });
  assert.deepEqual(tags(h), ['done', 'done', 'done', 'done', 'attention', 'attention']);
  assert.equal(h.tasks[4].produces, '2 trips · 1 changed since you approved · $17.91');
  assert.equal(h.tasks[5].produces, 'A trip needs your review first');
  assert.equal(h.next, 5);
});

test('a schedule that failed, a plan with no meals and a failed products check say so', () => {
  const s = placedPlan();
  const failed = homeTasks(s, ok(s), ALL_FOUND, { answer: null, failed: true });
  assert.equal(failed.tasks[4].tag, 'attention');
  assert.equal(failed.tasks[4].produces, 'The trips could not be worked out');
  // on its way: in progress
  const coming = homeTasks(s, ok(s), ALL_FOUND, { answer: null, failed: false });
  assert.deepEqual([coming.tasks[4].tag, coming.tasks[4].produces], ['progress', 'Working out the trips…']);
  const none = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 0));
  const h = homeTasks(none, wizardFacts(none, false, { state: 'ok', unanswered: 0 }), null, { answer: null, failed: false });
  assert.deepEqual(tags(h), ['done', 'next', 'blocked', 'blocked', 'blocked', 'blocked']);
  assert.equal(h.tasks[1].produces, 'No meals yet');
  assert.equal(h.next, 2);
  const broken = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2));
  const bf = wizardFacts(broken, true, { state: 'waiting', unanswered: 0 });
  const b = homeTasks(broken, bf, null, { answer: null, failed: false });
  assert.equal(b.tasks[2].tag, 'attention');
  assert.equal(b.tasks[2].produces, 'Products for Pepperoni Pizza could not be checked');
});

test('the ingredients counted from the basket: found nearby, to answer, skipped', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2), add('chicken_fried_rice', 'Chicken Fried Rice', 1));
  assert.deepEqual(basketCounts(BASKET, s), { lines: 5, found: 3, unanswered: 2, skipped: 0 });
  s = run(s, { type: 'skipLine', recipeKey: RICE, lineNo: 6, ingredient: 'shaoxing wine', skip: true });
  assert.deepEqual(basketCounts(BASKET, s), { lines: 5, found: 3, unanswered: 1, skipped: 1 });
  // a recipe with no meals buys nothing
  s = run(s, { type: 'setWanted', key: RICE, wanted: 0 });
  assert.deepEqual(basketCounts(BASKET, s), { lines: 3, found: 2, unanswered: 1, skipped: 0 });
});

test('the next trip: the first from today, approved or not, with its day, stores, items and cost', () => {
  const s = placedPlan();
  const answer = withTrips(twoTrips([{ stores: ['Pantry Mart Downtown', 'GreenLeaf Grocers'] }, { status: 'approved' }]));
  const n = nextTrip(s, answer, D(0));
  assert.ok(n);
  assert.deepEqual([n.date, n.when, n.day, n.stores, n.items, n.cost, n.look.kind],
    [D(1), 'Tomorrow', 'Sat 10 Oct', 'Pantry Mart Downtown and GreenLeaf Grocers', '2 items', '$12.29', 'suggested']);
  assert.equal(nextTrip(s, answer, D(1))?.when, 'Today');
  const later = nextTrip(s, answer, D(2));
  assert.deepEqual([later?.date, later?.when, later?.look.kind], [D(4), 'Tue 13 Oct', 'approved']);
  assert.equal(nextTrip(s, answer, D(5)), null, 'every trip is behind us');
  assert.equal(nextTrip(s, null, D(0)), null);
  assert.equal(n.basket, null, 'nothing ticked yet');
});

test('a next trip approved under the other way to shop is that approved trip, not a suggestion', () => {
  let s = placedPlan();
  s = run(s, { type: 'approveTrip', trip: twoTrips()[0], strategy: 'fresh', rev: s.draft.rev },
    { type: 'setPrefs', prefs: { strategy: 'fewest_trips' } });
  const answer = withTrips(twoTrips([{ status: 'approved' }, {}]));
  answer.strategies[1].trips = twoTrips();
  const n = nextTrip(s, answer, D(0));
  assert.deepEqual([n?.date, n?.look.kind, n?.look.word, n?.items], [D(1), 'approved', 'Approved', '2 items'],
    'Shop fresh\'s approved list, which in-store mode opens');
  const later = nextTrip(s, answer, D(2));
  assert.equal(later?.look.kind, 'suggested', 'a day with no approval is the way shown');
});

test('the next trip says how far the shopper got in the store, from the ticks', () => {
  const s = placedPlan();
  const answer = withTrips(twoTrips([{ stores: ['Pantry Mart Downtown', 'GreenLeaf Grocers'] }, { status: 'approved' }]));
  const first = nextTrip(s, answer, D(0));
  assert.ok(first);
  const ids = answer.strategies[0].trips.find((t) => t.date === first.date)?.lines.map((ln) => ln.product.id) ?? [];
  const one = nextTrip(s, answer, D(0), (date) => (date === first.date ? [ids[0]] : []));
  assert.deepEqual(one?.basket, { done: 1, total: 2, text: '1 of 2 in the basket' });
  const all = nextTrip(s, answer, D(0), () => ids);
  assert.equal(all?.basket?.text, 'All in the basket');
  assert.equal(nextTrip(s, answer, D(0), () => [999])?.basket, null, 'a product not on the trip is not progress');
});

test('the steps are headed by the time the plan covers', () => {
  assert.equal(planHeading(7), 'This week');
  assert.equal(planHeading(14), 'These two weeks');
  assert.equal(planHeading(10), 'These 10 days');
});

test('the picture heading Home is the first meal cooked, else the first recipe picked', () => {
  assert.equal(firstRecipe(placedPlan().draft), PIZZA);
  const s = run(placedPlan(), { type: 'place', mealId: `${RICE}#1`, date: D(0), slot: 'dinner' });
  assert.equal(firstRecipe(s.draft), RICE);
  assert.equal(firstRecipe(planWith(7, add('chicken_fried_rice', 'Chicken Fried Rice', 1)).draft), RICE);
  assert.equal(firstRecipe(planWith(7).draft), null);
});
