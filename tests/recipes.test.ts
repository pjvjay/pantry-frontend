import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MEAL_PLAN_INBOX_KEY, NO_HUB_NOTE, RECIPES_KEY, addToMealPlan, amountText, basisBadge,
  chatMessageFor, confirmAll, dailyText, docFromParsed, durationText, estimateSeconds,
  evidenceHref, fitsDaily, hasTranscribed, importError, importSupport, parseInbox, pasteLines,
  pastedFromVideo, readInbox, readyProblem, removeLine, retitle, saveRecipe, savedKeyFor,
  secondsOf, setConfirmed, sourceText, takeInbox, unconfirmedLines, usageText, withServings,
} from '../src/recipes.ts';
import type { StorageLike } from '../src/recipes.ts';
import type { HubStatus, ParsedLines, RecipeDoc, RecipeLine } from '../src/types.ts';

// A page the hub read (JSON-LD), as /hub/recipes/import returns its doc.
function line(over: Partial<RecipeLine> = {}): RecipeLine {
  return { line_no: 1, text: '400g red lentils', name: 'red lentils', quantity: 400, unit: 'g',
           note: '', evidence: null, confirmed: true, amount_basis: 'stated_by_source', ...over };
}

function pageDoc(over: Partial<RecipeDoc> = {}): RecipeDoc {
  return {
    v: 1, key: 'imp:draft', title: 'Red Lentil Dal', servings: 4, servings_stated: true,
    servings_basis: 'source', yield_text: 'Serves 4',
    lines: [line(), line({ line_no: 2, text: '1 tbsp cumin seeds', name: 'cumin seeds',
                           quantity: 1, unit: 'tbsp' }),
            line({ line_no: 3, text: 'salt to taste', name: 'salt', quantity: null, unit: '',
                   note: 'to taste' })],
    source: { kind: 'web', method: 'jsonld', url: 'https://blog.example/dal', site: 'blog.example',
              extractor: 'extract_recipe.py 1.0.0' },
    warnings: ['line 3 (salt) states no amount'],
    ...over,
  };
}

// Gemini's transcription: every line unconfirmed, each with the time it was said.
function videoDoc(): RecipeDoc {
  const tl = (n: number, text: string, name: string, q: number | null, unit: string, at: string) =>
    line({ line_no: n, text, name, quantity: q, unit, confirmed: false,
           amount_basis: 'transcribed_confirmed_by_you', evidence: { quote: text, at } });
  return pageDoc({
    title: 'Butter Chicken', servings: null, servings_stated: false, servings_basis: null,
    yield_text: '',
    lines: [tl(1, '500 g chicken thighs', 'chicken thighs', 500, 'g', '01:05'),
            tl(2, '2 tbsp butter', 'butter', 2, 'tbsp', '12:34'),
            tl(3, 'a pinch of salt', 'salt', null, '', '13:02')],
    source: { kind: 'youtube', method: 'gemini_video', url: 'https://www.youtube.com/watch?v=abcdefghijk',
              site: 'youtube.com', channel: 'Cook Channel', model: 'gemini-2.5-flash',
              label: 'transcribed by Gemini: check every line' },
    warnings: [],
  });
}

class Memory implements StorageLike {
  data: Record<string, string> = {};
  getItem(k: string) { return k in this.data ? this.data[k] : null; }
  setItem(k: string, v: string) { this.data[k] = v; }
}

const refusing: StorageLike = {
  getItem() { throw new Error('SecurityError'); },
  setItem() { throw new Error('QuotaExceededError'); },
};

// ─── words ───────────────────────────────────────────────────

test('an amount is the number and unit, a count is the number, and no amount says so', () => {
  assert.equal(amountText({ quantity: 400, unit: 'g' }), '400 g');
  assert.equal(amountText({ quantity: 2, unit: 'each' }), '2');
  assert.equal(amountText({ quantity: 0.333333, unit: 'cup' }), '0.33 cup');
  assert.equal(amountText({ quantity: 1.5, unit: '' }), '1.5');
  assert.equal(amountText({ quantity: null, unit: 'g' }), 'amount not stated');
  // zero is an amount someone wrote, and is shown as one; only a missing amount is "not stated"
  assert.equal(amountText({ quantity: 0, unit: 'g' }), '0 g');
});

test('every amount says where it came from, and a transcribed line asks to be checked', () => {
  assert.deepEqual(basisBadge(line()), { text: 'stated by the source', tone: 'ok' });
  assert.deepEqual(basisBadge(line({ amount_basis: 'parsed_from_your_paste' })),
    { text: 'from your paste', tone: 'muted' });
  assert.deepEqual(basisBadge(line({ amount_basis: 'demo_house_amounts' })),
    { text: 'demo amounts', tone: 'warn' });
  assert.deepEqual(basisBadge(line({ amount_basis: 'transcribed_confirmed_by_you', confirmed: false })),
    { text: 'transcribed: check it', tone: 'warn' });
  assert.deepEqual(basisBadge(line({ amount_basis: 'transcribed_confirmed_by_you', confirmed: true })),
    { text: 'transcribed, checked by you', tone: 'ok' });
  assert.equal(basisBadge(line({ amount_basis: 'written_by_assistant' })).tone, 'warn');
});

test('a line with no amount says whose text gave none, never that an amount was stated', () => {
  assert.deepEqual(basisBadge(line({ quantity: null })), { text: 'the source gives none', tone: 'muted' });
  assert.deepEqual(basisBadge(line({ quantity: null, amount_basis: 'parsed_from_your_paste' })),
    { text: 'none in your paste', tone: 'muted' });
  assert.equal(basisBadge(line({ quantity: null, amount_basis: 'demo_house_amounts' })).text, 'no demo amount');
  assert.equal(basisBadge(line({ quantity: null, amount_basis: 'written_by_assistant' })).text, 'none written');
  // a transcribed line is still to be checked against the video, amount or not
  assert.equal(basisBadge(line({ quantity: null, amount_basis: 'transcribed_confirmed_by_you',
                                 confirmed: false })).text, 'transcribed: check it');
});

test('the source sentence names the site, the channel and the method as the doc states them', () => {
  assert.equal(sourceText(pageDoc().source),
    "From blog.example: the page's schema.org recipe (JSON-LD).");
  assert.equal(sourceText({ ...pageDoc().source, method: 'microdata' }),
    "From blog.example: the page's schema.org recipe (microdata).");
  assert.equal(sourceText({ kind: 'web', method: 'youtube_linked_page', site: 'cook.example',
                            channel: 'Cook Channel' }),
    'From cook.example, the recipe page Cook Channel links from the video.');
  assert.equal(sourceText({ kind: 'youtube', method: 'youtube_description', channel: 'Cook Channel' }),
    "From the description of Cook Channel's video.");
  assert.match(sourceText(videoDoc().source), /^Transcribed by Gemini \(gemini-2\.5-flash\) from Cook Channel's video: check every line/);
  assert.equal(sourceText({ kind: 'pasted', method: 'paste' }), 'From your paste.');
});

test('evidence links to the video at the second the line was said, and nowhere else', () => {
  const url = 'https://www.youtube.com/watch?v=abcdefghijk';
  assert.equal(secondsOf('12:34'), 754);
  assert.equal(secondsOf('125:00'), 7500);
  for (const bad of ['12:60', '1:2', '', null, 'x', '1:02:03']) assert.equal(secondsOf(bad), null, String(bad));
  assert.equal(evidenceHref(url, '12:34'), 'https://www.youtube.com/watch?v=abcdefghijk&t=754s');
  assert.equal(evidenceHref('https://youtu.be/abcdefghijk', '00:05'), 'https://youtu.be/abcdefghijk?t=5s');
  // an existing t= is replaced, not doubled
  assert.equal(evidenceHref(`${url}&t=10s`, '00:05'), `${url}&t=5s`);
  assert.equal(evidenceHref('https://blog.example/dal', '00:05'), null);
  assert.equal(evidenceHref('http://www.youtube.com/watch?v=abcdefghijk', '00:05'), null);
  assert.equal(evidenceHref('javascript:alert(1)', '00:05'), null);
  assert.equal(evidenceHref(url, null), null);
  assert.equal(evidenceHref(null, '00:05'), null);
});

test('a duration reads as m:ss or h:mm:ss', () => {
  assert.equal(durationText(754), '12:34');
  assert.equal(durationText(5), '0:05');
  assert.equal(durationText(3723), '1:02:03');
  assert.equal(durationText(21600), '6:00:00');
});

// ─── edits ───────────────────────────────────────────────────

test('a transcribed doc is not ready until every line is ticked, one by one or all at once', () => {
  const doc = videoDoc();
  assert.equal(hasTranscribed(doc), true);
  assert.equal(hasTranscribed(pageDoc()), false);
  assert.deepEqual(unconfirmedLines(doc), [1, 2, 3]);
  assert.match(readyProblem(doc) ?? '', /Tick the 3 lines you checked against the video/);
  const one = setConfirmed(doc, 2, true);
  assert.deepEqual(unconfirmedLines(one), [1, 3]);
  assert.deepEqual(unconfirmedLines(setConfirmed(one, 2, false)), [1, 2, 3]);
  assert.match(readyProblem(setConfirmed(setConfirmed(one, 1, true), 3, false)) ?? '',
    /Tick the line you checked/);
  const all = confirmAll(doc);
  assert.deepEqual(unconfirmedLines(all), []);
  assert.equal(readyProblem(all), null);
  // ticking changes nothing else on a line: what was reviewed is what gets planned
  assert.deepEqual(all.lines.map(({ confirmed: _c, ...rest }) => rest),
    doc.lines.map(({ confirmed: _c, ...rest }) => rest));
  assert.deepEqual(doc.lines.map((l) => l.confirmed), [false, false, false], 'the input is not changed');
});

test('removing a line renumbers the rest 1..n and keeps their evidence', () => {
  const doc = removeLine(videoDoc(), 1);
  assert.deepEqual(doc.lines.map((l) => [l.line_no, l.name, l.evidence?.at]),
    [[1, 'butter', '12:34'], [2, 'salt', '13:02']]);
  assert.match(readyProblem(removeLine(removeLine(removeLine(pageDoc(), 1), 1), 1)) ?? '',
    /no ingredient lines/);
});

test('servings the source does not state are the shopper\'s, labelled so; a stated count stays', () => {
  const doc = withServings(videoDoc(), 3);
  assert.equal(doc.servings, 3);
  assert.equal(doc.servings_basis, 'your_setting');
  assert.equal(doc.servings_stated, false);
  for (const bad of [0, 101, 2.5, null]) {
    const d = withServings(doc, bad);
    assert.equal(d.servings, null, String(bad));
    assert.equal(d.servings_basis, null);
  }
  assert.equal(withServings(pageDoc(), 9).servings, 4);
});

test('an answered servings count takes away the reader\'s "servings not stated", and a cleared one puts it back', () => {
  const unstated = { ...videoDoc(), warnings: ['servings not stated', 'line 3 (salt) states no amount'] };
  const answered = withServings(unstated, 2);
  assert.deepEqual(answered.warnings, ['line 3 (salt) states no amount']);
  assert.deepEqual(withServings(answered, null).warnings,
    ['servings not stated', 'line 3 (salt) states no amount']);
  assert.deepEqual(withServings(unstated, null).warnings, unstated.warnings);
});

test('a doc needs a name to be ready', () => {
  assert.match(readyProblem(retitle(pageDoc(), '  ')) ?? '', /name/);
  assert.match(readyProblem(retitle(pageDoc(), 'x'.repeat(201))) ?? '', /longer than 200/);
  assert.equal(chatMessageFor(retitle(pageDoc(), ' Dal ')), 'Plan the recipe I reviewed: Dal');
});

// ─── a paste ─────────────────────────────────────────────────

test('a paste is its non-blank lines, within the bounds parse-lines takes', () => {
  assert.deepEqual(pasteLines('  400 g lentils \r\n\n- 1 onion\n'), { lines: ['400 g lentils', '- 1 onion'], problem: null });
  assert.match(pasteLines(' \n ').problem ?? '', /one per line/);
  assert.match(pasteLines(Array.from({ length: 61 }, (_, i) => `${i} g x`).join('\n')).problem ?? '',
    /61 lines; a recipe takes at most 60/);
  assert.match(pasteLines(`1 onion\n${'a'.repeat(301)}`).problem ?? '', /Line 2 is longer than 300/);
});

test('parse-lines\' answer becomes a doc to review, every line as pantry read it', () => {
  const parsed: ParsedLines = {
    servings: null, servings_stated: false,
    lines: [{ line_no: 1, text: '400 g lentils', name: 'lentils', quantity: 400, unit: 'g', note: '',
              amount_basis: 'parsed_from_your_paste' },
            { line_no: 2, text: 'salt', name: 'salt', quantity: null, unit: '', note: '',
              amount_basis: 'parsed_from_your_paste' }],
    warnings: ['servings not stated', 'line 2 (salt) states no amount'],
  };
  const doc = docFromParsed(parsed, { title: ' Dal ', yield_text: '' });
  assert.equal(doc.title, 'Dal');
  assert.equal(doc.servings, null);
  assert.equal(doc.servings_basis, null);
  assert.deepEqual(doc.source, { kind: 'pasted', method: 'paste' });
  assert.deepEqual(doc.lines[1], { line_no: 2, text: 'salt', name: 'salt', quantity: null, unit: '',
    note: '', evidence: null, confirmed: true, amount_basis: 'parsed_from_your_paste' });
  assert.deepEqual(doc.warnings, parsed.warnings);
  assert.equal(docFromParsed({ ...parsed, servings: 4, servings_stated: true }, {}).servings_basis, 'source');
  assert.equal(docFromParsed(parsed, {}).title, 'Pasted recipe');
  const video = { url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Dal', channel: 'Cook' };
  assert.deepEqual(docFromParsed(parsed, { source: pastedFromVideo(video) }).source,
    { kind: 'pasted', method: 'paste', url: video.url, site: 'youtube.com', page_title: 'Dal', channel: 'Cook' });
});

// ─── the hub ─────────────────────────────────────────────────

const status = (over: Partial<HubStatus> = {}): HubStatus => ({
  services: [], keys: {}, agent: { default_model: 'x' },
  recipe_import: { links: true, youtube_description: false },
  video_import: { enabled: false, reason: 'Needs a Gemini API key; not available with local models only.' },
  ...over,
});

test('without a hub only a paste is offered, with the note the plan names', () => {
  const s = importSupport(null);
  assert.equal(s.links, false);
  assert.equal(s.hub, false);
  assert.equal(s.chatDocs, false);
  assert.equal(s.note, NO_HUB_NOTE);
  assert.equal(NO_HUB_NOTE, 'Reading links needs the local demo hub');
  assert.equal(s.video.enabled, false);
});

test('a hub says what it can read, and why not', () => {
  const ok = importSupport(status());
  assert.deepEqual([ok.hub, ok.chatDocs, ok.links, ok.youtubeDescription, ok.note],
                   [true, true, true, false, null]);
  assert.match(ok.video.reason, /Gemini API key/);
  assert.equal(importSupport(status({ recipe_import: { links: true, youtube_description: true } }))
    .youtubeDescription, true);
  const broken = importSupport(status({ recipe_import: { links: false, youtube_description: false,
                                                         reason: 'extractor not found' } }));
  assert.deepEqual([broken.links, broken.note], [false, 'The demo hub cannot read links right now: extractor not found']);
  // without its extractor the hub still takes a reviewed paste in chat
  assert.equal(broken.chatDocs, true);
  const old = importSupport(status({ recipe_import: undefined, video_import: undefined }));
  assert.equal(old.links, false);
  assert.match(old.note ?? '', /predates recipe import/);
  // a hub that predates recipe import would drop recipe_doc and send the model a bare title
  assert.equal(old.chatDocs, false);
  assert.equal(old.video.enabled, false);
});

test('a refusal says the hub\'s own message and keeps its code', () => {
  assert.deepEqual(importError({ code: 'no_recipe_found', message: 'No recipe on that page.' }, 'x'),
    { code: 'no_recipe_found', text: 'No recipe on that page.' });
  assert.deepEqual(importError({ code: 'too_large' }, 'The page is too large.'),
    { code: 'too_large', text: 'The page is too large.' });
  assert.deepEqual(importError('Not Found', 'x'), { code: '', text: 'Not Found' });
  assert.deepEqual(importError([{ loc: ['body'] }], 'Could not read it.'), { code: '', text: 'Could not read it.' });
  assert.deepEqual(importError(null, 'fallback'), { code: '', text: 'fallback' });
});

test('the daily video allowance is said in time, and an unknown length is not guessed', () => {
  const d = { date: '2026-10-08', seconds: 4200, calls: 2, limit_s: 21600 };
  assert.equal(dailyText(d), '1:10:00 of 6:00:00 used today (UTC)');
  assert.equal(fitsDaily(d, 17400), true);
  assert.equal(fitsDaily(d, 17401), false);
  assert.equal(fitsDaily(d, null), null);
  assert.equal(fitsDaily(undefined, 60), null);
  assert.equal(estimateSeconds('12'), 720);
  assert.equal(estimateSeconds(' 0.5 '), 30);
  for (const bad of ['', '0', '-3', 'abc', '721']) assert.equal(estimateSeconds(bad), null, bad);
});

test('a transcription\'s cost is the hub\'s figure, and with no rate set no cost is shown as $0', () => {
  const u = { model: 'gemini-3-flash-preview', total_tokens: 41250, llm_cost_usd: 0,
              pricing: 'preview pricing' };
  assert.equal(usageText(u), 'Gemini (gemini-3-flash-preview) read 41,250 tokens; no rate is set '
    + 'on this hub, so no cost is counted (preview pricing).');
  assert.doesNotMatch(usageText(u), /\$/);
  assert.equal(usageText({ ...u, llm_cost_usd: 0.012375 }), 'Gemini (gemini-3-flash-preview) read '
    + '41,250 tokens: $0.0124 at the rate set on this hub (preview pricing).');
});

// ─── saved in this browser ───────────────────────────────────

const ID = '6f1c2b9e-0d4a-4c1e-9a77-3e2f6b8d1c05';

test('saving writes {v: 1, recipes} under pantry.recipes.v1, keyed my:<id>, as reviewed', () => {
  const store = new Memory();
  const doc = pageDoc();
  const saved = saveRecipe(store, doc, ID);
  assert.deepEqual(saved, { ok: true, key: `my:${ID}`, replaced: false });
  assert.equal(RECIPES_KEY, 'pantry.recipes.v1');
  const value = JSON.parse(store.data[RECIPES_KEY]);
  assert.deepEqual(Object.keys(value).sort(), ['recipes', 'v']);
  assert.equal(value.v, 1);
  assert.deepEqual(value.recipes, [{ ...doc, key: `my:${ID}` }]);
  // the meal plan's reader takes my:<id> keys of word characters and dashes, at most 64
  assert.match(value.recipes[0].key, /^my:[\w-]{1,64}$/);
});

test('saving the same import again updates it rather than adding a copy', () => {
  const store = new Memory();
  saveRecipe(store, pageDoc(), ID);
  const again = saveRecipe(store, removeLine(pageDoc(), 3), 'other-id');
  assert.deepEqual(again, { ok: true, key: `my:${ID}`, replaced: true });
  const recipes = JSON.parse(store.data[RECIPES_KEY]).recipes;
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].lines.length, 2);
  // a saved doc re-saved by its own key, even renamed
  const mine = { ...recipes[0], title: 'Dal for Sunday' } as RecipeDoc;
  assert.deepEqual(saveRecipe(store, mine, 'x'), { ok: true, key: `my:${ID}`, replaced: true });
  // another title from the same page is another recipe
  assert.equal(savedKeyFor(JSON.parse(store.data[RECIPES_KEY]).recipes, retitle(pageDoc(), 'Other')), null);
  // a paste has no url, so two pastes are two recipes
  const paste = pageDoc({ source: { kind: 'pasted', method: 'paste' } });
  saveRecipe(store, paste, 'p1');
  saveRecipe(store, paste, 'p2');
  assert.equal(JSON.parse(store.data[RECIPES_KEY]).recipes.length, 3);
});

test('saving keeps every other entry as it was, even one this console cannot read', () => {
  const store = new Memory();
  const odd = { v: 1, key: 'my:odd', title: 'From a later console', lines: 'not a list' };
  store.data[RECIPES_KEY] = JSON.stringify({ v: 1, recipes: [odd] });
  assert.equal(saveRecipe(store, pageDoc(), ID).ok, true);
  assert.deepEqual(JSON.parse(store.data[RECIPES_KEY]).recipes[0], odd);
});

test('saving refuses rather than overwrite a value it cannot read, or an unready doc', () => {
  for (const raw of ['{', '[]', JSON.stringify({ v: 2, recipes: [] }), JSON.stringify({ v: 1 })]) {
    const store = new Memory();
    store.data[RECIPES_KEY] = raw;
    const r = saveRecipe(store, pageDoc(), ID);
    assert.equal(r.ok, false, raw);
    assert.match(!r.ok ? r.problem : '', /would overwrite them/);
    assert.equal(store.data[RECIPES_KEY], raw, 'left as it was');
  }
  const r = saveRecipe(new Memory(), videoDoc(), ID);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.problem : '', /Tick the 3 lines/);
  assert.equal(saveRecipe(new Memory(), pageDoc(), 'has a space').ok, false);
  assert.equal(saveRecipe(refusing, pageDoc(), ID).ok, false);
  assert.equal(saveRecipe(null, pageDoc(), ID).ok, false);
});

test('a saved doc is the reviewed one: title trimmed, lines byte for byte', () => {
  const store = new Memory();
  const doc = confirmAll(withServings(videoDoc(), 2));
  saveRecipe(store, retitle(doc, '  Butter Chicken  '), ID);
  const saved = JSON.parse(store.data[RECIPES_KEY]).recipes[0];
  assert.equal(saved.title, 'Butter Chicken');
  assert.deepEqual(saved.lines, doc.lines);
  assert.equal(saved.servings_basis, 'your_setting');
  assert.ok(saved.lines.every((l: RecipeLine) => l.confirmed));
});

test('"Add to meal plan" saves the recipe and names it once in the meal plan\'s inbox', () => {
  const store = new Memory();
  const now = '2026-10-08T21:00:00.000Z';
  assert.deepEqual(addToMealPlan(store, pageDoc(), ID, now), { ok: true, key: `my:${ID}`, already: false });
  assert.equal(MEAL_PLAN_INBOX_KEY, 'pantry.mealplan.inbox.v1');
  assert.deepEqual(JSON.parse(store.data[MEAL_PLAN_INBOX_KEY]),
    { v: 1, entries: [{ key: `my:${ID}`, title: 'Red Lentil Dal', added_at: now }] });
  assert.equal(JSON.parse(store.data[RECIPES_KEY]).recipes.length, 1);
  assert.deepEqual(addToMealPlan(store, pageDoc(), 'other', now), { ok: true, key: `my:${ID}`, already: true });
  assert.equal(readInbox(store).entries.length, 1);
  // an unready doc is neither saved nor added
  const fresh = new Memory();
  assert.equal(addToMealPlan(fresh, videoDoc(), ID, now).ok, false);
  assert.deepEqual(fresh.data, {});
});

test('the meal planner takes the waiting recipes and the inbox is left empty', () => {
  const store = new Memory();
  addToMealPlan(store, pageDoc(), 'a1', '2026-10-08T21:00:00.000Z');
  addToMealPlan(store, retitle(pageDoc(), 'Second'), 'b2', '2026-10-08T21:01:00.000Z');
  const taken = takeInbox(store);
  assert.deepEqual(taken.entries.map((e) => [e.key, e.title]), [['my:a1', 'Red Lentil Dal'], ['my:b2', 'Second']]);
  assert.equal(taken.problem, null);
  assert.deepEqual(readInbox(store), { entries: [], problem: null });
  assert.deepEqual(takeInbox(new Memory()), { entries: [], problem: null });
  assert.deepEqual(takeInbox(null), { entries: [], problem: null });
  assert.match(readInbox(refusing).problem ?? '', /not letting/);
});

test('an inbox entry that does not fit is skipped and counted', () => {
  const good = { key: 'my:a1', title: 'Dal', added_at: '2026-10-08T21:00:00.000Z' };
  const read = parseInbox(JSON.stringify({ v: 1, entries: [good, { key: 'lib:x', title: 'X', added_at: '' }, 3] }));
  assert.deepEqual(read.entries, [good]);
  assert.match(read.problem ?? '', /2 waiting recipe\(s\) could not be read/);
  assert.match(parseInbox('{').problem ?? '', /could not be read/);
  assert.match(parseInbox(JSON.stringify({ v: 2, entries: [] })).problem ?? '', /cannot read/);
  assert.deepEqual(parseInbox(null), { entries: [], problem: null });
});
