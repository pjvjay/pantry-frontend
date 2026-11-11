// The Ask page's transcript (src/transcript.ts): a turn's stream of hub events folded into one run
// of steps, the words for each step and for the run, and the questions offered after an answer.
// The main fixture is a real turn as the hub streamed it (fixtures/ask-run-penne.json): observers,
// three model calls, list_recipes and plan_recipe, the answer with its cart, the evals and the end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ASK_PREFILL_KEY, STARTERS, appendEvent, argsText, callProgress, canonicalTool, cardIn, clockText,
  durationText, foldRun, followUps, headline, metaLine, runningHeadline, swapInTurns, thoughtLabel,
  toolLabel, waitingOf,
} from '../src/transcript.ts';
import type { ModelStep, Note, Run, Step, ToolStep, Turn, TurnEvent } from '../src/transcript.ts';
import type { PlanCardData } from '../src/types.ts';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/ask-run-penne.json', import.meta.url), 'utf8')) as {
  question: string; events: TurnEvent[];
};
const EVENTS = FIXTURE.events;

const turn = (events: TurnEvent[], end?: Turn['end'], extra: Partial<Turn> = {}): Turn =>
  ({ id: 1, question: FIXTURE.question, sentAt: 1_000, events, ...(end ? { end, endedAt: 2_000 } : {}), ...extra });
const steps = (run: Run) => run.rows.filter((r): r is Step => r.kind !== 'note');
const upTo = (type: TurnEvent['type'], nth = 1) => {
  let seen = 0;
  const at = EVENTS.findIndex((e) => e.type === type && ++seen === nth);
  assert.ok(at >= 0, `the fixture has a ${nth}. ${type}`);
  return EVENTS.slice(0, at + 1);
};

test('the recorded turn folds into six steps, in order, each with its time', () => {
  const run = foldRun(turn(EVENTS, 'done'));
  assert.equal(run.status, 'answered');
  assert.deepEqual(steps(run).map((s) => [s.kind, s.status, s.name, s.ms == null ? null : durationText(s.ms)]), [
    ['observe', 'done', 'Checked which tools fit', '6.6 s'],
    ['model', 'done', 'Chose a tool', '8.5 s'],
    ['tool', 'done', 'Looked through the recipes', '13 ms'],
    ['model', 'done', 'Chose a tool', '1.4 s'],
    ['tool', 'done', 'Planned the shopping', '191 ms'],
    ['model', 'done', 'Wrote the answer', '2.3 s'],
  ]);
  assert.equal(run.stepCount, 6);
  assert.equal(run.headline, 'Planned in 6 steps · 19 s');
  assert.deepEqual(run.tools, ['list_recipes', 'plan_recipe']);
  assert.equal(run.traceId, 'tr-53c01836faf0');
  assert.equal(run.conversationId, '4f9c7ab260f2');
  assert.equal(run.error, null);
  assert.equal(run.answers.length, 1);
  assert.equal(run.answers[0].plans?.[0].kind, 'plan');
  assert.equal(run.evals?.passed, 8);
  assert.deepEqual(run.failedChecks, []);
  assert.equal(run.thinking, false);
  assert.deepEqual(run.reasoning, []);
});

test('each step says what it did in one line', () => {
  const s = steps(foldRun(turn(EVENTS, 'done')));
  assert.equal(s[0].summary,
    'Turned on 4 tools: get recipe, plan recipe, get product origins, rank products by origin');
  assert.equal(s[1].summary, 'list recipes · gemini-3-flash-preview · read 2,770 tokens, wrote 10');
  assert.equal(s[2].summary, '7 recipes, first Peanut Butter & Jelly Sandwich');
  assert.equal(s[4].summary,
    'tomato penne · not from United States · within 5 km → Tomato Penne: 5 items, $22.71 at Pantry Mart Downtown');
  assert.equal(s[5].summary, 'gemini-3-flash-preview · read 4,129 tokens, wrote 58');
  assert.equal((s[4] as ToolStep).tool, 'plan_recipe');
});

test('while the turn streams, the run says what it is doing now, and nothing ends before its event', () => {
  const live = (n: number) => foldRun(turn(EVENTS.slice(0, n))).live;
  assert.equal(live(0), 'Starting');
  assert.equal(live(1), 'Working');                                   // start
  assert.equal(live(2), 'Checking which tools fit');                  // observing
  assert.equal(live(4), 'Checking which tools fit');                  // two observations
  assert.equal(live(5), 'Thinking');                                  // thinking ends the observers
  assert.equal(live(6), 'Thinking');                                  // its progress
  assert.equal(live(7), 'Working');                                   // llm_call: nothing runs
  assert.equal(live(8), 'Looking through the recipes');               // tool_call
  assert.equal(live(13), 'Planning the shopping');
  const mid = foldRun(turn(upTo('observation', 2)));
  assert.equal(mid.status, 'running');
  assert.equal(mid.headline, '');
  assert.equal(steps(mid)[0].status, 'running');
  assert.equal(steps(mid)[0].summary, 'Turned on 4 tools: get recipe, plan recipe, get product origins, rank products by origin');
  const thinking = foldRun(turn(upTo('thinking')));
  assert.deepEqual(steps(thinking).map((s) => [s.status, s.name]),
    [['done', 'Checked which tools fit'], ['running', 'Thinking']]);
  assert.equal(steps(thinking)[1].summary, 'Waiting for gemini-3-flash-preview');
  assert.equal(steps(foldRun(turn(upTo('progress'))))[1].summary,
    'Waiting for gemini-3-flash-preview (usually about 1.1 s)');
  assert.equal(runningHeadline('Planning the shopping', 17_400), 'Planning the shopping · 17 s');
});

test('Stop: what was running stopped there, and the run says how far it got', () => {
  const run = foldRun(turn(upTo('tool_call', 2), 'stopped', { sentAt: 50_000, endedAt: 67_400 }));
  assert.equal(run.status, 'stopped');
  assert.equal(run.error, null);
  const last = steps(run).at(-1) as ToolStep;
  assert.equal(last.status, 'stopped');
  assert.equal(last.name, 'Planning the shopping');
  assert.equal(run.headline, 'Stopped after 5 steps · 17 s');
  assert.deepEqual(followUps(run, []), []);
  const early = foldRun(turn([], 'stopped'));
  assert.equal(early.headline, 'Stopped before the first step · 1.0 s');
});

test('an error from the hub partway through: an error row where it stopped, the step it cut short stopped', () => {
  const events: TurnEvent[] = [...upTo('thinking', 2),
    { type: 'error', message: 'Gemini answered 429: quota exhausted for today', ts: 16000 },
    { type: 'done', steps: 2, stop: 'error', seconds: 16.1, input_tokens: 2770, output_tokens: 10, ts: 16100 }];
  const run = foldRun(turn(events, 'done'));
  assert.equal(run.status, 'failed');
  assert.equal(run.error, 'Gemini answered 429: quota exhausted for today');
  assert.deepEqual(run.rows.map((r) => [r.kind, r.kind === 'note' ? '' : r.status]), [
    ['observe', 'done'], ['model', 'done'], ['tool', 'done'], ['model', 'stopped'], ['error', 'error'],
  ]);
  assert.equal((run.rows.at(-1) as Step).summary, 'Gemini answered 429: quota exhausted for today');
  assert.equal(run.stepCount, 4);
  assert.equal(run.headline, 'Stopped by an error after 4 steps · 16 s');
  assert.deepEqual(followUps(run, []), []);
});

test('a stream cut short, and a question the hub never took, end the run in the words this browser has', () => {
  const cut = foldRun(turn(upTo('tool_call', 2), 'failed',
    { failure: 'The hub closed the answer stream before the agent finished (was the hub restarted?).' }));
  assert.equal(cut.status, 'failed');
  assert.equal(cut.headline, 'Stopped by an error after 5 steps · 1.0 s');
  assert.equal(cut.rows.at(-1)?.kind, 'error');
  assert.equal((steps(cut).find((s) => s.kind === 'tool' && s.tool === 'plan_recipe'))?.status, 'stopped');
  const refused = foldRun({ id: 2, question: 'q', sentAt: 5_000, endedAt: 5_400, events: [], end: 'failed',
    failure: 'The demo hub is not running' });
  assert.equal(refused.status, 'failed');
  assert.equal(refused.stepCount, 0);
  assert.equal(refused.headline, 'Could not start · 400 ms');
  assert.equal(refused.error, 'The demo hub is not running');
});

// A thinking model (a local model with thinking on) sends its reasoning with each call's end.
const think: TurnEvent[] = [
  { type: 'start', conversation_id: 'c1', model: 'ollama:granite4.2:8b', target: 'pantry', tools: ['find_product'], ts: 1 },
  { type: 'thinking', step: 1, model: 'ollama:granite4.2:8b', ts: 2 },
  { type: 'llm_call', step: 1, model: 'ollama:granite4.2:8b', tool_calls: 1, wall_s: 3.2, reasoning: 'The shopper wants penne. Look it up first.', ts: 3200 },
  { type: 'tool_call', id: 'a', name: 'find_product', arguments: { query: 'penne' }, step: 1, ts: 3201 },
  { type: 'tool_result', id: 'a', name: 'find_product', is_error: false, structured: { total: 2, items: [{ name: 'Penne Rigate 500g' }] }, text: '', truncated: false, ms: 17, step: 1, ts: 3220 },
  { type: 'thinking', step: 2, model: 'ollama:granite4.2:8b', ts: 3221 },
  { type: 'llm_call', step: 2, model: 'ollama:granite4.2:8b', tool_calls: 0, wall_s: 1.0, reasoning: 'Two products; the first is cheapest.', ts: 4221 },
];

test('reasoning is open while it comes and closes when the answer starts, saying how long it took', () => {
  const coming = foldRun(turn(think));
  assert.equal(coming.thinking, true);
  assert.equal(thoughtLabel(coming), 'Reasoning');
  assert.deepEqual(coming.reasoning.map((r) => r.step), [1, 2]);
  const answered = foldRun(turn([...think, { type: 'assistant', text: 'Penne Rigate 500g, $1.97.', step: 2, ts: 4222 }]));
  assert.equal(answered.thinking, false);
  assert.equal(thoughtLabel(answered), 'Thought for 4.2 s');
  assert.equal(thoughtLabel({ thinking: false, thoughtMs: null }), 'Thoughts');
  assert.equal(steps(answered)[1].summary, '“penne” → 2 products, first Penne Rigate 500g');
});

test('words a model writes beside its tool calls are its step, not the answer; the step budget’s plan is the answer', () => {
  const said: TurnEvent[] = [
    { type: 'thinking', step: 1, model: 'gemini:x', ts: 1 },
    { type: 'llm_call', step: 1, model: 'gemini:x', tool_calls: 1, ts: 900 },
    { type: 'assistant', text: 'Let me look that up.', step: 1, ts: 901 },
    { type: 'tool_call', id: 't', name: 'find_product', arguments: { query: 'rice' }, step: 1, ts: 902 },
    { type: 'tool_result', id: 't', name: 'find_product', is_error: false, structured: [], text: '', truncated: false, ms: 9, step: 1, ts: 911 },
    { type: 'thinking', step: 2, model: 'gemini:x', ts: 912 },
    { type: 'llm_call', step: 2, model: 'gemini:x', tool_calls: 0, ts: 1500 },
    { type: 'assistant', text: 'Jasmine rice is cheapest at No Frills.', step: 2, ts: 1501 },
    { type: 'done', steps: 2, stop: 'answered', seconds: 1.5, input_tokens: 10, output_tokens: 5, ts: 1502 },
  ];
  const run = foldRun(turn(said, 'done'));
  assert.deepEqual(run.answers.map((a) => a.text), ['Jasmine rice is cheapest at No Frills.']);
  assert.equal((steps(run)[0] as ModelStep).said, 'Let me look that up.');
  assert.equal(run.headline, 'Answered in 3 steps · 1.5 s');

  const budget: TurnEvent[] = [
    { type: 'thinking', step: 1, model: 'gemini:x', ts: 1 },
    { type: 'llm_call', step: 1, model: 'gemini:x', tool_calls: 1, ts: 2 },
    { type: 'tool_call', id: 'p', name: 'plan_recipe', arguments: { slug: 'tomato_penne' }, step: 1, ts: 3 },
    { type: 'tool_result', id: 'p', name: 'plan_recipe', is_error: false, structured: { summary: { recipe_name: 'Tomato Penne', lines: [], total_cost: 9 } }, text: '', truncated: false, ms: 5, step: 1, ts: 8 },
    { type: 'assistant', text: 'The model did not finish its summary; here is the plan it made.', step: 1, ts: 9 },
    { type: 'done', steps: 12, stop: 'step budget reached', seconds: 30, input_tokens: 1, output_tokens: 1, ts: 10 },
  ];
  const planned = foldRun(turn(budget, 'done'));
  assert.equal(planned.answers.length, 1);
  assert.equal(planned.status, 'answered');
  assert.equal(planned.headline, 'Planned in 2 steps · 30 s');
});

test('observers with no reading step, discover_tools, the hub’s own call, notices and cart changes', () => {
  const events: TurnEvent[] = [
    { type: 'start', conversation_id: 'c', model: 'gemini:x', target: 'pantry', tools: ['find_product'], available: 17, disclosure: 'progressive', ts: 1 },
    { type: 'cart_change', ref: 0, line_no: 4, lines: [4], recipe_name: 'Tomato Penne', ingredient: 'Olive Oil',
      from: { id: 62, name: 'Olive Oil 1L' }, to: { id: 63, name: 'Olive Oil 500ml' }, total_before: 22.71,
      total_after: 16.2, stores_after: ['Pantry Mart Downtown'], undone: false, note: '', structured: { summary: {}, full: null }, ts: 2 },
    { type: 'observation', observer: 'meal_planner', condition: 'counted', kind: 'code', when: 'counted dishes', value: true,
      evidence: '3 Pepperoni Pizza', added: ['plan_meals'], removed: [], ts: 3 },
    { type: 'notice', text: 'tools announced in the conversation: plan_meals', ts: 4 },
    { type: 'thinking', step: 1, model: 'gemini:x', ts: 5 },
    { type: 'llm_call', step: 1, model: 'gemini:x', tool_calls: 1, ts: 6 },
    { type: 'tool_call', id: 'd', name: 'discover_tools', arguments: { query: 'origin' }, step: 1, ts: 7 },
    { type: 'tool_result', id: 'd', name: 'discover_tools', is_error: false, structured: null, text: 'ok', truncated: false, ms: 1, step: 1, ts: 8 },
    { type: 'tools_offered', added: ['get_product_origins'], removed: [], reason: 'discover_tools:origin', ts: 9 },
    { type: 'thinking', step: 2, model: 'gemini:x', ts: 10 },
    { type: 'llm_call', step: 2, model: 'gemini:x', tool_calls: 0, ts: 11 },
    { type: 'tool_call', id: 'hub_1', name: 'plan_meals', arguments: { dishes: ['3 Pepperoni Pizza'] }, step: 2, by_hub: true, ts: 12 },
    { type: 'tool_result', id: 'hub_1', name: 'plan_meals', is_error: false,
      structured: { summary: { kind: 'mealplan', days: 14, meals: [{}, {}, {}], total_cost: 41.5 } }, text: '', truncated: false, ms: 80, step: 2, ts: 92 },
    { type: 'assistant', text: 'Here is a draft.', step: 2, ts: 93 },
  ];
  const run = foldRun(turn(events, 'done'));
  const notes = run.rows.filter((r): r is Note => r.kind === 'note');
  assert.deepEqual(notes.map((n) => n.cart), [true, false]);
  assert.match(notes[0].text, /^Told the assistant: line 4 \(Olive Oil\)/);
  const s = steps(run);
  assert.deepEqual(s.map((x) => x.name), ['Checked which tools fit', 'Chose a tool', 'Asked for more tools',
    'Wrote the answer', 'Drafted a meal plan']);
  assert.equal(s[0].summary, 'Turned on 1 tool: plan meals');
  assert.equal(s[2].summary, '“origin” → turned on get product origins');
  assert.equal(s[4].summary, 'called by the hub · 3 Pepperoni Pizza → 3 meals over 14 days, $41.50');
  assert.deepEqual((s[3] as ModelStep).chose, []);
  // no end from the hub in this turn: this browser's clock, from the question to the stream's end
  assert.equal(run.headline, 'Planned in 5 steps · 1.0 s');
  assert.equal(metaLine(run.meta!), 'x · pantry · 1 of 17 tools offered at first');
});

test('after an answer: two or three questions from what it holds, never one already asked', () => {
  const run = foldRun(turn(EVENTS, 'done'));
  assert.deepEqual(followUps(run, [FIXTURE.question]), [
    'Find a cheaper option for Olive Oil 1L',
    'Plan 3 dinners for under $60 with no dairy.',
    'What is the cheapest penne, and where can I buy it?',
  ]);
  // asked in other words, case and punctuation aside, is still asked
  assert.deepEqual(followUps(run, [FIXTURE.question, 'plan 3 dinners for under $60 with no dairy'])[1],
    'What is the cheapest penne, and where can I buy it?');
  assert.equal(followUps(run, []).length, 3);
  const draft: Pick<Run, 'status' | 'answers' | 'tools'> = {
    status: 'answered', tools: ['plan_meals'],
    answers: [{ type: 'assistant', text: 'A draft', step: 1, plans: [{ kind: 'mealplan', summary: {} }] }],
  };
  assert.deepEqual(followUps(draft, []), ['Make the plan cheaper', 'Swap one dinner for something vegetarian',
    'What will the first shopping trip cost?']);
  const plain: Pick<Run, 'status' | 'answers' | 'tools'> = {
    status: 'answered', tools: [], answers: [{ type: 'assistant', text: 'Hello', step: 1 }],
  };
  const offered = followUps(plain, STARTERS.map((s) => s.prompt).slice(0, 3));
  assert.ok(offered.length >= 2 && offered.length <= 3, offered.join(' | '));
  assert.ok(offered.every((q) => !STARTERS.slice(0, 3).some((s) => s.prompt === q)));
});

test('times read the same everywhere', () => {
  assert.deepEqual([0.4, 12.6, 191, 999, 1000, 8542, 9960, 19374, 59_600, 125_000].map(durationText),
    ['<1 ms', '13 ms', '191 ms', '999 ms', '1.0 s', '8.5 s', '10 s', '19 s', '1 min 0 s', '2 min 5 s']);
  assert.deepEqual([0, 999, 14_200, 65_000].map(clockText), ['0 s', '0 s', '14 s', '1 min 5 s']);
});

test('a tool is named the same through the gateway, and an unknown one by its own name', () => {
  assert.equal(canonicalTool('pantry-plan-recipe'), 'plan_recipe');
  assert.equal(toolLabel('pantry-plan-recipe', false), 'Planned the shopping');
  assert.equal(toolLabel('plan_recipe', true), 'Planning the shopping');
  assert.equal(toolLabel('fetch', true), 'Reading a web page');
  assert.equal(toolLabel('pantry-mystery-tool', false), 'Called mystery tool');
  assert.equal(argsText({ days: 3, max_total_budget: 60, exclude_tags: ['dairy'], lat: 49.3, lon: -123.1, basis: true }),
    '3 days · under $60.00 · no dairy');
});

test('writing reports: the first and the latest are kept, the ones between are not', () => {
  const w = (tokens: number): TurnEvent => ({ type: 'progress', step: 1, model: 'ollama:x', phase: 'writing', tokens });
  let events: TurnEvent[] = [{ type: 'thinking', step: 1, model: 'ollama:x' }];
  for (const t of [1, 5, 9, 14]) events = appendEvent(events, w(t));
  assert.deepEqual(events.map((e) => (e.type === 'progress' ? e.tokens : e.type)), ['thinking', 1, 14]);
});

test('a model call’s progress: the cloud call waits out its usual time without claiming 100%', () => {
  const run = foldRun(turn(upTo('progress').map((e) => ({ ...e, rx: 10_000 }))));
  const m = steps(run)[1] as ModelStep;
  const w = waitingOf(m, 10_000);
  assert.equal(w.estimateS, 1.1);
  const p = callProgress(w, 12_000);
  assert.equal(p.over, true);
  assert.ok(p.left > 0);
  assert.match(p.detail, /usually ~1s/);
});

test('a swap replaces the card it was chosen from, in its own turn only', () => {
  const t1 = turn(EVENTS, 'done');
  const t2: Turn = { ...turn(think, 'done'), id: 2 };
  const before = cardIn([t1, t2], 1);
  assert.equal(before?.summary.recipe_name, 'Tomato Penne');
  const card: PlanCardData = { ...before!, ref: 5, summary: { ...before!.summary, total_cost: 18 } };
  const after = swapInTurns([t1, t2], 1, card, 'You changed the cart.');
  assert.equal(after[1], t2);
  assert.equal(after[0].notice, 'You changed the cart.');
  assert.equal(cardIn(after, 5)?.summary.total_cost, 18);
  assert.equal(cardIn(after, 1), null);
  assert.equal(foldRun(after[0]).answers[0].plans?.[0].ref, 5);
});

test('the recorded meal-plan turn: the dishes read in code, plan_meals, a draft, and its follow-ups', () => {
  const draft = JSON.parse(readFileSync(new URL('./fixtures/ask-run-mealplan.json', import.meta.url), 'utf8')) as {
    question: string; events: TurnEvent[];
  };
  const run = foldRun({ id: 3, question: draft.question, sentAt: 0, events: draft.events, end: 'done', endedAt: 6000 });
  assert.equal(run.status, 'answered');
  assert.deepEqual(steps(run).map((s) => s.name), ['Checked which tools fit', 'Read the dishes in your message',
    'Chose a tool', 'Drafted a meal plan', 'Wrote the answer']);
  const s = steps(run);
  assert.equal(s[0].summary, 'Turned on 1 tool: plan meals');
  assert.match(s[1].summary, /^3 Pepperoni Pizza, 2 Chicken Fried Rice, 3 Chicken Biryani/);
  assert.equal(s[3].summary,
    '3 pepperoni pizza, 2 chicken fried rice, 7 mango milkshake · 14 days · within 5 km → 12 meals over 14 days, $120.73');
  assert.equal(run.headline, 'Planned in 5 steps · 5.7 s');
  assert.equal(run.answers[0].plans?.[0].kind, 'mealplan');
  assert.deepEqual(followUps(run, [draft.question]), ['Make the plan cheaper',
    'Swap one dinner for something vegetarian', 'What will the first shopping trip cost?']);
});

test('the prefill key is the one Home writes', () => {
  assert.equal(ASK_PREFILL_KEY, 'pantry.ask.prefill');
  assert.equal(headline({ status: 'running', stepCount: 2, ms: 10, tools: [] }), '');
});
