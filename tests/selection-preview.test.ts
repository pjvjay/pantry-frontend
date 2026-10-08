// Quick add's preview. The fixture is pantry-api's real /mealplan/selection/parse answer for the
// plan's sentence (feat/meal-plan, demo starters): Pepperoni Pizza and Chicken Fried Rice exact,
// "chicken briyani" an alias of Chicken Biryani, "mango milkshakes" a plural.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  accepted, buildPreview, chipText, countLine, decide, meaningOf, previewEdit, waiting,
} from '../src/mealplan/selectionPreview.ts';
import { reduce } from '../src/mealplan/model.ts';
import type { Selection, SelectionParseResult } from '../src/types.ts';
import { add, planWith } from './helpers/mealplan.ts';

const SENTENCE: SelectionParseResult = JSON.parse(readFileSync(
  new URL('./fixtures/mealplan-parse.json', import.meta.url), 'utf8'));
const LOOK = { starters: [], myRecipes: [] };

const selection = (over: Partial<Selection>): Selection => ({
  input: 'x', name: 'x', count: 1, count_stated: false, slot_hint: null, status: 'unmatched',
  matched_as: null, needs_confirmation: true, candidates: [], meaning: null, ...over,
});

test('exact and plural matches are ready; the alias is a question, never accepted', () => {
  const p = buildPreview(SENTENCE, 2);
  assert.deepEqual(p.items.map((i) => i.state), ['ready', 'ready', 'confirm', 'ready']);
  assert.equal(p.items[2].question, 'chicken briyani → Chicken Biryani (demo starter)?');
  assert.equal(p.items[2].decision, null);
  assert.equal(waiting(p), 1);
  assert.deepEqual(accepted(p).map((a) => [a.recipe_key, a.count]), [
    ['starter:pepperoni_pizza', 3], ['starter:chicken_fried_rice', 2], ['starter:mango_milkshake', 7]]);
  assert.equal(p.periodDays, 14);
});

test('a fuzzy match is asked about even when the server says no confirmation is needed', () => {
  const fuzzy = selection({ input: '2 chiken biryani', name: 'chiken biryani', count: 2, status: 'matched',
    needs_confirmation: false, matched_as: { recipe_key: 'starter:chicken_biryani', title: 'Chicken Biryani',
      kind: 'starter', label: 'demo starter', slot: 'dinner', how: 'fuzzy', distance: 1 } });
  const alias = { ...fuzzy, matched_as: { ...fuzzy.matched_as!, how: 'alias' as const } };
  const exactButAsked = { ...fuzzy, needs_confirmation: true,
    matched_as: { ...fuzzy.matched_as!, how: 'exact' as const } };
  const p = buildPreview({ selections: [fuzzy, alias, exactButAsked], unmatched: [], period_days: null,
    warnings: [] }, 2);
  assert.deepEqual(p.items.map((i) => i.state), ['confirm', 'confirm', 'confirm']);
  assert.deepEqual(accepted(p), []);
  assert.equal(previewEdit(p, planWith(7), LOOK).edit, null, 'nothing joins the plan unasked');
});

test('Use accepts the match, Not this leaves it out', () => {
  let p = buildPreview(SENTENCE, 2);
  p = decide(p, 2, { use: 'starter:chicken_biryani' });
  assert.equal(waiting(p), 0);
  assert.deepEqual(accepted(p).find((a) => a.recipe_key === 'starter:chicken_biryani'),
    { recipe_key: 'starter:chicken_biryani', title: 'Chicken Biryani', kind: 'starter', count: 3,
      slot: 'dinner', meaning: '3 × Chicken Biryani = 3 dinners for 2 people' });
  p = decide(p, 0, 'reject');
  assert.equal(accepted(p).some((a) => a.recipe_key === 'starter:pepperoni_pizza'), false);
  assert.equal(chipText(p.items[0], 2), '3 Pepperoni Pizza: not added');
  // Use must name the match or a candidate.
  assert.equal(decide(p, 1, { use: 'lib:something_else' }), p);
});

test('several fits, or a name that is in some titles, is a choice the shopper makes', () => {
  const p = buildPreview({ selections: [
    selection({ input: '3 chicken curry', name: 'chicken curry', count: 3, status: 'unmatched',
      candidates: [{ recipe_key: 'lib:chicken_curry', title: 'Simple Chicken Curry', kind: 'library', label: 'library' }] }),
    selection({ input: 'pizza', name: 'pizza', status: 'ambiguous', candidates: [
      { recipe_key: 'starter:pepperoni_pizza', title: 'Pepperoni Pizza', kind: 'starter', label: 'demo starter' },
      { recipe_key: 'my:m1', title: 'Margherita Pizza', kind: 'my', label: 'my recipe' }] }),
    selection({ input: 'mango', name: 'mango' }),
  ], unmatched: ['chicken curry', 'mango'], period_days: null, warnings: [] }, 2);
  assert.deepEqual(p.items.map((i) => i.state), ['choose', 'choose', 'unmatched']);
  assert.equal(p.items[0].question, '"chicken curry" is not a recipe here; did you mean one of these?');
  assert.equal(p.items[1].question, 'Which recipe is "pizza"?');
  assert.deepEqual(accepted(p), []);
  const chosen = decide(p, 1, { use: 'my:m1' });
  assert.deepEqual(accepted(chosen).map((a) => [a.recipe_key, a.meaning]),
    [['my:m1', '1 × Margherita Pizza = 1 dinner for 2 people']]);
  assert.equal(decide(p, 2, { use: 'x' }), p, 'an unmatched name has nothing to choose');
  assert.equal(chipText(p.items[2], 2), '"mango" is not a recipe here yet');
});

test('counts say what they mean', () => {
  assert.equal(countLine(3, 2), '3 meals × 2 people');
  assert.equal(countLine(1, 1), '1 meal × 1 person');
  assert.equal(meaningOf(7, 'Mango Milkshake', 'snack', 2), '7 × Mango Milkshake = 7 snacks for 2 people');
  assert.equal(meaningOf(2, 'Porridge', 'breakfast', 4), '2 × Porridge = 2 breakfasts for 4 people');
  const p = buildPreview(SENTENCE, 2);
  assert.equal(chipText(p.items[3], 2), SENTENCE.selections[3].meaning, 'the same words as the server');
});

test('accepting adds the recipes with their counts and the period, as one step', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  const p = decide(buildPreview(SENTENCE, 2), 2, { use: 'starter:chicken_biryani' });
  const { edit, problems } = previewEdit(p, s, LOOK);
  assert.deepEqual(problems, []);
  assert.ok(edit && edit.type === 'batch');
  assert.deepEqual(edit.edits, [
    { type: 'setWanted', key: 'starter:pepperoni_pizza', wanted: 4 },
    { type: 'addRecipe', ref: { key: 'starter:chicken_fried_rice', starter: 'chicken_fried_rice' },
      title: 'Chicken Fried Rice', wanted: 2, slot: 'dinner' },
    { type: 'addRecipe', ref: { key: 'starter:chicken_biryani', starter: 'chicken_biryani' },
      title: 'Chicken Biryani', wanted: 3, slot: 'dinner' },
    { type: 'addRecipe', ref: { key: 'starter:mango_milkshake', starter: 'mango_milkshake' },
      title: 'Mango Milkshake', wanted: 7, slot: 'snack' },
    { type: 'setWindow', start_date: s.draft.start_date, days: 14 },
  ]);
  const next = reduce(s, edit);
  assert.equal(next.draft.meals.length, 4 + 2 + 3 + 7);
  assert.equal(next.draft.days, 14);
  assert.equal(next.draft.rev, s.draft.rev + 1, 'one edit, one undo step');
});

test('my recipes are sent as their reviewed docs; one that is gone is listed, not dropped', () => {
  const doc = { v: 1, key: 'my:m1', title: 'Margherita Pizza', servings: 2 } as never;
  const p = decide(buildPreview({ selections: [selection({ input: '2 margherita', name: 'margherita',
    count: 2, status: 'ambiguous', candidates: [{ recipe_key: 'my:m1', title: 'Margherita Pizza', kind: 'my',
      label: 'my recipe' }] })], unmatched: [], period_days: null, warnings: [] }, 2), 0, { use: 'my:m1' });
  const found = previewEdit(p, planWith(7), { starters: [], myRecipes: [doc] });
  assert.deepEqual(found.edit, { type: 'batch', edits: [{ type: 'addRecipe', ref: { key: 'my:m1', doc },
    title: 'Margherita Pizza', wanted: 2, slot: 'dinner' }] });
  const gone = previewEdit(p, planWith(7), LOOK);
  assert.equal(gone.edit, null);
  assert.deepEqual(gone.problems, ['Margherita Pizza is no longer available']);
});
