import { useEffect, useRef, useState } from 'react';
import { ErrorBanner, JsonView } from '../components/common';
import Markdown from '../components/Markdown';
import { BurrLink, LlmCalls } from '../components/plan';
import { agentChat, agentOptions } from '../hub';
import type { AgentEvent, AgentOptions, LlmCallTrace } from '../types';

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

function CallProgress({ w, now }: { w: Waiting; now: number }) {
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
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; id: string; name: string; arguments: Record<string, unknown>;
      result?: Extract<AgentEvent, { type: 'tool_result' }> }
  | { kind: 'error'; text: string }
  | { kind: 'notice'; text: string }
  | { kind: 'meta'; text: string }
  // Progressive disclosure: an observer saw something and changed the toolset or the goals.
  | { kind: 'observe'; label: string; detail: string; tone: 'code' | 'llm' | 'goal' | 'tools' };

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
    {calls.length > 0 && <LlmCalls calls={calls} heading="inside pantry:" />}
    {trace.burr_run && (
      <div className="llm-calls"><span className="muted">inside pantry:</span> <BurrLink run={trace.burr_run} /></div>
    )}
    </>
  );
}

export default function AssistantView() {
  const [options, setOptions] = useState<AgentOptions | null>(null);
  const [model, setModel] = useState('');
  const [target, setTarget] = useState('');
  const [disclosure, setDisclosure] = useState('progressive');
  const [conversation, setConversation] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The model call in flight (from the hub's `thinking` events) and a clock for its wait.
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [now, setNow] = useState(Date.now());
  const abort = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    agentOptions().then((o) => {
      setOptions(o);
      setModel(o.default_model);
      setTarget(o.default_target);
      if (o.default_disclosure) setDisclosure(o.default_disclosure);
    }).catch((e: Error) => setError(`The demo hub is not reachable: ${e.message}`));
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [items]);

  useEffect(() => {
    if (!busy) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [busy]);

  const send = async (message: string) => {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError('');
    setInput('');
    setItems((prev) => [...prev, { kind: 'user', text: message }]);
    const controller = new AbortController();
    abort.current = controller;
    let finished = false;
    try {
      await agentChat({ message, conversation_id: conversation, model, target, disclosure }, (e) => {
        if (e.type === 'start') setConversation(e.conversation_id);
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
              return [...prev, { kind: 'assistant', text: e.text }];
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
              return [...prev, { kind: 'meta', text: callTiming(e) }];
            case 'done':
              return [...prev, { kind: 'meta', text: `${e.stop} · ${e.steps} step(s) · ${e.seconds}s · `
                + `${e.input_tokens.toLocaleString()} in / ${e.output_tokens.toLocaleString()} out tokens (conversation)` }];
            default:
              return prev;
          }
        });
      }, controller.signal);
      if (!finished) setError('The hub closed the answer stream before the agent finished (was the hub restarted?).');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
      setWaiting(null);
      abort.current = null;
    }
  };

  const reset = () => {
    abort.current?.abort();
    setConversation(null);
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
          Through <strong>pantry-recipes</strong> it can read a recipe page with the gateway's
          fetch tool but cannot write; the direct <strong>pantry</strong> server has no fetch.
        </p>
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
        {items.map((it, i) => {
          if (it.kind === 'user') return <div key={i} className="bubble bubble-user">{it.text}</div>;
          if (it.kind === 'assistant') {
            return <div key={i} className="bubble bubble-agent"><Markdown text={it.text} /></div>;
          }
          if (it.kind === 'tool') return <ToolCard key={i} item={it} />;
          if (it.kind === 'error') return <div key={i} className="banner banner-error">{it.text}</div>;
          if (it.kind === 'notice') return <div key={i} className="chat-notice">{it.text}</div>;
          if (it.kind === 'observe') {
            return (
              <div key={i} className={`chat-observe chat-observe-${it.tone}`}>
                <code>{it.label}</code>{it.detail && <div className="muted">{it.detail}</div>}
              </div>
            );
          }
          return <div key={i} className="chat-meta">{it.text}</div>;
        })}
        {busy && (
          <div className="chat-meta">
            {waiting ? <CallProgress w={waiting} now={now} /> : 'working…'}
          </div>
        )}
        <div ref={bottom} />
      </div>

      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <textarea rows={2} value={input} placeholder="Ask about a recipe link, a product, a week of dinners…"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); }
                  }} />
        {busy
          ? <button type="button" className="secondary" onClick={() => abort.current?.abort()}>Stop</button>
          : <button disabled={!input.trim() || !options}>Send</button>}
      </form>
    </div>
  );
}
