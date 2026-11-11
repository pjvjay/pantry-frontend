// The Meal plan wizard's stages: the address, the gates between stages, where a stage opens and
// what the progress indicator shows.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPS, alliesText, alliesToAdd, clockText, furthest, gate, isOptional, isPlanHash, moveCountry, nextBlock,
  originRules, originSettings, routeStep, stepCaption, stepFromHash, stepHash, stepViews, waitWords, wizardFacts,
} from '../src/mealplan/wizard.ts';
import { canonicalHash } from '../src/routes.ts';
import { DEFAULT_ALLIES, DEFAULT_ORIGIN } from '../src/mealplan/model.ts';
import type { WizardFacts } from '../src/mealplan/wizard.ts';
import { add, planWith, run } from './helpers/mealplan.ts';

const PIZZA = 'starter:pepperoni_pizza';
const RICE = 'starter:chicken_fried_rice';

// A plan that can go all the way: meals, products checked, nothing unanswered, a trip approved.
const READY: WizardFacts = { meals: 3, checking: [], failed: [], basket: 'ok', unanswered: 0, approved: 1 };

test('six stages, each named for what the shopper does there, with its own address under #/plan', () => {
  assert.deepEqual(STEPS.map((s) => s.name),
    ['Set up', 'Pick meals', 'Check ingredients', 'Place on days', 'Shop', 'Calendar']);
  assert.equal(stepHash(3), '#/plan?step=3');
  // the heading is the name; the line over it says where it is, and that Set up can be skipped
  assert.equal(stepCaption(5), 'Step 5 of 6');
  assert.equal(stepCaption(1), 'Step 1 of 6 · optional');
  assert.deepEqual(STEPS.filter((s) => isOptional(s.n)).map((s) => s.n), [1]);
  for (const { n } of STEPS) {
    assert.equal(stepFromHash(stepHash(n)), n);
    // a stage's address is already the shell's own: it is never rewritten
    assert.equal(canonicalHash(stepHash(n)), stepHash(n));
  }
});

test('the address names a stage, or none; Google\'s return lands on Calendar', () => {
  assert.equal(stepFromHash('#/plan'), null);
  assert.equal(stepFromHash('#/plan?step=0'), null);
  assert.equal(stepFromHash('#/plan?step=7'), null);
  assert.equal(stepFromHash('#/plan?step=2.5'), null);
  assert.equal(stepFromHash('#/plan?step=x'), null);
  assert.equal(stepFromHash('#/workshop/planner?step=2'), null, 'another page');
  assert.equal(stepFromHash('#/shop?step=2'), null, 'the shopping plan on its own is not a stage');
  assert.equal(stepFromHash('#/plan?calendar=connected'), 6);
  assert.equal(stepFromHash('#/plan?calendar=error&reason=access_denied'), 6);
  assert.equal(stepFromHash('#/plan?step=2&calendar=denied'), 6);
  assert.equal(stepFromHash('#plan?step=4'), 4);
});

test('the old #/mealplan address still names its stage, before and after the shell rewrites it', () => {
  assert.equal(stepFromHash('#/mealplan'), null);
  assert.equal(stepFromHash('#/mealplan?step=2'), 2);
  assert.equal(stepFromHash('#mealplan?step=4'), 4);
  assert.equal(stepFromHash('#/mealplan?step=7'), null);
  assert.equal(stepFromHash('#/planner?step=2'), null, 'the old Planner tab');
  // Google's return to a hub that was handed the old address: Calendar either way
  for (const old of ['#/mealplan?calendar=connected', '#/mealplan?calendar=error&reason=access_denied',
    '#/mealplan?step=2&calendar=denied']) {
    assert.equal(stepFromHash(old), 6, old);
    assert.equal(stepFromHash(canonicalHash(old)), 6, canonicalHash(old));
  }
  assert.equal(stepFromHash(canonicalHash('#/mealplan?step=3')), 3);
  assert.ok(isPlanHash('#/plan') && isPlanHash('#/mealplan?step=1') && isPlanHash('#/plan/'));
  assert.ok(!isPlanHash('#/planner') && !isPlanHash('#/shop') && !isPlanHash('#/home') && !isPlanHash(''));
});

test('Pick meals needs a meal, Check ingredients every product checked and answered, Calendar a trip', () => {
  assert.equal(gate(1, { ...READY, meals: 0 }).state, 'ok', 'Set up needs nothing');
  assert.deepEqual(gate(2, { ...READY, meals: 0 }), { step: 2, state: 'blocked', text: 'Add at least one meal' });
  assert.deepEqual(gate(3, { ...READY, checking: ['Pepperoni Pizza'] }),
    { step: 3, state: 'pending', text: 'Checking the products for Pepperoni Pizza…' });
  assert.equal(gate(3, { ...READY, checking: ['Dal', 'Pepperoni Pizza'] }).text,
    'Checking the products for Dal and Pepperoni Pizza…');
  assert.equal(gate(3, { ...READY, checking: ['A', 'B', 'C', 'D'] }).text, 'Checking the products for 4 recipes…');
  assert.equal(gate(3, { ...READY, basket: 'waiting' }).state, 'pending');
  assert.match(gate(3, { ...READY, basket: 'error' }).text, /could not be checked: try again/);
  assert.equal(gate(3, { ...READY, failed: ['Pepperoni Pizza', 'Dal'] }).text,
    'The products for Pepperoni Pizza and Dal could not be checked: try again, or take them out in Pick meals');
  assert.equal(gate(3, { ...READY, unanswered: 2 }).text,
    'Answer 2 ingredients the plan cannot buy nearby: another product, skip it, or other meals');
  assert.equal(gate(3, { ...READY, unanswered: 1 }).state, 'blocked');
  assert.equal(gate(4, READY).state, 'ok');
  assert.deepEqual(gate(5, { ...READY, approved: 0 }),
    { step: 5, state: 'blocked', text: 'Approve at least one shopping trip' });
  for (const { n } of STEPS) assert.equal(gate(n, READY).state, 'ok');
});

test('Next is stopped by the first gate not passed up to the stage, a later edit included', () => {
  assert.equal(nextBlock(1, { ...READY, meals: 0 }), null, 'Set up moves on with no meals');
  assert.equal(nextBlock(2, { ...READY, meals: 0 })?.text, 'Add at least one meal');
  // on Place on days, after taking every meal out
  assert.equal(nextBlock(4, { ...READY, meals: 0 })?.step, 2);
  assert.equal(nextBlock(3, { ...READY, basket: 'waiting' })?.state, 'pending');
  assert.equal(nextBlock(4, { ...READY, approved: 0 }), null);
  assert.equal(nextBlock(5, { ...READY, approved: 0 })?.step, 5);
  assert.equal(nextBlock(5, READY), null);
});

test('a stage is reachable when no gate before it is blocked; pending ones do not stop it', () => {
  assert.equal(furthest({ ...READY, meals: 0 }), 2);
  assert.equal(furthest({ ...READY, unanswered: 1 }), 3);
  assert.equal(furthest({ ...READY, basket: 'waiting' }), 6);
  assert.equal(furthest({ ...READY, approved: 0 }), 5);
  assert.equal(furthest(READY), 6);
});

test('a stage opens where asked, else where the shopper was, else by the plan; never too far', () => {
  assert.equal(routeStep(null, { ...READY, meals: 0 }, null, false), 2,
    'a new plan starts at Pick meals: Set up is optional');
  assert.equal(routeStep(1, { ...READY, meals: 0 }, null, false), 1, 'Set up is still there when asked for');
  assert.equal(routeStep(null, READY, null, true), 4, 'a plan with recipes opens on Place on days');
  assert.equal(routeStep(null, READY, 2, true), 2, 'back where the shopper was');
  assert.equal(routeStep(6, READY, 2, true), 6);
  assert.equal(routeStep(6, { ...READY, approved: 0 }, null, true), 5, 'no approved trip, no Calendar');
  assert.equal(routeStep(5, { ...READY, meals: 0 }, null, false), 2, 'no meals: no further than Meals');
  assert.equal(routeStep(null, { ...READY, unanswered: 2 }, null, true), 3);
});

test('the progress indicator: done, current and ahead, and a done stage an edit has since undone', () => {
  const views = stepViews(4, { ...READY, approved: 0 });
  assert.deepEqual(views.map((v) => v.state), ['done', 'done', 'done', 'current', 'ahead', 'ahead']);
  assert.deepEqual(views.map((v) => v.optional), [true, false, false, false, false, false]);
  assert.deepEqual(views.map((v) => v.reachable), [true, true, true, true, true, false]);
  assert.ok(views.every((v) => v.attention === null));
  const undone = stepViews(4, { ...READY, unanswered: 1 });
  assert.equal(undone[2].attention, 'Answer 1 ingredient the plan cannot buy nearby: another product, skip it, or other meals');
  assert.deepEqual(undone.map((v) => v.reachable), [true, true, true, false, false, false]);
  assert.ok(views.every((v) => !v.finished));
});

test('the last stage is finished once its events have gone to a calendar, and only while it can be reached', () => {
  const finished = stepViews(6, READY, true);
  assert.deepEqual(finished.map((v) => v.finished), [false, false, false, false, false, true]);
  assert.equal(finished[5].state, 'current', 'still the stage shown');
  assert.deepEqual(stepViews(6, READY).map((v) => v.finished), [false, false, false, false, false, false]);
  assert.equal(stepViews(2, { ...READY, approved: 0 }, true)[5].finished, false, 'no approved trip: not reachable');
});

test('the facts come from the plan, the last resolve call and the basket', () => {
  let s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 2), add('chicken_fried_rice', 'Chicken Fried Rice', 1));
  const basket = { state: 'ok' as const, unanswered: 0 };
  assert.deepEqual(wizardFacts(s, false, basket), { meals: 3, checking: ['Pepperoni Pizza', 'Chicken Fried Rice'],
    failed: [], basket: 'ok', unanswered: 0, approved: 0 });
  // the call failed: what it was checking is failed, not checking
  assert.deepEqual(wizardFacts(s, true, basket).failed, ['Pepperoni Pizza', 'Chicken Fried Rice']);
  s = run(s, { type: 'setResolved', resolved: [
    { key: PIZZA, title: 'Pepperoni Pizza', status: 'ok', lines: [] } as never,
    { key: RICE, title: 'Chicken Fried Rice', status: 'llm_error', lines: [] } as never] });
  const f = wizardFacts(s, false, { state: 'waiting', unanswered: 0 });
  assert.deepEqual(f.checking, []);
  assert.deepEqual(f.failed, ['Chicken Fried Rice']);
  assert.equal(f.basket, 'waiting');
});

test('origin rules: the United States left out, Canada first, then the allies in the shopper\'s order', () => {
  const r = originRules(DEFAULT_ORIGIN);
  assert.deepEqual(r, { excludeUS: true, preferCanada: true, allies: [...DEFAULT_ALLIES], otherExcluded: [] });
  assert.deepEqual(originSettings(r), DEFAULT_ORIGIN, 'round trip');
  assert.equal(alliesText(r.allies), 'United Kingdom, France, Germany and 12 more');
  assert.equal(alliesText(['Japan', 'Mexico']), 'Japan and Mexico');
  assert.equal(alliesText([]), 'no other countries');
  // a plan saved before the wizard has no rules at all
  assert.deepEqual(originRules({}), { excludeUS: false, preferCanada: false, allies: [], otherExcluded: [] });
  assert.deepEqual(originSettings(originRules({})), { exclude_origin: [], preference: [] });
  // Canada goes first when preferred; other exclusions are kept
  assert.deepEqual(originSettings(originRules({ exclude_origin: ['China', 'United States'], preference: ['Japan', 'Canada'] })),
    { exclude_origin: ['United States', 'China'], preference: ['Canada', 'Japan'] });
  assert.deepEqual(originSettings({ ...r, excludeUS: false, preferCanada: false }).exclude_origin, []);
});

test('the allies reorder one place at a time, and a removed one can be added back', () => {
  const list = ['France', 'Japan', 'Mexico'];
  assert.deepEqual(moveCountry(list, 'Japan', -1), ['Japan', 'France', 'Mexico']);
  assert.deepEqual(moveCountry(list, 'Japan', 1), ['France', 'Mexico', 'Japan']);
  assert.deepEqual(moveCountry(list, 'France', -1), list, 'already first');
  assert.deepEqual(moveCountry(list, 'Mexico', 1), list, 'already last');
  assert.deepEqual(moveCountry(list, 'Peru', 1), list);
  assert.deepEqual(alliesToAdd(DEFAULT_ALLIES.filter((c) => c !== 'Japan' && c !== 'Spain')), ['Spain', 'Japan']);
  assert.deepEqual(alliesToAdd(DEFAULT_ALLIES), []);
});

test('Next waiting on a pending gate says so in a few words, with the time it has waited', () => {
  const checking = nextBlock(3, { ...READY, checking: ['Dal'] });
  assert.equal(checking?.state, 'pending');
  assert.equal(waitWords(checking!), 'Checking ingredients…');
  assert.equal(waitWords(gate(3, { ...READY, basket: 'waiting' })), 'Checking ingredients…');
  assert.equal(clockText(0), '0:00');
  assert.equal(clockText(4.9), '0:04');
  assert.equal(clockText(75), '1:15');
  assert.equal(clockText(720), '12:00');
  assert.equal(clockText(-3), '0:00');
});
