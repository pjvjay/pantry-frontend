// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The Ask page's transcript. Each question the shopper sends is a turn; the demo hub answers it
// with a stream of events (agentChat in hub.ts): observers deciding which tools fit, model calls,
// tool calls and their results, notices, the answer, its checks and the end. Shown one per row,
// those events buried the answer under ten to twenty grey lines. Here a turn's events fold into
// one run: the steps it took (StepRows, in the order they happened), what the run is doing now,
// how long it took, the reasoning a thinking model wrote, the answer, and what stopped it when
// something did. The page draws the run as one line between the question and the answer that
// opens into its steps (components/assistant/RunTimeline.tsx).
//
// Also here, because they are words and choices rather than drawing: each step's name and
// one-line summary, the run's own line ("Planned in 6 steps · 19 s"), the follow-up questions
// offered under an answer, and the starter questions offered before the first one.
//
// Times: `ts` on an event is the hub's milliseconds since the turn began, so durations between
// events hold for a replayed recording too; `rx` is when this browser received the event, which
// a live clock (a model call in progress) counts from.

import { cartChangeText, money, replaceCard } from './alternatives.ts';
import type {
  AgentEvent, CartLine, CartSummary, PlanCardData, RecipeDoc, RecipeImportEvent,
} from './types.ts';

export type Ev<T extends AgentEvent['type']> = Extract<AgentEvent, { type: T }>;

// An event as this browser keeps it: `rx`, when it arrived (Date.now()).
export type TurnEvent = AgentEvent & { rx?: number };

// Home's Ask box hands its text over in sessionStorage under this key; the Ask page puts it in the
// message box (never sends it) and removes it.
export const ASK_PREFILL_KEY = 'pantry.ask.prefill';

// One question and the hub's answer to it, as it arrived.
export interface Turn {
  id: number;
  question: string;
  // this browser's clock: when the question went, and when its stream ended
  sentAt: number;
  endedAt?: number;
  events: TurnEvent[];
  // how the stream ended here: undefined while it is open; 'done' when it closed after the hub's
  // own end; 'stopped' by the shopper; 'failed' when the request was refused or the stream cut
  end?: 'done' | 'stopped' | 'failed';
  // what went wrong, in words for the shopper, when this browser saw the failure itself
  failure?: string;
  // the shopper changed one of this turn's carts: said under it until the next question
  notice?: string;
  // the recipe the shopper reviewed and sent with the question, which Try again sends again
  recipeDoc?: RecipeDoc;
}

// ─── Adding an event ─────────────────────────────────────────

// A local model reports its writing many times a second. The first report says when writing
// began and the latest how far it got; the ones between add nothing, so they are not kept (a
// long reply would otherwise keep hundreds).
export function appendEvent(events: readonly TurnEvent[], e: TurnEvent): TurnEvent[] {
  if (e.type === 'progress' && e.phase === 'writing') {
    const { step } = e;
    const last = events[events.length - 1];
    const before = events[events.length - 2];
    const writing = (x: TurnEvent | undefined) =>
      x?.type === 'progress' && x.phase === 'writing' && x.step === step;
    if (writing(last) && writing(before)) return [...events.slice(0, -1), e];
  }
  return [...events, e];
}

// ─── Steps ───────────────────────────────────────────────────

export type StepStatus = 'running' | 'done' | 'error' | 'stopped';

interface StepBase {
  id: string;
  status: StepStatus;
  // what the step is or did ("Planning the shopping", "Planned the shopping"), and one line on
  // it; `tool` is a tool step's own name as the tools know it (plan_recipe)
  name: string;
  summary: string;
  // how long it took, when that is known
  ms: number | null;
}

export interface ObserveStep extends StepBase {
  kind: 'observe';
  // the observers asked (the 'observing' event), what they reported, and the goals they set
  observers: string[];
  model: string | null;
  observations: Ev<'observation'>[];
  goals: Ev<'goal_enabled'>[];
  startTs: number | null;
}

export interface ModelStep extends StepBase {
  kind: 'model';
  step: number;
  model: string;
  call: Ev<'llm_call'> | null;
  // the waiting and writing reports while the call runs (appendEvent keeps them few)
  progress: (Ev<'progress'> & { rx?: number })[];
  // when the call began: the hub's ts and this browser's rx
  startTs: number | null;
  startRx: number | null;
  // tools it chose (filled in as their calls arrive), and words it wrote beside them
  chose: string[];
  said: string;
}

export interface ToolStep extends StepBase {
  kind: 'tool';
  tool: string;
  call: Ev<'tool_call'>;
  result: Ev<'tool_result'> | null;
  // discover_tools' answer: the tools it added
  offered: Ev<'tools_offered'> | null;
}

export interface ImportStep extends StepBase { kind: 'import'; event: RecipeImportEvent }
export interface MealsStep extends StepBase { kind: 'meals'; event: Ev<'meal_selection'> }
export interface ErrorStep extends StepBase { kind: 'error'; message: string }

export type Step = ObserveStep | ModelStep | ToolStep | ImportStep | MealsStep | ErrorStep;

// Something the hub or the shopper said along the way that is not a step of the work: a notice
// (a model switched, a repeated call skipped), a cart change told to the model.
export interface Note { kind: 'note'; id: string; text: string; cart: boolean }

export type Row = Step | Note;

// ─── The run ─────────────────────────────────────────────────

export type RunStatus = 'running' | 'answered' | 'stopped' | 'failed';

export interface RunMeta {
  model: string;
  target: string;
  offered: number;
  available: number | null;
  disclosure: string | null;
  // the conversation's tokens so far, from the hub's end of the turn
  tokensIn: number | null;
  tokensOut: number | null;
  stop: string | null;
}

export interface Run {
  status: RunStatus;
  rows: Row[];
  // the steps of the work (not notes, not the error that ended it): "in 6 steps"
  stepCount: number;
  // what the run is doing now, while it runs ("Thinking", "Planning the shopping")
  live: string;
  // how long the turn took, as the hub measured it (or as far as the events go)
  ms: number | null;
  // the run's own line once it has ended; '' while it runs (the page adds a live clock)
  headline: string;
  answers: Ev<'assistant'>[];
  imports: RecipeImportEvent[];
  // a thinking model's reasoning, by step; how long those steps took; and whether the thought is
  // still coming (reasoning has arrived and the answer has not started)
  reasoning: { step: number; text: string }[];
  thoughtMs: number | null;
  thinking: boolean;
  // what stopped the run, in words: the hub's error or this browser's failure
  error: string | null;
  evals: Ev<'evals'> | null;
  failedChecks: string[];
  traceId: string | null;
  conversationId: string | null;
  meta: RunMeta | null;
  // the tools the run called, by their own names (plan_recipe), in order
  tools: string[];
}

// A tool's own name, whichever server it came through: the gateway's "pantry-plan-recipe" is
// pantry's plan_recipe.
export const canonicalTool = (name: string) => name.replace(/^pantry-/, '').replace(/-/g, '_');

// "plan_recipe" as words: "plan recipe".
export const toolWords = (name: string) => canonicalTool(name).replace(/_/g, ' ');

// Each tool's step, while it runs and once it has run.
const TOOL_LABELS: Record<string, [running: string, done: string]> = {
  list_recipes: ['Looking through the recipes', 'Looked through the recipes'],
  get_recipe: ['Reading a recipe', 'Read a recipe'],
  list_products: ['Browsing the catalog', 'Browsed the catalog'],
  find_product: ['Looking up products', 'Looked up products'],
  get_product: ['Reading about a product', 'Read about a product'],
  plan_recipe: ['Planning the shopping', 'Planned the shopping'],
  plan_from_text: ['Planning from your list', 'Planned from your list'],
  plan_from_lines: ['Planning the recipe’s lines', 'Planned the recipe’s lines'],
  plan_week: ['Planning the week’s dinners', 'Planned the week’s dinners'],
  plan_meals: ['Drafting a meal plan', 'Drafted a meal plan'],
  rank_alternatives: ['Ranking other products', 'Ranked other products'],
  reprice_plan: ['Pricing the plan again', 'Priced the plan again'],
  get_product_origins: ['Checking where products come from', 'Checked where products come from'],
  rank_products_by_origin: ['Ranking products by origin', 'Ranked products by origin'],
  origin_triage: ['Finding labels worth reading', 'Found labels worth reading'],
  submit_origin_evidence: ['Sending an origin reading', 'Sent an origin reading'],
  list_origin_submissions: ['Reading the origin review queue', 'Read the origin review queue'],
  review_origin_submission: ['Reviewing an origin reading', 'Reviewed an origin reading'],
  pipeline_status: ['Checking the planner’s settings', 'Checked the planner’s settings'],
  discover_tools: ['Asking for more tools', 'Asked for more tools'],
};

// The tools that make a plan: a run that called one "Planned" its answer.
const PLANNING = new Set(['plan_recipe', 'plan_from_text', 'plan_from_lines', 'plan_week',
  'plan_meals', 'reprice_plan']);

export function toolLabel(name: string, running: boolean): string {
  const tool = canonicalTool(name);
  const known = TOOL_LABELS[tool];
  if (known) return known[running ? 0 : 1];
  if (/fetch/.test(tool)) return running ? 'Reading a web page' : 'Read a web page';
  return `${running ? 'Calling' : 'Called'} ${toolWords(name)}`;
}

// ─── Times ───────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// "13 ms", "8.5 s", "19 s", "2 min 5 s": a step or a run. A check done in code takes well under a
// millisecond, which "<1 ms" says without looking like nothing happened.
export function durationText(ms: number): string {
  if (ms < 0.5) return '<1 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const tenths = Math.round(ms / 100) / 10;
  if (tenths < 10) return `${tenths.toFixed(1)} s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

// A clock counting up while the run works: "0 s", "14 s", "1 min 5 s".
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

// The run's line while it works: what it is doing, and for how long.
export const runningHeadline = (live: string, ms: number) => `${live} · ${clockText(ms)}`;

// "Thought for 4.2 s" once the answer has begun; "Reasoning" while it still comes (the run's own
// line says "Thinking" then, so the two do not say the same word one above the other).
export function thoughtLabel(run: Pick<Run, 'thinking' | 'thoughtMs'>): string {
  if (run.thinking) return 'Reasoning';
  return run.thoughtMs != null && run.thoughtMs > 0 ? `Thought for ${durationText(run.thoughtMs)}` : 'Thoughts';
}

// ─── Summaries: a step in one line ───────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const firstLine = (text: string, max = 140) => {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
// A recipe key ("starter:pepperoni_pizza") as words: "pepperoni pizza".
const keyWords = (v: unknown) => String(v).replace(/^\w+:/, '').replace(/_/g, ' ');
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (isObj(x)
  ? `${x.count ?? ''} ${x.name ?? x.title ?? x.dish ?? (x.recipe != null ? keyWords(x.recipe) : '')}`.trim()
  : String(x))) : [String(v)]);
const quoted = (v: unknown) => `“${firstLine(String(v), 48)}”`;

// What a tool was asked, as words: "tomato penne · not from United States · within 5 km". The
// location the hub fills in for every call and the plan's basis say nothing to the shopper.
export function argsText(args: Record<string, unknown>): string {
  const out: string[] = [];
  const say: Record<string, (v: unknown) => string> = {
    query: quoted,
    search: quoted,
    slug: (v) => String(v).replace(/_/g, ' '),
    title: (v) => String(v),
    recipe_text: quoted,
    dishes: (v) => listOf(v).slice(0, 3).join(', ') + (Array.isArray(v) && v.length > 3 ? ', …' : ''),
    days: (v) => plural(Number(v), 'day'),
    max_total_budget: (v) => `under ${money(Number(v))}`,
    exclude_tags: (v) => `no ${listOf(v).join(', ')}`,
    exclude_origin: (v) => `not from ${listOf(v).join(', ')}`,
    preference: (v) => `prefer ${listOf(v).join(', ')}`,
    exclude: (v) => `not from ${listOf(v).join(', ')}`,
    max_km: (v) => `within ${v} km`,
    max_distance_km: (v) => `within ${v} km`,
    product_id: (v) => `product ${v}`,
    product_ids: (v) => plural(listOf(v).length, 'product'),
    line_no: (v) => `line ${v}`,
    doc_key: (v) => String(v),
    category: (v) => String(v),
    status: (v) => String(v),
    decision: (v) => String(v),
    country: (v) => String(v),
  };
  for (const [key, words] of Object.entries(say)) {
    const v = args[key];
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out.push(words(v));
  }
  return out.join(' · ');
}

// A plan's result in a line: "Tomato Penne: 5 items, $22.71 at Pantry Mart Downtown".
export function planText(summary: CartSummary): string {
  const n = summary.lines?.length ?? 0;
  const left = (summary.not_stocked?.length ?? 0) + (summary.out_of_range?.length ?? 0)
    + (summary.skipped?.length ?? 0);
  const trip = summary.trip;
  return `${summary.recipe_name ?? 'The plan'}: ${plural(n, 'item')}, `
    + `${money(trip ? trip.total_cost : summary.total_cost)}`
    + `${trip && trip.stores.length ? ` at ${trip.stores.join(' and ')}` : ''}`
    + `${left > 0 ? `, ${left} left out` : ''}`;
}

const NOUNS: Record<string, string> = {
  list_recipes: 'recipe', find_product: 'product', list_products: 'product',
  get_product_origins: 'product', rank_products_by_origin: 'product', origin_triage: 'product',
  rank_alternatives: 'option', list_origin_submissions: 'submission',
};

// What a tool's result says, in a line: a plan's cart, a count of what came back, or the error.
export function resultText(name: string, r: Ev<'tool_result'>): string {
  if (r.is_error) return firstLine(r.text || 'The tool failed.');
  const tool = canonicalTool(name);
  const s = r.structured;
  const summary = isObj(s) && isObj(s.summary) ? s.summary : null;
  if (summary && summary.kind === 'mealplan') {
    const meals = Array.isArray(summary.meals) ? summary.meals.length : 0;
    return `${plural(meals, 'meal')} over ${plural(Number(summary.days) || 0, 'day')}`
      + (typeof summary.total_cost === 'number' ? `, ${money(summary.total_cost)}` : '');
  }
  if (summary && Array.isArray(summary.lines)) return planText(summary as CartSummary);
  const list = Array.isArray(s) ? s
    : isObj(s) && Array.isArray(s.result) ? s.result
      : isObj(s) && Array.isArray(s.items) ? s.items
        : isObj(s) && Array.isArray(s.products) ? s.products : null;
  if (list) {
    const total = isObj(s) && typeof s.total === 'number' ? s.total : list.length;
    const first = list.find((x) => isObj(x) && typeof x.name === 'string') as { name: string } | undefined;
    return `${plural(total, NOUNS[tool] ?? 'result')}${first ? `, first ${first.name}` : ''}`;
  }
  if (isObj(s) && typeof s.name === 'string') return s.name;
  if (r.text) return firstLine(r.text, 100);
  return 'Done';
}

// A tool step's line: what it was asked, then what came back.
function toolSummary(t: ToolStep): string {
  const asked = argsText(t.call.arguments);
  const byHub = t.call.by_hub ? 'called by the hub' : '';
  const offered = t.offered?.added.length ? `turned on ${t.offered.added.map(toolWords).join(', ')}` : '';
  const got = t.result ? offered || resultText(t.tool, t.result) : '';
  return [byHub, [asked, got].filter(Boolean).join(' → ')].filter(Boolean).join(' · ');
}

const modelShort = (model: string) => model.replace(/^(gemini|ollama):/, '').replace(/#.*$/, '');

function modelSummary(m: ModelStep, waiting: boolean): string {
  if (waiting) {
    const estimate = [...m.progress].reverse().find((p) => typeof p.estimate_s === 'number')?.estimate_s;
    return `Waiting for ${modelShort(m.model)}${estimate ? ` (usually about ${durationText(estimate * 1000)})` : ''}`;
  }
  const c = m.call;
  const tokens = c && c.prompt_tokens != null && c.output_tokens != null
    ? ` · read ${c.prompt_tokens.toLocaleString('en-US')} tokens, wrote ${c.output_tokens.toLocaleString('en-US')}` : '';
  const chose = m.chose.length ? `${m.chose.map(toolWords).join(', ')} · ` : '';
  return `${chose}${modelShort(m.model)}${tokens}`;
}

function modelStepName(m: ModelStep): string {
  if (m.status !== 'done') return 'Thinking';
  const n = m.call?.tool_calls ?? m.chose.length;
  if (n > 0) return n === 1 ? 'Chose a tool' : `Chose ${n} tools`;
  return 'Wrote the answer';
}

function observeSummary(o: ObserveStep): string {
  const added = [...new Set(o.observations.flatMap((x) => x.added))];
  const removed = [...new Set(o.observations.flatMap((x) => x.removed))];
  const parts: string[] = [];
  if (added.length) parts.push(`Turned on ${plural(added.length, 'tool')}: ${added.map(toolWords).join(', ')}`);
  if (removed.length) parts.push(`turned off ${removed.map(toolWords).join(', ')}`);
  for (const g of o.goals) parts.push(`added a goal: ${firstLine(g.text, 60)}`);
  if (parts.length) return parts.join('; ');
  if (o.status === 'running') return o.observers.length ? `Asking ${o.observers.join(', ')}` : '';
  return o.observations.length ? 'No new tools' : 'Nothing to change';
}

function importSummary(e: RecipeImportEvent): string {
  const host = (url: string | null) => (url ? url.replace(/^https?:\/\//, '').split('/')[0] : '');
  if (e.status === 'failed') return firstLine(e.error.message);
  const doc = e.result.doc;
  const from = e.via === 'console' ? 'reviewed by you' : host(e.url);
  if (!doc) return `No ingredient lines${from ? ` from ${from}` : ''}`;
  return `${doc.title} · ${plural(doc.lines.length, 'line')}${from ? ` · ${from}` : ''}`;
}

function mealsSummary(e: Ev<'meal_selection'>): string {
  if (e.status === 'failed') return `Could not read the dishes (${e.error ?? 'error'}); the model reads them itself`;
  if (!e.note) return 'No dish in your message matched a recipe';
  return firstLine(e.note.replace(/^\[meals\]\s*(parsed:\s*)?/, ''), 120);
}

// ─── Folding ─────────────────────────────────────────────────

const isGroupEvent = (e: TurnEvent) =>
  e.type === 'observation' || e.type === 'goal_enabled' || e.type === 'notice' || e.type === 'progress';

// The run a turn's events make, as far as they have come.
export function foldRun(turn: Turn): Run {
  const rows: Row[] = [];
  const tools = new Map<string, ToolStep>();
  const models = new Map<number, ModelStep>();
  const answers: Ev<'assistant'>[] = [];
  const imports: RecipeImportEvent[] = [];
  const reasoning: { step: number; text: string }[] = [];
  let thoughtMs = 0;
  // the observers' step still taking reports: it ends at the first event that is not one of theirs
  const group: { open: ObserveStep | null } = { open: null };
  let meta: RunMeta | null = null;
  let evals: Ev<'evals'> | null = null;
  let error: string | null = null;
  let traceId: string | null = null;
  let conversationId: string | null = null;
  let doneMs: number | null = null;
  let lastTs: number | null = null;
  let n = 0;
  const id = (kind: string) => `${turn.id}-${kind}-${n++}`;

  const closeObserver = (at: number | null | undefined, status: StepStatus = 'done') => {
    const o = group.open;
    if (!o) return;
    o.status = status;
    if (o.startTs != null && at != null) o.ms = Math.max(0, at - o.startTs);
    o.summary = observeSummary(o);
    if (status === 'done') o.name = 'Checked which tools fit';
    group.open = null;
  };
  const openObserver = (e: TurnEvent, observers: string[], model: string | null): ObserveStep => {
    const o: ObserveStep = {
      kind: 'observe', id: id('observe'), status: 'running', name: 'Checking which tools fit', summary: '',
      ms: null, observers, model, observations: [], goals: [], startTs: e.ts ?? null,
    };
    rows.push(o);
    group.open = o;
    return o;
  };

  for (const e of turn.events) {
    if (typeof e.ts === 'number') lastTs = e.ts;
    if (group.open && !isGroupEvent(e)) closeObserver(e.ts);
    switch (e.type) {
      case 'start':
        meta = { model: e.model, target: e.target, offered: e.tools.length, available: e.available ?? null,
          disclosure: e.disclosure ?? null, tokensIn: null, tokensOut: null, stop: null };
        traceId = e.trace_id ?? traceId;
        conversationId = e.conversation_id;
        break;
      case 'cart_change':
        rows.push({ kind: 'note', id: id('note'), text: cartChangeText(e), cart: true });
        break;
      case 'recipe_import':
        imports.push(e);
        rows.push({ kind: 'import', id: id('import'), event: e, status: e.status === 'failed' ? 'error' : 'done',
          name: e.status === 'failed' ? 'Could not read the link' : e.via === 'console' ? 'Took your reviewed recipe' : 'Read the recipe link',
          summary: importSummary(e), ms: e.ms > 0 ? e.ms : null });
        break;
      case 'observing':
        openObserver(e, e.observers, e.model);
        break;
      case 'observation':
        (group.open ?? openObserver(e, [], null)).observations.push(e);
        break;
      case 'goal_enabled':
        (group.open ?? openObserver(e, [], null)).goals.push(e);
        break;
      case 'tools_offered': {
        const last = [...rows].reverse().find((r): r is ToolStep => r.kind === 'tool');
        if (last && canonicalTool(last.tool) === 'discover_tools' && !last.offered) {
          last.offered = e;
          last.summary = toolSummary(last);
        } else {
          const o = openObserver(e, [], null);
          o.observations.push({ type: 'observation', observer: 'discover_tools', condition: '', kind: 'code',
            when: e.reason, value: true, evidence: '', added: e.added, removed: e.removed });
          closeObserver(e.ts);
        }
        break;
      }
      case 'meal_selection':
        rows.push({ kind: 'meals', id: id('meals'), event: e, status: e.status === 'failed' ? 'error' : 'done',
          name: 'Read the dishes in your message', summary: mealsSummary(e), ms: e.ms > 0 ? e.ms : null });
        break;
      case 'thinking': {
        const m: ModelStep = {
          kind: 'model', id: id('model'), status: 'running', name: 'Thinking', summary: '', ms: null,
          step: e.step, model: e.model, call: null, progress: [], startTs: e.ts ?? null, startRx: e.rx ?? null,
          chose: [], said: '',
        };
        rows.push(m);
        models.set(e.step, m);
        break;
      }
      case 'progress':
        models.get(e.step)?.progress.push(e);
        break;
      case 'llm_call': {
        let m = models.get(e.step);
        if (!m) {
          m = { kind: 'model', id: id('model'), status: 'running', name: '', summary: '', ms: null, step: e.step,
            model: e.model, call: null, progress: [], startTs: null, startRx: null, chose: [], said: '' };
          rows.push(m);
          models.set(e.step, m);
        }
        m.call = e;
        m.status = 'done';
        m.ms = typeof e.wall_s === 'number' ? e.wall_s * 1000
          : m.startTs != null && e.ts != null ? e.ts - m.startTs : null;
        if (e.reasoning) {
          reasoning.push({ step: e.step, text: e.reasoning });
          thoughtMs += m.ms ?? 0;
        }
        break;
      }
      case 'assistant': {
        // Words a model writes beside its tool calls come before those calls: they are the
        // model saying what it is about to do, not the answer. The answer is a step's words with
        // no tool call to follow, or what the hub sends once the steps run out.
        const m = models.get(e.step);
        const toolsFollow = (m?.call?.tool_calls ?? 0) > 0
          && ![...tools.values()].some((t) => t.call.step === e.step);
        if (m && toolsFollow) m.said = e.text;
        else answers.push(e);
        break;
      }
      case 'tool_call': {
        const t: ToolStep = {
          kind: 'tool', id: id('tool'), status: 'running', name: toolLabel(e.name, true), summary: '', ms: null,
          tool: e.name, call: e, result: null, offered: null,
        };
        t.summary = toolSummary(t);
        rows.push(t);
        tools.set(e.id, t);
        const m = models.get(e.step);
        if (m && !e.by_hub) m.chose.push(e.name);
        break;
      }
      case 'tool_result': {
        const t = tools.get(e.id);
        if (!t) break;
        t.result = e;
        t.status = e.is_error ? 'error' : 'done';
        t.ms = e.ms;
        t.name = toolLabel(t.tool, false);
        t.summary = toolSummary(t);
        break;
      }
      case 'error':
        error = e.message;
        rows.push({ kind: 'error', id: id('error'), status: 'error', name: 'Stopped by an error',
          summary: firstLine(e.message, 200), ms: null, message: e.message });
        break;
      case 'notice':
        rows.push({ kind: 'note', id: id('note'), text: e.text, cart: false });
        break;
      case 'evals':
        evals = e;
        traceId = e.trace_id || traceId;
        break;
      case 'done':
        doneMs = e.seconds * 1000;
        if (meta) Object.assign(meta, { tokensIn: e.input_tokens, tokensOut: e.output_tokens, stop: e.stop });
        if (e.stop === 'error' && !error) error = 'The assistant stopped at an error.';
        break;
      default:
        break;
    }
  }

  const open = turn.end === undefined;
  // the shopper's Stop, or a stream that ended early: what was still running stopped there
  // A step still running when the stream closed never finished: the shopper stopped it, the
  // stream was cut, or the hub's error ended the turn around it.
  if (!open) closeObserver(lastTs, turn.end === 'done' ? 'done' : 'stopped');
  if (!open) {
    for (const r of rows) {
      if (r.kind !== 'note' && r.status === 'running') r.status = 'stopped';
    }
  }
  if (turn.end === 'failed' && turn.failure && !error) {
    error = turn.failure;
    rows.push({ kind: 'error', id: id('error'), status: 'error', name: 'Stopped by an error',
      summary: firstLine(turn.failure, 200), ms: null, message: turn.failure });
  }
  for (const r of rows) {
    if (r.kind === 'model') {
      r.name = modelStepName(r);
      r.summary = modelSummary(r, r.status === 'running');
    } else if (r.kind === 'observe' && r.status !== 'done') {
      r.summary = observeSummary(r);
    }
  }

  const status: RunStatus = open ? 'running'
    : turn.end === 'stopped' ? 'stopped'
      : error ? 'failed' : 'answered';
  const steps = rows.filter((r): r is Step => r.kind !== 'note' && r.kind !== 'error');
  const stepCount = steps.length;
  const toolNames = steps.filter((s): s is ToolStep => s.kind === 'tool').map((s) => canonicalTool(s.tool));
  const runningNow = [...steps].reverse().find((s) => s.status === 'running');
  const live = runningNow ? runningNow.name : turn.events.length ? 'Working' : 'Starting';
  // The hub's own measure when it sent its end; otherwise this browser's, from the question to the
  // stream's end (a Stop, a cut) or, while it runs, to the newest event.
  const ms = doneMs ?? (turn.endedAt != null ? turn.endedAt - turn.sentAt : lastTs);
  const failedChecks = evals ? evals.checks.filter((c) => !c.passed).map((c) => c.name.replace(/_/g, ' ')) : [];

  const run: Run = {
    status, rows, stepCount, live, ms, headline: '', answers, imports, reasoning,
    thoughtMs: reasoning.length ? thoughtMs : null,
    thinking: open && reasoning.length > 0 && answers.length === 0,
    error, evals, failedChecks, traceId, conversationId, meta, tools: toolNames,
  };
  run.headline = headline(run);
  return run;
}

// The run's own line once it has ended.
export function headline(run: Pick<Run, 'status' | 'stepCount' | 'ms' | 'tools'>): string {
  const time = run.ms != null ? ` · ${durationText(run.ms)}` : '';
  const steps = plural(run.stepCount, 'step');
  switch (run.status) {
    case 'running':
      return '';
    case 'answered':
      return `${run.tools.some((t) => PLANNING.has(t)) ? 'Planned' : 'Answered'} in ${steps}${time}`;
    case 'stopped':
      return run.stepCount ? `Stopped after ${steps}${time}` : `Stopped before the first step${time}`;
    case 'failed':
      return run.stepCount ? `Stopped by an error after ${steps}${time}` : `Could not start${time}`;
    default:
      return '';
  }
}

// What the Settings button says the assistant runs on: "Gemini 3 Flash (preview) · pantry". Once
// the conversation has begun, the model and MCP server its answers came from (the run's start
// event names them, and a replayed run or the hub's own choice can make them other than the ones
// picked); before that, the ones picked for the first question, the server marked "(default)"
// while it is only the hub's default, since nothing has answered from it yet. A server goes by the
// short part of its name ("pantry, direct (bearer token)" is "pantry"). Empty until the hub's
// options are known.
export function runsOnText(
  options: { models: { id: string; label: string }[]; targets: { id: string; label: string }[];
    default_target: string } | null,
  picked: { model: string; target: string },
  answered: { model: string; target: string } | null,
): string {
  if (!options) return '';
  const on = answered ?? picked;
  if (!on.model || !on.target) return '';
  const model = options.models.find((m) => m.id === on.model)?.label ?? modelShort(on.model);
  const server = (options.targets.find((t) => t.id === on.target)?.label ?? on.target).split(',')[0];
  return `${model} · ${server}${!answered && on.target === options.default_target ? ' (default)' : ''}`;
}

// The run's settings and what it cost, for the end of its open timeline:
// "gemini-3-flash-preview · pantry · 2 of 17 tools offered at first · 9,930 tokens read, 96 written".
export function metaLine(meta: RunMeta, modelLabel: (id: string) => string = modelShort): string {
  const parts = [modelLabel(meta.model), meta.target];
  parts.push(meta.disclosure === 'progressive' && meta.available != null
    ? `${meta.offered} of ${meta.available} tools offered at first`
    : `${plural(meta.offered, 'tool')} offered`);
  if (meta.tokensIn != null && meta.tokensOut != null) {
    parts.push(`${meta.tokensIn.toLocaleString('en-US')} tokens read, ${meta.tokensOut.toLocaleString('en-US')} written in this conversation`);
  }
  return parts.join(' · ');
}

// What a local model's call has done so far, from its progress reports, for the progress bar
// (components/assistant/StepRow.tsx). Times are this browser's: `since` the call began, `tokensAt`
// the latest writing report, `writingAt` the first.
export interface Waiting {
  step: number; model: string; since: number; phase?: string; estimateS?: number;
  promptTokens?: number; newTokens?: number; readS?: number; readRate?: number;
  outTokens?: number; genRate?: number; samples?: number; basis?: string;
  tokens?: number; tokensAt?: number; writingAt?: number;
}

export function waitingOf(m: ModelStep, now: number): Waiting {
  const w: Waiting = { step: m.step, model: m.model, since: m.startRx ?? now };
  for (const p of m.progress) {
    const at = (p as TurnEvent).rx ?? now;
    if (p.phase === 'writing') {
      w.phase = 'writing';
      w.tokens = p.tokens ?? 0;
      w.tokensAt = at;
      w.writingAt = w.writingAt ?? at;
    } else {
      Object.assign(w, { phase: p.phase, estimateS: p.estimate_s, promptTokens: p.prompt_tokens_est,
        newTokens: p.new_tokens_est, readS: p.read_s, readRate: p.read_tok_s, outTokens: p.output_tokens_est,
        genRate: p.gen_tok_s, samples: p.samples, basis: p.basis });
    }
  }
  return w;
}

const clock = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.max(0, Math.round(s))}s`);
const count = (v: number) => Math.round(v).toLocaleString('en-US');

// Percent done = elapsed / (elapsed + seconds left). The seconds left come from token counts and
// rates: tokens still to read over the reading speed, then tokens still to write over the writing
// speed (the live one once tokens stream in). Past the expected length, a floor keeps the seconds
// left above zero, so the bar keeps closing in on 100% without claiming it before the reply.
export function callProgress(w: Waiting, now: number): { elapsed: number; left: number; over: boolean; detail: string } {
  const elapsed = Math.max(0, (now - w.since) / 1000);
  const R = w.readS ?? 0;
  const G = w.outTokens ?? 0;
  const g = w.genRate || 0;
  if (!g || !G) {                       // a cloud call: one phase, its usual reply time
    const est = w.estimateS ?? 0;
    const left = Math.max(est - elapsed, 0.05 * elapsed, 0.5);
    return { elapsed, left, over: elapsed > est, detail: `waiting for the reply (usually ~${clock(est)})` };
  }
  if (w.writingAt == null) {
    if (elapsed <= R || !R) {
      const read = Math.min(elapsed * (w.readRate ?? 0), w.newTokens ?? 0);
      return {
        elapsed, left: Math.max(R - elapsed, 0) + G / g, over: false,
        detail: `reading the prompt: ~${count(read)} of ~${count(w.newTokens ?? 0)} tokens to read`
          + `${w.promptTokens && w.newTokens != null && w.newTokens < w.promptTokens ? ` (${count(w.promptTokens - w.newTokens)} cached)` : ''}`
          + ` at ~${(w.readRate ?? 0).toFixed(0)} tok/s`,
      };
    }
    // Past the reading estimate with no tokens: Ollama sends a tool call whole, so it is most
    // likely writing one now (or reading is slower than usual).
    const written = (elapsed - R) * g;
    return {
      elapsed, left: Math.max(G - written, 0.1 * G) / g, over: written > G,
      detail: `probably writing a tool call: ~${count(written)} of ~${count(G)} usual tokens (Ollama sends a tool call whole)`,
    };
  }
  const writingFor = Math.max((now - w.writingAt) / 1000, 0.001);
  const tokens = w.tokens ?? 0;
  const live = tokens >= 5 ? tokens / Math.max((w.tokensAt ?? now) - w.writingAt, 1) * 1000 : g;
  const nowTokens = tokens + live * Math.max(0, (now - (w.tokensAt ?? now)) / 1000);
  const shown = Math.min(nowTokens, tokens + live * 2);   // do not run ahead of the stream
  return {
    elapsed, left: Math.max(G - shown, 0.1 * Math.max(G, shown)) / live, over: shown > G,
    detail: `writing: ${count(shown)} of ~${count(G)} usual tokens at ${live.toFixed(1)} tok/s (${clock(writingFor)} so far)`,
  };
}

// One model call's timing as Ollama reports it: how long reading the prompt and writing took.
export function callTiming(e: Ev<'llm_call'>): string {
  const secs = (s?: number) => (s == null ? '' : s >= 90 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${s.toFixed(1)}s`);
  const parts = [`step ${e.step} · ${secs(e.wall_s)}`];
  if (e.prompt_tokens != null && e.prompt_s) {
    // Ollama counts a cached prefix in prompt_tokens without re-reading it.
    const cachedMost = e.new_tokens_est != null && e.new_tokens_est < 0.9 * e.prompt_tokens;
    parts.push(cachedMost
      ? `read ~${e.new_tokens_est!.toLocaleString('en-US')} new of ${e.prompt_tokens.toLocaleString('en-US')} prompt tokens in ${secs(e.prompt_s)} (~${Math.round(e.new_tokens_est! / e.prompt_s)} tok/s; the rest was cached)`
      : `read ${e.prompt_tokens.toLocaleString('en-US')} prompt tokens in ${secs(e.prompt_s)} (${Math.round(e.prompt_tokens / e.prompt_s)} tok/s)`);
  }
  if (e.output_tokens != null && e.gen_s) {
    parts.push(`wrote ${e.output_tokens.toLocaleString('en-US')} tokens in ${secs(e.gen_s)} (${(e.output_tokens / e.gen_s).toFixed(1)} tok/s)`);
  }
  if (e.load_s && e.load_s > 1) parts.push(`model load ${secs(e.load_s)}`);
  parts.push(e.tool_calls ? `${e.tool_calls} tool call(s)` : 'no tool calls');
  return parts.join(' · ');
}

// ─── Questions to offer ──────────────────────────────────────

// Before the first question: one of each thing the assistant does well. `title` is what the
// button says first; `prompt` is the question it sends, exactly.
export const STARTERS: readonly { title: string; prompt: string }[] = [
  { title: 'Shop for a recipe link',
    prompt: 'I want to make https://omnivorescookbook.com/mala-chicken/ this week. What should I buy at stores within 5 km of downtown, what does it cost, and what won’t I find?' },
  { title: 'Find the cheapest product', prompt: 'What is the cheapest penne, and where can I buy it?' },
  { title: 'Plan dinners on a budget', prompt: 'Plan 3 dinners for under $60 with no dairy.' },
  { title: 'Draft two weeks of meals',
    prompt: '3 Pepperoni Pizza + 2 Chicken Fried Rice + 3 chicken briyani + 7 mango milkshakes in 2 weeks' },
  { title: 'Keep a country out',
    prompt: 'Plan tomato penne with nothing from the United States, and tell me how much of the basket’s origin is verified.' },
  { title: 'Check where food comes from', prompt: 'Which products in the catalog have a verified Canadian origin?' },
];

const normal = (s: string) => s.toLowerCase().replace(/[^a-z0-9$]+/g, ' ').trim();
const priceOf = (l: CartLine) => (l.trip_store ? l.trip_price ?? l.price : l.price);

// Two or three questions to ask next, under the newest answer: built from what the answer holds
// (its cart's dearest line, what it left out, a draft's trips), then the starters, and never a
// question already asked in this conversation. None after a run that did not answer: its Try again
// is the way on.
export function followUps(run: Pick<Run, 'status' | 'answers' | 'tools'>, asked: readonly string[], limit = 3): string[] {
  if (run.status !== 'answered' || run.answers.length === 0) return [];
  const seen = new Set(asked.map(normal));
  const out: string[] = [];
  const add = (q: string) => {
    if (out.length >= limit || seen.has(normal(q))) return;
    seen.add(normal(q));
    out.push(q);
  };
  const plans: PlanCardData[] = run.answers.flatMap((a) => a.plans ?? []);
  const cart = plans.find((p) => p.kind === 'plan')?.summary;
  const tools = new Set(run.tools);
  if (cart) {
    const dearest = [...(cart.lines ?? [])].sort((a, b) => (priceOf(b) ?? 0) - (priceOf(a) ?? 0))[0];
    if (dearest) add(`Find a cheaper option for ${dearest.product}`);
    const left = [...(cart.not_stocked ?? []), ...(cart.out_of_range ?? [])][0];
    if (left) add(`What can I use instead of ${left.ingredient}?`);
    if ((cart.trip?.stores.length ?? 0) > 1) add('Can I get everything at one store?');
  } else if (plans.some((p) => p.kind === 'mealplan') || tools.has('plan_meals')) {
    add('Make the plan cheaper');
    add('Swap one dinner for something vegetarian');
    add('What will the first shopping trip cost?');
  } else if (plans.some((p) => p.kind === 'week') || tools.has('plan_week')) {
    add('Make it vegetarian');
    add('Keep it under $40');
    add('Swap the most expensive dinner');
  } else if (tools.has('find_product') || tools.has('list_products') || tools.has('get_product')) {
    add('Plan a recipe that uses it');
    add('Which other stores sell it?');
  } else if (tools.has('get_product_origins') || tools.has('rank_products_by_origin')) {
    add('Which products are worth checking a label for?');
  }
  // the starters fill the rest, the shorter ones first (a link to a recipe page is for the start)
  for (const s of [...STARTERS].sort((a, b) => a.prompt.length - b.prompt.length)) add(s.prompt);
  return out;
}

// ─── Swaps in a cart ─────────────────────────────────────────

// The card the hub holds under `ref`, wherever its answer is.
export function cardIn(turns: readonly Turn[], ref: number): PlanCardData | null {
  for (const t of turns) {
    for (const e of t.events) {
      if (e.type === 'assistant') {
        const card = e.plans?.find((c) => c.ref === ref);
        if (card) return card;
      }
    }
  }
  return null;
}

// A swap's answer: the re-priced card in the place of the one it was chosen from, and its note
// under that turn's carts. Turns without that card are returned as they were (the same objects,
// so a page that draws each turn once redraws only the one that changed).
export function swapInTurns(turns: readonly Turn[], ref: number, card: PlanCardData, notice: string): Turn[] {
  return turns.map((t) => {
    let hit = false;
    const events = t.events.map((e) => {
      if (e.type !== 'assistant' || !e.plans) return e;
      const plans = replaceCard(e.plans, ref, card);
      if (!plans) return e;
      hit = true;
      return { ...e, plans };
    });
    return hit ? { ...t, events, notice } : t;
  });
}
