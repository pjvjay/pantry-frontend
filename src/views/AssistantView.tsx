import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  cartChangeText, cartLineKey, purchaseLineNo, replaceCard, replyBeforeChange, routedLinks,
  swapAnnouncement, swapBlocked, swapNotice,
} from '../alternatives';
import { AlternativesDialog } from '../components/alternatives';
import type { OptionsTarget } from '../components/alternatives';
import { ErrorBanner, JsonView } from '../components/common';
import Markdown from '../components/Markdown';
import { AskContext, CartActions, CartCard, PlanStrip } from '../components/cart';
import { EvalCard, Reasoning, RecipeImages, imagesIn } from '../components/flow';
import { ImportActions, ImportCard, ImportSheet } from '../components/ImportSheet';
import type { ImportStart } from '../components/ImportSheet';
import { BurrLink, LlmCalls } from '../components/plan';
import { agentChat, agentOptions, agentSwap, agentWarm } from '../hub';
import { chatMessageFor } from '../recipes';
import { ChatMeter } from '../telemetry';
import type {
  AgentEvent, AgentOptions, CartLine, CartSummary, Evals, LlmCallTrace, PlanCardData, RecipeDoc,
  RecipeImportEvent, SwapResult,
} from '../types';

const SUGGESTIONS = [
  'I want to make https://omnivorescookbook.com/mala-chicken/ this week. What should I buy at stores within 5 km of downtown, what does it cost, and what won’t I find?',
  'What is the cheapest penne, and where can I buy it?',
  'Plan 3 dinners for under $60 with no dairy.',
  'Plan tomato penne with nothing from the United States, and tell me how much of the basket’s origin is verified.',
  'Which products in the catalog have a verified Canadian origin?',
];

// One model call's timing: Ollama reports how long reading the prompt and generating took.
function callTiming(e: Extract<AgentEvent, { type: 'llm_call' }>): string {
  const secs = (s?: number) => (s == null ? '' : s >= 90 ? `${Math.floor(s / 60)}m${Math.round(s % 60)}s` : `${s.toFixed(1)}s`);
  const parts = [`step ${e.step} · ${secs(e.wall_s)}`];
  if (e.prompt_tokens != null && e.prompt_s) {
    // Ollama counts a cached prefix in prompt_tokens without re-reading it.
    const cachedMost = e.new_tokens_est != null && e.new_tokens_est < 0.9 * e.prompt_tokens;
    parts.push(cachedMost
      ? `read ~${e.new_tokens_est!.toLocaleString()} new of ${e.prompt_tokens.toLocaleString()} prompt tokens in ${secs(e.prompt_s)} (~${Math.round(e.new_tokens_est! / e.prompt_s)} tok/s; the rest was cached)`
      : `read ${e.prompt_tokens.toLocaleString()} prompt tokens in ${secs(e.prompt_s)} (${Math.round(e.prompt_tokens / e.prompt_s)} tok/s)`);
  }
  if (e.output_tokens != null && e.gen_s) {
    parts.push(`wrote ${e.output_tokens.toLocaleString()} tokens in ${secs(e.gen_s)} (${(e.output_tokens / e.gen_s).toFixed(1)} tok/s)`);
  }
  if (e.load_s && e.load_s > 1) parts.push(`model load ${secs(e.load_s)}`);
  parts.push(e.tool_calls ? `${e.tool_calls} tool call(s)` : 'no tool calls');
  return parts.join(' · ');
}

// The model call in flight. The hub sends its estimate when the call starts (learned from earlier
// calls: the prompt tokens to read and the reading speed, the usual reply length and the writing
// speed) and, while Ollama streams the reply, the tokens written so far.
interface Waiting {
  step: number; model: string; since: number; phase?: string; estimateS?: number;
  promptTokens?: number; newTokens?: number; readS?: number; readRate?: number;
  outTokens?: number; genRate?: number; samples?: number; basis?: string;
  tokens?: number; tokensAt?: number; writingAt?: number;
}

const clock = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.max(0, Math.round(s))}s`);
const n = (v: number) => Math.round(v).toLocaleString();

// Percent done = elapsed / (elapsed + seconds left). The seconds left come from token counts and
// rates: tokens still to read over the reading speed, then tokens still to write over the writing
// speed (the live one once tokens stream in). Past the expected length, a floor keeps the seconds
// left above zero, so the bar keeps closing in on 100% without claiming it before the reply.
function callProgress(w: Waiting, now: number) {
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
        detail: `reading the prompt: ~${n(read)} of ~${n(w.newTokens ?? 0)} tokens to read`
          + `${w.promptTokens && w.newTokens != null && w.newTokens < w.promptTokens ? ` (${n(w.promptTokens - w.newTokens)} cached)` : ''}`
          + ` at ~${(w.readRate ?? 0).toFixed(0)} tok/s`,
      };
    }
    // Past the reading estimate with no tokens: Ollama sends a tool call whole, so it is most
    // likely writing one now (or reading is slower than usual).
    const written = (elapsed - R) * g;
    return {
      elapsed, left: Math.max(G - written, 0.1 * G) / g, over: written > G,
      detail: `probably writing a tool call: ~${n(written)} of ~${n(G)} usual tokens (Ollama sends a tool call whole)`,
    };
  }
  const writingFor = Math.max((now - w.writingAt) / 1000, 0.001);
  const tokens = w.tokens ?? 0;
  const live = tokens >= 5 ? tokens / Math.max((w.tokensAt ?? now) - w.writingAt, 1) * 1000 : g;
  const nowTokens = tokens + live * Math.max(0, (now - (w.tokensAt ?? now)) / 1000);
  const shown = Math.min(nowTokens, tokens + live * 2);   // do not run ahead of the stream
  return {
    elapsed, left: Math.max(G - shown, 0.1 * Math.max(G, shown)) / live, over: shown > G,
    detail: `writing: ${n(shown)} of ~${n(G)} usual tokens at ${live.toFixed(1)} tok/s (${clock(writingFor)} so far)`,
  };
}

// The bar keeps its own one-second clock, so only it re-renders while a call runs: the chat
// above it (Markdown answers, tool cards with their JSON) is not redrawn every second.
function CallProgress({ w }: { w: Waiting }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const { elapsed, left, over, detail } = callProgress(w, now);
  const best = useRef({ since: 0, pct: 0 });
  if (best.current.since !== w.since) best.current = { since: w.since, pct: 0 };
  const pct = Math.max(best.current.pct, Math.min(99, (100 * elapsed) / (elapsed + left)));
  best.current.pct = pct;
  return (
    <div className="call-progress">
      <div className="call-progress-head">
        <span>step {w.step} · <code>{w.model}</code></span>
        <strong>{Math.floor(pct)}%</strong>
      </div>
      <div className={`progress ${over ? 'progress-over' : ''}`} role="progressbar"
           aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.floor(pct)}>
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div>
        {detail} · {clock(elapsed)} elapsed · {over ? `longer than usual, ~${clock(left)} more` : `~${clock(left)} left`}
      </div>
      <div className="muted">estimate from {w.basis || 'defaults'}</div>
    </div>
  );
}

type Item =
  | { kind: 'user'; text: string }
  // `plans`: the turn's plans, drawn as carts under the model's own sentences (`reply`);
  // `notice`: the shopper changed one of those carts since, which the model has yet to hear
  | { kind: 'assistant'; text: string; reply?: string; plans?: PlanCardData[]; notice?: string }
  | { kind: 'tool'; id: string; name: string; arguments: Record<string, unknown>;
      result?: Extract<AgentEvent, { type: 'tool_result' }> }
  | { kind: 'error'; text: string }
  | { kind: 'notice'; text: string }
  | { kind: 'meta'; text: string }
  // The model's own reasoning before a step's answer or tool call (a thinking model shows it).
  | { kind: 'reasoning'; text: string; step: number }
  // The answer's online evals and confidence, and the turn's trace.
  | { kind: 'evals'; evals: Evals; traceId: string }
  // Progressive disclosure: an observer saw something and changed the toolset or the goals.
  | { kind: 'observe'; label: string; detail: string; tone: 'code' | 'llm' | 'goal' | 'tools' }
  // A recipe the hub read from a link in the message, or the one the shopper reviewed.
  | { kind: 'import'; event: RecipeImportEvent };

// Tool names as the policy writes them (the gateway's pantry- prefix dropped).
const short = (names: string[]) => names.map((n) => n.replace(/^pantry-/, '').replace(/-/g, '_')).join(', ');

// What a pantry plan tool reports about its own run: its LLM calls phase by phase
// (summary.llm_calls) and the Burr run that traced it (summary.burr_run).
type PlanTrace = { llm_calls?: LlmCallTrace[]; burr_run?: string };
const planTraceOf = (structured: unknown): PlanTrace =>
  (structured as { summary?: PlanTrace } | null)?.summary ?? {};

function ToolCard({ item }: { item: Extract<Item, { kind: 'tool' }> }) {
  const r = item.result;
  const state = !r ? 'running' : r.is_error ? 'error' : 'ok';
  const trace = r ? planTraceOf(r.structured) : {};
  const calls = Array.isArray(trace.llm_calls) ? trace.llm_calls : [];
  const summary = (r?.structured as { summary?: Record<string, unknown> } | null)?.summary;
  const isPlan = !!summary && Array.isArray(summary.lines) && /plan.(recipe|from.text)$/.test(item.name);
  // a fetched recipe page: show the photos it holds
  const photos = r && !r.is_error && /fetch/.test(item.name) ? imagesIn(r.text || JSON.stringify(r.structured ?? '')) : [];
  return (
    <>
    <details className={`toolcard toolcard-${state}`}>
      <summary>
        <span className="toolcard-icon">{state === 'running' ? '⋯' : state === 'error' ? '✗' : '✓'}</span>
        <code className="toolcard-name">{item.name}</code>
        <span className="toolcard-args">{JSON.stringify(item.arguments).slice(0, 140)}</span>
        {r && <span className="step-meta">{r.ms} ms</span>}
      </summary>
      <div className="toolcard-body">
        <JsonView value={item.arguments} label="arguments" />
        {r && (r.structured != null
          ? <JsonView value={r.structured} label="structured result" />
          : <JsonView value={r.text} label={r.is_error ? 'error' : 'text result'} open={r.is_error} />)}
      </div>
    </details>
    {isPlan && <PlanStrip summary={summary as CartSummary} />}
    {photos.length > 0 && <RecipeImages urls={photos} />}
    {calls.length > 0 && <LlmCalls calls={calls} heading="inside pantry:" />}
    {trace.burr_run && (
      <div className="llm-calls"><span className="muted">inside pantry:</span> <BurrLink run={trace.burr_run} /></div>
    )}
    </>
  );
}

// An import's card, which opens the import sheet on what it shows.
function ImportItem({ event }: { event: RecipeImportEvent }) {
  const open = useContext(ImportActions);
  return <ImportCard event={event} onOpen={open} />;
}

// One chat item. Memoised: a new event appends an item (or completes one tool card) without
// redrawing the others, which matters once a conversation holds long answers and tool results.
const ChatItem = memo(function ChatItem({ it, routes }: { it: Item; routes: readonly string[] }) {
  if (it.kind === 'user') return <div className="bubble bubble-user">{it.text}</div>;
  if (it.kind === 'assistant') {
    // every plan drawn as a cart; a week plan keeps the hub's Markdown tables
    const plans = it.plans ?? [];
    if (plans.length > 0 && plans.every((c) => c.kind === 'plan')) {
      const before = it.reply ? replyBeforeChange(plans) : '';
      return (
        <div className="bubble bubble-agent bubble-cart">
          {it.reply && <Markdown text={it.reply} />}
          {plans.map((c, i) => (
            <CartCard key={i} summary={c.summary} cardRef={c.ref} pinned={c.pinned_lines} />
          ))}
          {before && <p className="cart-notice">{before}</p>}
          {it.notice && <p className="cart-notice">{it.notice}</p>}
        </div>
      );
    }
    // a week card offers to open the week in the Meal plan, drawn only where the console has it
    const links = routedLinks(plans.flatMap((c) => c.links ?? []), routes);
    return (
      <div className="bubble bubble-agent">
        <Markdown text={it.text} />
        {links.length > 0 && (
          <p className="card-links">
            {links.map((l) => <a key={l.href} className="card-link" href={l.href}>{l.label}</a>)}
          </p>
        )}
      </div>
    );
  }
  if (it.kind === 'tool') return <ToolCard item={it} />;
  if (it.kind === 'import') return <ImportItem event={it.event} />;
  if (it.kind === 'reasoning') return <Reasoning text={it.text} label={`step ${it.step} reasoning`} />;
  if (it.kind === 'evals') return <EvalCard evals={it.evals} traceId={it.traceId} />;
  if (it.kind === 'error') return <div className="banner banner-error">{it.text}</div>;
  if (it.kind === 'notice') return <div className="chat-notice">{it.text}</div>;
  if (it.kind === 'observe') {
    return (
      <div className={`chat-observe chat-observe-${it.tone}`}>
        <code>{it.label}</code>{it.detail && <div className="muted">{it.detail}</div>}
      </div>
    );
  }
  return <div className="chat-meta">{it.text}</div>;
});

const NO_ROUTES: readonly string[] = [];

// `routes`: the console's tabs, so a card's link is drawn only when it leads to one of them.
export default function AssistantView({ routes = NO_ROUTES }: { routes?: readonly string[] }) {
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [model, setModel] = useState('');
  const [target, setTarget] = useState('');
  const [disclosure, setDisclosure] = useState('progressive');
  const [conversation, setConversation] = useState<string | null>(null);
  // the conversation's MCP server, from its 'start' event: the sim gateway cannot re-price
  const [convTarget, setConvTarget] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The model call in flight (from the hub's `thinking` events).
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);
  const box = useRef<HTMLTextAreaElement | null>(null);
  // a cart's swap button: the request goes in the message box, for the shopper to send or edit
  const ask = useCallback((text: string) => { setInput(text); box.current?.focus(); }, []);

  // The cart line whose Options are open, a swap in flight, and what a screen reader hears
  // after one.
  const [optionsFor, setOptionsFor] = useState<OptionsTarget | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [announce, setAnnounce] = useState('');
  const itemsNow = useRef(items);
  itemsNow.current = items;
  // A swap redraws its card in place; the chat must not scroll away from it.
  const keepScroll = useRef(false);
  // The line focus returns to when the dialog closes: the one it was opened from, or the same
  // line of the card a swap drew in its place (a new element, found by its data-cart-line).
  const focusLine = useRef('');
  const returnFocus = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() {
      return focusLine.current
        ? document.querySelector<HTMLElement>(`[data-cart-line="${focusLine.current}"]`) : null;
    },
  }), []);

  const openOptions = useCallback((ref: number, line: CartLine, pinned: boolean) => {
    if (line.line_no == null) return;
    focusLine.current = cartLineKey(ref, line.line_no);
    setOptionsFor({ ref, line, pinned });
  }, []);
  const cartActions = useMemo(() => ({ open: openOptions, busy: swapping }),
    [openOptions, swapping]);

  // The import sheet: from the composer, or from a chat import's card with what it read.
  const [importOpen, setImportOpen] = useState(false);
  const [importStart, setImportStart] = useState<ImportStart | null>(null);
  const openImport = useCallback((start: ImportStart) => {
    setImportStart(start);
    setImportOpen(true);
  }, []);

  // "Use this" (or back to the planner's pick): the hub re-prices with no model call, and the
  // card it returns replaces the one the choice was made in. A refusal is thrown back to the
  // dialog, which shows it.
  const choose = async (productId: number | null) => {
    const t = optionsFor;
    if (!t || !conversation || t.line.line_no == null) return;
    const lineNo = t.line.line_no;
    setSwapping(true);
    let result: SwapResult;
    try {
      result = await agentSwap(conversation, { ref: t.ref, line_no: lineNo, product_id: productId });
    } catch (e) {
      setSwapping(false);
      throw e;
    }
    const { card, note } = result;
    const before = itemsNow.current.flatMap((it) => (it.kind === 'assistant' ? it.plans ?? [] : []))
      .find((c) => c.ref === t.ref);
    focusLine.current = cartLineKey(card.ref ?? t.ref, purchaseLineNo(card.summary, lineNo));
    keepScroll.current = true;
    setItems((prev) => prev.map((it) => {
      if (it.kind !== 'assistant' || !it.plans) return it;
      const plans = replaceCard(it.plans, t.ref, card);
      return plans ? { ...it, plans, notice: swapNotice(note) } : it;
    }));
    if (before) setAnnounce(swapAnnouncement(before.summary, card.summary, lineNo));
    setOptionsFor(null);
    setSwapping(false);
  };

  useEffect(() => {
    agentOptions().then((o) => {
      setOptions(o);
      setModel(o.default_model);
      setTarget(o.default_target);
      if (o.default_disclosure) setDisclosure(o.default_disclosure);
    }).catch((e: Error) => setError(`The demo hub is not reachable: ${e.message}`));
  }, []);

  useEffect(() => {
    if (keepScroll.current) { keepScroll.current = false; return; }
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items]);

  // A local model starts reading its instructions as soon as it is chosen: by the time the
  // question is typed, the first step has only the question left to read.
  const [warm, setWarm] = useState('');
  useEffect(() => {
    if (!model.startsWith('ollama:') || !target) { setWarm(''); return; }
    let live = true;
    const started = Date.now();
    setWarm('reading its instructions and tools ahead of your question…');
    agentWarm({ model, target, disclosure })
      .then((r) => {
        if (!live) return;
        const secs = Math.round((Date.now() - started) / 1000);
        setWarm(r.prompt_tokens && r.prompt_tokens > 50
          ? `ready: read its instructions and tools (${r.prompt_tokens.toLocaleString()} tokens) in ${secs} s`
          : 'ready: its instructions and tools were already read');
      })
      .catch(() => { if (live) setWarm(''); });
    return () => { live = false; };
  }, [model, target, disclosure]);

  // `recipeDoc`: the recipe the shopper reviewed in the import sheet, which the hub keeps as the
  // conversation's next imp:N; the model plans exactly its lines.
  const send = async (message: string, recipeDoc?: RecipeDoc) => {
    if (!message.trim() || busy || swapping) return;
    setBusy(true);
    setError('');
    setInput('');
    // a swap's "the assistant sees this with your next message" is answered by this message
    setItems((prev) => [...prev.map((it) => (it.kind === 'assistant' && it.notice
      ? { ...it, notice: undefined } : it)), { kind: 'user', text: message }]);
    const controller = new AbortController();
    abort.current = controller;
    let finished = false;
    // what this browser measures about the turn's stream, joined to its trace in the hub
    const meter = new ChatMeter(model);
    try {
      await agentChat({ message, conversation_id: conversation, model, target, disclosure,
                        ...(recipeDoc ? { recipe_doc: recipeDoc } : {}) }, (e) => {
        meter.event(e as { at?: number; trace_id?: string });
        if (e.type === 'start') {
          setConversation(e.conversation_id);
          setConvTarget(e.target);
        }
        if (e.type === 'done') finished = true;
        if (e.type === 'thinking') setWaiting({ step: e.step, model: e.model, since: Date.now() });
        else if (e.type === 'progress') {
          const at = Date.now();
          setWaiting((w) => {
            const base: Waiting = w ?? { step: e.step, model: e.model, since: at };
            return e.phase === 'writing'
              ? { ...base, phase: 'writing', tokens: e.tokens ?? 0, tokensAt: at,
                  writingAt: base.writingAt ?? at }
              : { ...base, phase: e.phase, estimateS: e.estimate_s, promptTokens: e.prompt_tokens_est,
                  newTokens: e.new_tokens_est, readS: e.read_s, readRate: e.read_tok_s,
                  outTokens: e.output_tokens_est, genRate: e.gen_tok_s, samples: e.samples, basis: e.basis };
          });
        } else setWaiting(null);
        setItems((prev) => {
          switch (e.type) {
            case 'start':
              return [...prev, { kind: 'meta', text: `${e.model} · ${e.target} · `
                + (e.disclosure === 'progressive'
                  ? `${e.tools.length} of ${e.available ?? e.tools.length} tools offered (+ discover_tools): ${short(e.tools)}; observers enable the rest`
                  : `all ${e.tools.length} tools offered`) }];
            case 'observing':
              return [...prev, { kind: 'meta', text: `observers reading (${e.model.replace(/^gemini:/, '')}): ${e.observers.join(', ')}` }];
            case 'observation':
              return [...prev, {
                kind: 'observe', tone: e.kind,
                label: `${e.observer}.when("${e.when}") → ${e.value ? 'true' : 'false'}`,
                detail: [e.evidence && `evidence: ${e.evidence}`,
                  e.added.length ? `+ ${short(e.added)}` : '',
                  e.removed.length ? `− ${short(e.removed)}` : ''].filter(Boolean).join(' · '),
              }];
            case 'goal_enabled':
              return [...prev, { kind: 'observe', tone: 'goal', label: `goal enabled (${e.reason.replace(/^observer:/, '')})`, detail: e.text }];
            case 'tools_offered':
              return [...prev, { kind: 'observe', tone: 'tools', label: `discover_tools → + ${short(e.added)}`, detail: e.reason.replace(/^discover_tools:/, 'asked for: ') }];
            case 'assistant':
              return [...prev, { kind: 'assistant', text: e.text, reply: e.reply, plans: e.plans }];
            case 'cart_change':
              // the shopper's change, told to the model ahead of this message
              return [...prev, { kind: 'meta', text: cartChangeText(e) }];
            case 'recipe_import':
              return [...prev, { kind: 'import', event: e }];
            case 'tool_call':
              return [...prev, { kind: 'tool', id: e.id, name: e.name, arguments: e.arguments }];
            case 'tool_result':
              return prev.map((it) => (it.kind === 'tool' && it.id === e.id && !it.result
                ? { ...it, result: e } : it));
            case 'error':
              return [...prev, { kind: 'error', text: e.message }];
            case 'notice':
              return [...prev, { kind: 'notice', text: e.text }];
            case 'llm_call':
              return [...prev, { kind: 'meta', text: callTiming(e) },
                ...(e.reasoning ? [{ kind: 'reasoning' as const, text: e.reasoning, step: e.step }] : [])];
            case 'evals':
              return [...prev, { kind: 'evals', evals: e, traceId: e.trace_id }];
            case 'done':
              return [...prev, { kind: 'meta', text: `${e.stop} · ${e.steps} step(s) · ${e.seconds}s · `
                + `${e.input_tokens.toLocaleString()} in / ${e.output_tokens.toLocaleString()} out tokens (conversation)` }];
            default:
              return prev;
          }
        });
      }, controller.signal, () => meter.opened());
      if (!finished) setError('The hub closed the answer stream before the agent finished (was the hub restarted?).');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      meter.finish(finished ? 'done' : 'interrupted');
      setBusy(false);
      setWaiting(null);
      abort.current = null;
    }
  };

  const reset = () => {
    abort.current?.abort();
    setOptionsFor(null);
    setConversation(null);
    setConvTarget('');
    setItems([]);
    setError('');
  };

  return (
    <div className="view assistant">
      <section className="panel">
        <div className="plan-header">
          <h2>Assistant</h2>
          <div className="form-row compact">
            <label>
              model
              <select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
                {options?.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label>
              MCP server
              <select value={target} onChange={(e) => setTarget(e.target.value)} disabled={busy}>
                {options?.targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </label>
            <label>
              toolset
              <select value={disclosure} onChange={(e) => setDisclosure(e.target.value)} disabled={busy}>
                <option value="progressive">progressive (observers enable tools)</option>
                <option value="all">all tools from the start</option>
              </select>
            </label>
            <button type="button" className="secondary" onClick={reset}>New conversation</button>
          </div>
        </div>
        <p className="card-sub">
          A grocery agent that plans by calling the pantry MCP tools: every tool call and its
          result appears below as it happens. Its instructions are pantry-api's recipe-shopper
          skill{options && !options.skill_loaded && ' (not found: running with the short preamble only)'}.
          A recipe link in your message is read by the demo hub before the model starts, and the
          assistant plans exactly the lines it read; <strong>Import a recipe</strong> lets you
          review them first, or paste a list. A page the hub cannot read goes to the gateway's
          fetch tool (<strong>pantry-recipes</strong>); the direct <strong>pantry</strong> server
          has no fetch.
        </p>
        {/* always rendered, so the line appearing never moves the chat below it */}
        <p className="muted warm-line">{warm || '\u00a0'}</p>
      </section>

      <ErrorBanner error={error} />

      <div className="chat">
        {items.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => void send(s)} disabled={busy || !options}>
                {s}
              </button>
            ))}
          </div>
        )}
        <AskContext.Provider value={ask}>
          <CartActions.Provider value={cartActions}>
            <ImportActions.Provider value={openImport}>
              {items.map((it, i) => <ChatItem key={i} it={it} routes={routes} />)}
            </ImportActions.Provider>
          </CartActions.Provider>
        </AskContext.Provider>
        <div className="sr-only" role="status">{announce}</div>
        {busy && (
          <div className="chat-meta">
            {waiting ? <CallProgress w={waiting} /> : 'working…'}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <AlternativesDialog
        conversationId={conversation}
        target={optionsFor}
        blocked={swapBlocked(busy, convTarget)}
        returnFocus={returnFocus}
        onChoose={choose}
        onClose={() => setOptionsFor(null)}
      />

      <ImportSheet
        open={importOpen}
        onClose={() => setImportOpen(false)}
        start={importStart}
        planInChat={options ? (doc) => void send(chatMessageFor(doc), doc) : null}
        chatBlocked={busy ? 'The assistant is answering; wait for it, or press Stop, first.'
          : swapping ? 'A cart change is being priced; try again in a moment.' : null}
      />

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <button type="button" className="secondary" onClick={() => openImport({})}>
          Import a recipe
        </button>
        <textarea ref={box} rows={2} value={input} placeholder="Ask about a recipe link, a product, a week of dinners…"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); }
                  }} />
        {busy
          ? <button type="button" className="secondary" onClick={() => abort.current?.abort()}>Stop</button>
          : <button disabled={!input.trim() || !options || swapping}>Send</button>}
      </form>
    </div>
  );
}
