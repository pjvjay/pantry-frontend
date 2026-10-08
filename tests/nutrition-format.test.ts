// Nutrition as the shopper reads it: a number, "≥ N" or "unknown", never 0 for a missing
// figure, and the "demo amounts" badge wherever demo_amounts is true. Also the daily targets
// the reducer keeps and the saved plan carries.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMO_BADGE, DEMO_TITLE, amountText, amountsBasisText, dayLine, formatAmount, nutrientText,
  nutritionChip, parseBound, periodBand, targetVerdicts, targetsProblem, totalTitle,
} from '../src/nutritionFormat.ts';
import { step } from '../src/mealplan/model.ts';
import { parsePlan, serialize } from '../src/mealplan/persist.ts';
import type { DayNutrition, NutrientTotal, PeriodNutrition } from '../src/types.ts';
import { TODAY, planWith } from './helpers/mealplan.ts';

const total = (amount: number | null, status: NutrientTotal['status'], unit = 'kcal',
  gaps: string[] = []): NutrientTotal => ({
  amount, unit, status, complete: status === 'complete', lines_counted: 3, lines_total: 3, gaps,
});

test('a complete total is a number, a partial one a lower bound, a missing one unknown', () => {
  assert.equal(amountText(total(642, 'complete')), '642 kcal');
  assert.equal(amountText(total(610.4, 'at_least')), '≥ 610 kcal');
  assert.equal(amountText(total(null, 'unknown')), 'unknown');
  // a status that says unknown wins over a stray number
  assert.equal(amountText(total(0, 'unknown')), 'unknown');
  assert.equal(amountText(undefined), 'unknown');
  assert.equal(nutrientText('protein_g', total(24.6, 'complete', 'g')), '25 g protein');
  assert.equal(nutrientText('fibre_g', total(2.04, 'at_least', 'g')), '≥ 2 g fibre');
  assert.equal(nutrientText('fibre_g', total(2.46, 'complete', 'g')), '2.5 g fibre');
  assert.equal(nutrientText('energy_kcal', null), 'kcal unknown');
  assert.equal(nutrientText('sodium_mg', total(null, 'unknown', 'mg')), 'sodium unknown');
  assert.equal(formatAmount(23100.4, 'kcal'), '23,100');
});

test('never 0 for a figure that is not there', () => {
  for (const t of [null, undefined, total(null, 'unknown'), total(null, 'at_least')]) {
    assert.doesNotMatch(amountText(t), /\b0\b/);
    assert.doesNotMatch(nutrientText('energy_kcal', t), /\b0\b/);
  }
  const chip = nutritionChip({}, false);
  assert.equal(chip.text, 'kcal unknown · protein unknown');
  assert.ok(chip.parts.every((p) => p.status === 'unknown'));
  // a real zero the server counted is still shown as 0
  assert.equal(amountText(total(0, 'complete', 'g')), '0 g');
});

test('the demo-amounts badge is there exactly when demo_amounts is', () => {
  const totals = { energy_kcal: total(610, 'at_least'), protein_g: total(25, 'complete', 'g') };
  const demo = nutritionChip(totals, true);
  assert.deepEqual(demo.badge, { text: DEMO_BADGE, title: DEMO_TITLE });
  assert.equal(demo.text, '≥ 610 kcal · 25 g protein · demo amounts');
  assert.equal(nutritionChip(totals, false).badge, null);
  assert.equal(nutritionChip(null, true).text, 'kcal unknown · protein unknown · demo amounts');
  assert.deepEqual(amountsBasisText(['demo_house_amounts', 'parsed_from_your_paste']),
    ['demo amounts', 'amounts from your paste']);
});

test('a lower bound names what it misses in its title', () => {
  assert.match(totalTitle('sugars_g', total(40, 'at_least', 'g', ['All-Purpose Flour: no sugars value'])),
    /At least this much sugars; not counted: All-Purpose Flour/);
  assert.match(totalTitle('energy_kcal', null), /No energy figure/);
});

const day = (over: Partial<DayNutrition> = {}): DayNutrition => ({
  date: '2026-10-10', meals: [{ meal_id: 'm#1', recipe_key: 'starter:x', title: 'X', slot: 'snack',
    basis: 'per_serving', status: 'complete', totals: {}, amounts_basis: ['demo_house_amounts'],
    demo_amounts: true }],
  meals_counted: ['breakfast', 'lunch', 'dinner', 'snack'], all_meals_planned: false,
  totals: { energy_kcal: total(271, 'at_least'), protein_g: total(9.1, 'at_least', 'g') },
  complete: false, amounts_basis: ['demo_house_amounts'], demo_amounts: true, note: '',
  targets: null, ...over,
});

test('a day footer reads "≥ N kcal · demo amounts" and says why it is incomplete', () => {
  const line = dayLine(day(), 'computed');
  assert.equal(line.chip?.text, '≥ 271 kcal · ≥ 9.1 g protein · demo amounts');
  assert.equal(line.status, 'incomplete: not every slot has a meal');
  assert.equal(dayLine(day({ complete: true, all_meals_planned: true }), 'computed').status, 'complete day');
  // an older API, or tables not deployed: no number at all
  assert.deepEqual(dayLine(null, 'unknown'),
    { chip: null, status: 'nutrition unknown: this API does not compute nutrition' });
  assert.match(dayLine(null, 'not_deployed').status, /not deployed/);
  assert.equal(dayLine(day({ meals: [] }), 'computed').status, 'no meals planned');
});

const period = (over: Partial<PeriodNutrition> = {}): PeriodNutrition => ({
  days_total: 14, days_complete: 0, incomplete_days: [], per_day_average_over_complete_days: null,
  lower_bound_total: { energy_kcal: { amount: 7767.2, complete: false },
    protein_g: { amount: 382.6, complete: false } },
  slots_counted: ['dinner'], amounts_basis: ['demo_house_amounts'], demo_amounts: true, note: '',
  ...over,
});

test('the period band counts complete days and averages over them only', () => {
  assert.deepEqual(periodBand(period(), 'computed').parts, [
    '0 of 14 days complete',
    'no complete day, so no daily average',
    'fortnight total ≥ 7,767 kcal, ≥ 383 g protein (demo amounts)',
  ]);
  const nine = periodBand(period({ days_complete: 9,
    per_day_average_over_complete_days: { energy_kcal: 1840.2, protein_g: 96.4 } }), 'computed');
  assert.deepEqual(nine.parts, [
    '9 of 14 days complete',
    'average 1,840 kcal, 96 g protein per day over complete days (demo amounts)',
    'fortnight total ≥ 7,767 kcal, ≥ 383 g protein',
  ]);
  assert.equal(nine.badge, true);
  assert.equal(periodBand(period({ days_total: 7, demo_amounts: false }), 'computed').parts[2],
    'week total ≥ 7,767 kcal, ≥ 383 g protein');
  assert.deepEqual(periodBand(null, 'unknown').parts, ['nutrition unknown: this API does not compute nutrition']);
});

test('targets: a bound or two, never negative, and no Health Canada label on energy or protein', () => {
  assert.equal(targetsProblem({}), null);
  assert.equal(targetsProblem({ protein_g: { min: 50, source: 'you' } }), null);
  assert.match(targetsProblem({ vitamin_c: { min: 1 } }) ?? '', /not a nutrient/);
  assert.match(targetsProblem({ protein_g: {} }) ?? '', /needs a minimum/);
  assert.match(targetsProblem({ fat_g: { min: 90, max: 50 } }) ?? '', /above its maximum/);
  assert.match(targetsProblem({ sodium_mg: { max: -1 } }) ?? '', /0 or more/);
  assert.match(targetsProblem({ energy_kcal: { max: 2000, source: 'health_canada_dv' } }) ?? '',
    /no Daily Value for energy/);
  assert.equal(parseBound(''), null);
  assert.equal(parseBound(' 50 '), 50);
  assert.equal(parseBound('-3'), 'invalid');
  assert.equal(parseBound('lots'), 'invalid');
});

test('a day is judged against a target only where the server judged it', () => {
  const targets = { protein_g: { min: 50 }, energy_kcal: { max: 2000 } };
  const v = targetVerdicts(targets, {
    protein_g: { amount: 30, complete: false, min: 'unknown', max: null },
    energy_kcal: { amount: 2100, complete: false, min: null, max: 'over' },
  });
  assert.deepEqual(v, [
    { key: 'energy_kcal', level: 'warn', text: 'energy at most 2,000 kcal: over' },
    { key: 'protein_g', level: 'unknown', text: 'protein at least 50 g: not known' },
  ]);
  assert.deepEqual(targetVerdicts(targets, null), []);
});

test('targets are one undo step, checked first, kept by Clear and saved with the plan', () => {
  const s = planWith(7);
  const bad = step(s, { type: 'setTargets', targets: { fat_g: { min: 9, max: 1 } } });
  assert.match(bad.refused ?? '', /above its maximum/);
  const set = step(s, { type: 'setTargets', targets: { protein_g: { min: 50 } } });
  assert.equal(set.refused, null);
  assert.deepEqual(set.state.draft.nutrition_targets, { protein_g: { min: 50, source: 'you' } });
  assert.equal(set.state.draft.rev, s.draft.rev + 1);
  const cleared = step(set.state, { type: 'clear', today: TODAY, id: 'p2' }).state;
  assert.deepEqual(cleared.draft.nutrition_targets, { protein_g: { min: 50, source: 'you' } });
  const back = parsePlan(serialize(set.state, '2026-10-08T21:00:00.000Z'));
  assert.deepEqual(back.state?.draft.nutrition_targets, { protein_g: { min: 50, source: 'you' } });
  const broken = JSON.parse(serialize(set.state, 'x'));
  broken.draft.nutrition_targets = { protein_g: { min: -5 } };
  assert.match(parsePlan(JSON.stringify(broken)).problem ?? '', /0 or more/);
});
