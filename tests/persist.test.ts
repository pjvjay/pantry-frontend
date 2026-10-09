// Saving the plan in this browser, its JSON export and import, and the shopper's own recipes
// (the pantry.recipes.v1 contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BACKUP_KEY, PLAN_KEY, SAVED_VERSION, exportFileName, parsePlan, readPlan, serialize, writePlan,
} from '../src/mealplan/persist.ts';
import type { StorageLike } from '../src/mealplan/persist.ts';
import {
  MEAL_PLAN_INBOX_KEY, RECIPES_KEY, forSelection, inboxEdit, myDocProblem, parseInbox,
  parseMyRecipes, readMyRecipes, takeInbox,
} from '../src/myRecipes.ts';
import type { InboxEntry } from '../src/myRecipes.ts';
import * as myRecipes from '../src/myRecipes.ts';
import { MAX_RECIPES, docRef, step } from '../src/mealplan/model.ts';
import type { RecipeDoc } from '../src/types.ts';
import { D, add, planWith, run } from './helpers/mealplan.ts';

const SAVED_AT = '2026-10-08T21:00:00.000Z';

function memory(init: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = v; },
  };
}

const refusing: StorageLike = {
  getItem: () => { throw new Error('SecurityError'); },
  setItem: () => { throw new Error('QuotaExceededError'); },
};

function samplePlan() {
  return run(planWith(14, add('pepperoni_pizza', 'Pepperoni Pizza', 2), add('mango_milkshake', 'Mango Milkshake', 1, 'snack')),
    { type: 'place', mealId: 'starter:pepperoni_pizza#1', date: D(3), slot: 'dinner' },
    { type: 'setPacks', date: D(2), productId: 61, packs: 2 },
    { type: 'setStorage', productId: 10, storage: 'freezer' },
    { type: 'pinProduct', recipeKey: 'starter:pepperoni_pizza', lineNo: 3, productId: 167 },
    { type: 'dismissTrip', date: D(5) });
}

test('a plan round-trips through the saved text under pantry.mealplan.v1', () => {
  const s = samplePlan();
  const store = memory();
  assert.equal(writePlan(store, s, SAVED_AT), true);
  assert.deepEqual(Object.keys(store.data), [PLAN_KEY]);
  assert.equal(PLAN_KEY, 'pantry.mealplan.v1');
  const saved = JSON.parse(store.data[PLAN_KEY]);
  assert.equal(saved.v, SAVED_VERSION);
  assert.equal(saved.saved_at, SAVED_AT);
  const back = readPlan(store);
  assert.deepEqual(back.state, s);
  assert.equal(back.savedAt, SAVED_AT);
  assert.equal(back.problem, null);
  assert.equal(back.available, true);
});

test('nothing saved yet is an empty start, not a problem', () => {
  assert.deepEqual(readPlan(memory()), { state: null, savedAt: null, problem: null, available: true,
    backedUp: false });
});

test('a browser that refuses storage is said to be unavailable, and nothing throws', () => {
  const r = readPlan(refusing);
  assert.equal(r.available, false);
  assert.equal(r.state, null);
  assert.equal(writePlan(refusing, samplePlan(), SAVED_AT), false);
  assert.equal(readPlan(null).available, false);
});

test('an unreadable saved plan is kept as a backup and explained', () => {
  for (const [raw, why] of [
    ['{not json', /not valid JSON/],
    ['[1,2]', /not a saved meal plan/],
    [JSON.stringify({ v: 2, draft: {} }), /newer console \(version 2\)/],
    [JSON.stringify({ v: 0, draft: {} }), /version 0 cannot be read/],
  ] as const) {
    const store = memory({ [PLAN_KEY]: raw });
    const r = readPlan(store);
    assert.equal(r.state, null, raw);
    assert.match(r.problem ?? '', why, raw);
    assert.equal(r.backedUp, true);
    assert.equal(store.data[BACKUP_KEY], raw, 'the value is kept, byte for byte');
  }
});

test('a damaged plan is refused with the reason, field by field', () => {
  const good = JSON.parse(serialize(samplePlan(), SAVED_AT));
  const broken: [string, (p: any) => void, RegExp][] = [
    ['days', (p) => { p.draft.days = 15; }, /1 to 14 days/],
    ['start', (p) => { p.draft.start_date = '2026-02-30'; }, /start date/],
    ['draft v', (p) => { p.draft.v = 2; }, /plan is version 2/],
    ['prefs', (p) => { p.draft.prefs.buy_ahead_days = -1; }, /buy ahead days/],
    ['prefs missing', (p) => { delete p.draft.prefs.strategy; }, /strategy/],
    ['ref', (p) => { p.draft.recipes['starter:pepperoni_pizza'].ref.starter = 'other'; }, /should be/],
    ['meal recipe', (p) => { p.draft.meals[0].recipe_key = 'lib:nope'; }, /has no recipe/],
    ['meal date', (p) => { p.draft.meals[0].date = 'Friday'; }, /has no date/],
    ['meal ids', (p) => { p.draft.meals[1].id = p.draft.meals[0].id; }, /meal is not readable/],
    ['slot', (p) => { p.draft.meals[0].slot = 'brunch'; }, /has no slot/],
    ['trip', (p) => { p.draft.trips = [{ date: '2026-10-10', fingerprint: 'x', strategy: 'fresh', snapshot: [] }]; },
      /approved trips/],
    ['packs', (p) => { p.draft.packs_override['2026-10-11:61'] = -2; }, /pack counts/],
    ['storage', (p) => { p.draft.storage_overrides['10'] = 'pantry'; }, /storage choices/],
    ['pins', (p) => { p.draft.pins['starter:pepperoni_pizza']['3'] = 'x'; }, /pins/],
    ['titles', (p) => { p.titles = []; }, /recipe names/],
  ];
  for (const [name, damage, why] of broken) {
    const p = structuredClone(good);
    damage(p);
    const r = parsePlan(JSON.stringify(p));
    assert.equal(r.state, null, name);
    assert.match(r.problem ?? '', why, name);
  }
});

test('export and import are the same text, and an import is one undoable edit', () => {
  const s = samplePlan();
  const text = serialize(s, SAVED_AT);
  const imported = parsePlan(text);
  assert.deepEqual(imported.state, s);
  const fresh = planWith(7);
  const out = step(fresh, { type: 'replace', state: imported.state! });
  assert.equal(out.state.draft.meals.length, 3);
  assert.equal(out.state.draft.rev, Math.max(fresh.draft.rev, s.draft.rev) + 1);
  assert.equal(exportFileName(s), 'meal-plan-2026-10-09.json');
});

test('spread meals that are no longer in the plan are forgotten on load', () => {
  const p = JSON.parse(serialize(samplePlan(), SAVED_AT));
  p.spread = ['starter:pepperoni_pizza#2', 'gone#1'];
  assert.deepEqual(parsePlan(JSON.stringify(p)).state?.spread, ['starter:pepperoni_pizza#2']);
});

// ─── pantry.recipes.v1 ───────────────────────────────────────

function myDoc(id: string, title: string, over: Partial<RecipeDoc> = {}): RecipeDoc {
  return {
    v: 1, key: `my:${id}`, title, servings: 4, servings_stated: true, servings_basis: 'source',
    yield_text: 'Serves 4',
    lines: [{ line_no: 1, text: '2 cups basmati rice', name: 'basmati rice', quantity: 2, unit: 'cup',
      note: '', evidence: null, confirmed: true, amount_basis: 'parsed_from_your_paste' }],
    source: { kind: 'pasted', method: 'paste' }, warnings: [], ...over,
  };
}

test('my recipes are read from pantry.recipes.v1 as reviewed docs, and sent as they are', () => {
  const docs = [myDoc('a1', 'Dal Tadka'), myDoc('b2', 'Lemon Rice', { servings: null,
    servings_stated: false, servings_basis: null })];
  // as recipe import's "Save to my recipes" writes it
  const store = memory({ [RECIPES_KEY]: JSON.stringify({ v: 1, recipes: docs }) });
  assert.equal(RECIPES_KEY, 'pantry.recipes.v1');
  const read = readMyRecipes(store);
  assert.deepEqual(read, { recipes: docs, problem: null });
  assert.deepEqual(docRef(read.recipes[0]), { key: 'my:a1', doc: docs[0] });
  assert.deepEqual(forSelection(read.recipes), [{ key: 'my:a1', title: 'Dal Tadka' },
    { key: 'my:b2', title: 'Lemon Rice' }]);
});

test('a saved recipe that does not fit is skipped and counted; the rest are used', () => {
  const ok = myDoc('a1', 'Dal Tadka');
  const raw = JSON.stringify({ v: 1, recipes: [ok, { ...ok }, myDoc('x', 'Bad', { key: 'lib:x' as never }),
    { ...myDoc('y', 'No amount basis'), lines: [{ ...ok.lines[0], amount_basis: 'guess' }] }, 'nope'] });
  const read = parseMyRecipes(raw);
  assert.deepEqual(read.recipes, [ok]);
  assert.equal(read.problem, '4 saved recipes could not be read and are not shown.');
  assert.match(myDocProblem({ ...ok, servings: 0 }) ?? '', /servings/);
  assert.equal(myDocProblem(ok), null);
});

test('my recipes that cannot be read at all read as none, and say why', () => {
  assert.deepEqual(parseMyRecipes(null), { recipes: [], problem: null });
  assert.match(parseMyRecipes('{').problem ?? '', /could not be read/);
  assert.match(parseMyRecipes('[]').problem ?? '', /not in a shape/);
  assert.match(parseMyRecipes(JSON.stringify({ v: 2, recipes: [] })).problem ?? '', /version 2/);
  assert.match(readMyRecipes(refusing).problem ?? '', /not letting/);
});

// Recipe import saves a web page's doc with its evidence quotes, and a video's lines once the
// shopper has ticked each one; both are read as they were saved.
test('the docs recipe import saves are read whole: a web page, and a checked video', () => {
  const page = myDoc('6f1c2b9e-0d4a-4c1e-9a77-3e2f6b8d1c05', 'Red Lentil Dal', {
    lines: [{ line_no: 1, text: '400g red lentils', name: 'red lentils', quantity: 400, unit: 'g',
      note: '', evidence: { quote: '400g red lentils' }, confirmed: true, amount_basis: 'stated_by_source' },
    { line_no: 2, text: 'salt to taste', name: 'salt', quantity: null, unit: '', note: 'to taste',
      evidence: null, confirmed: true, amount_basis: 'stated_by_source' }],
    source: { kind: 'web', method: 'jsonld', url: 'https://blog.example/dal', site: 'blog.example',
      extractor: 'extract_recipe.py 1.0.0' },
    warnings: ['line 2 (salt) states no amount'],
  });
  const video = myDoc('v1', 'Butter Chicken', {
    servings: 3, servings_stated: false, servings_basis: 'your_setting', yield_text: '',
    lines: [{ line_no: 1, text: '500 g chicken thighs', name: 'chicken thighs', quantity: 500,
      unit: 'g', note: '', evidence: { quote: '500 g chicken thighs', at: '01:05' }, confirmed: true,
      amount_basis: 'transcribed_confirmed_by_you' }],
    source: { kind: 'youtube', method: 'gemini_video', url: 'https://www.youtube.com/watch?v=abcdefghijk',
      site: 'youtube.com', channel: 'Cook Channel', model: 'gemini-2.5-flash',
      label: 'transcribed by Gemini: check every line' },
  });
  const read = parseMyRecipes(JSON.stringify({ v: 1, recipes: [page, video] }));
  assert.deepEqual(read, { recipes: [page, video], problem: null });
});

test('the meal plan only reads saved recipes; recipe import is the one writer', () => {
  const writers = Object.keys(myRecipes).filter((name) => /^(write|save|upsert|serialize)/i.test(name));
  assert.deepEqual(writers, []);
});

// ─── pantry.mealplan.inbox.v1 ────────────────────────────────

const sent = (id: string, title: string, at = '2026-10-08T20:00:00Z'): InboxEntry =>
  ({ key: `my:${id}`, title, added_at: at });

test('recipes sent with "Add to meal plan" are taken once, oldest first, and the inbox emptied', () => {
  assert.equal(MEAL_PLAN_INBOX_KEY, 'pantry.mealplan.inbox.v1');
  const entries = [sent('a1', 'Dal Tadka'), sent('b2', 'Lemon Rice', '2026-10-08T20:05:00Z')];
  const store = memory({ [MEAL_PLAN_INBOX_KEY]: JSON.stringify({ v: 1, entries }) });
  assert.deepEqual(takeInbox(store), { entries, problem: null });
  assert.deepEqual(JSON.parse(store.data[MEAL_PLAN_INBOX_KEY]), { v: 1, entries: [] });
  assert.deepEqual(takeInbox(store), { entries: [], problem: null });
  // nothing waiting: nothing is written
  const empty = memory();
  assert.deepEqual(takeInbox(empty), { entries: [], problem: null });
  assert.deepEqual(empty.data, {});
});

test('an inbox that cannot be read is said, its readable entries still used', () => {
  assert.match(parseInbox('{').problem ?? '', /could not be read/);
  assert.match(parseInbox(JSON.stringify({ v: 2, entries: [] })).problem ?? '', /cannot read/);
  const mixed = parseInbox(JSON.stringify({ v: 1, entries: [sent('a1', 'Dal'), { key: 'lib:x', title: 'X',
    added_at: 'now' }, 'nope'] }));
  assert.deepEqual(mixed.entries, [sent('a1', 'Dal')]);
  assert.equal(mixed.problem, '2 recipes sent to the meal plan could not be read.');
  assert.match(takeInbox(refusing).problem ?? '', /not letting/);
  // emptying refused: the entries are still used
  const stuck = { getItem: () => JSON.stringify({ v: 1, entries: [sent('a1', 'Dal')] }),
    setItem: () => { throw new Error('QuotaExceededError'); } };
  assert.deepEqual(takeInbox(stuck).entries, [sent('a1', 'Dal')]);
});

test('each sent recipe joins the tray with one meal, as its reviewed doc, in one step', () => {
  const dal = myDoc('a1', 'Dal Tadka');
  const rice = myDoc('b2', 'Lemon Rice');
  const s = planWith(7, { type: 'addRecipe', ref: docRef(rice), title: 'Lemon Rice', wanted: 2 });
  const { edit, problems } = inboxEdit([sent('a1', 'Dal Tadka'), sent('b2', 'Lemon Rice'),
    sent('a1', 'Dal Tadka'), sent('gone', 'Old Soup')], [dal, rice], s);
  assert.deepEqual(problems, ['Old Soup was sent to the meal plan but is no longer in your saved recipes.']);
  assert.deepEqual(edit, { type: 'batch', edits: [
    { type: 'addRecipe', ref: { key: 'my:a1', doc: dal }, title: 'Dal Tadka', wanted: 1, slot: 'dinner' }] });
  const out = step(s, edit!);
  assert.equal(out.refused, null);
  assert.equal(out.state.draft.recipes['my:a1'].wanted, 1);
  assert.equal(out.state.draft.recipes['my:b2'].wanted, 2, 'a recipe already there keeps its count');
  assert.deepEqual(out.state.draft.meals.filter((m) => m.recipe_key === 'my:a1')
    .map((m) => [m.id, m.date, m.pinned]), [['my:a1#1', null, true]]);
  assert.deepEqual(inboxEdit([], [dal], s), { edit: null, problems: [] });
});

test('a full plan says which sent recipe it could not take, and keeps it saved', () => {
  let s = planWith(14);
  for (let i = 0; i < MAX_RECIPES; i += 1) {
    s = step(s, { type: 'addRecipe', ref: docRef(myDoc(`r${i}`, `R${i}`)), title: `R${i}`, wanted: 1 }).state;
  }
  const { edit, problems } = inboxEdit([sent('new', 'Dal Tadka')], [myDoc('new', 'Dal Tadka')], s);
  assert.equal(edit, null);
  assert.deepEqual(problems, [`Dal Tadka was not added: a plan holds ${MAX_RECIPES} recipes and 56 meals. `
    + 'It is still in your saved recipes.']);
});
