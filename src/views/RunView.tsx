import { useEffect, useMemo, useState } from 'react';
import { ErrorBanner } from '../components/common';
import { EvalCard, Reasoning, Waterfall, dur, modelSegments } from '../components/flow';
import Markdown from '../components/Markdown';
import { runDetail } from '../hub';
import type { BurrRun, GatewayTrace, RunDetail, Span } from '../types';

// One Assistant run as every system saw it, on one page and one clock:
//   the hub's trace: the turn, the observers, each model step (tokens, cache, queued, reading,
//     writing, reasoning), each MCP tool call and the online evals;
//   ContextForge: each tool call's gateway trace (request, tool invocation, status, sizes);
//   pantry's Burr tracker: each plan call's actions at their recorded times, with their results
//     and the state they changed;
//   the browser: how the answer's stream arrived and painted.

const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const fmtN = (v: unknown, digits = 0) => (typeof v === 'number' ? v.toLocaleString(undefined, {
  maximumFractionDigits: digits, minimumFractionDigits: digits }) : '–');
const pct = (v: unknown) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '–');
const money = (v: unknown) => (typeof v === 'number' ? (v === 0 ? '$0' : `$${v < 0.01 ? v.toFixed(5) : v.toFixed(3)}`) : '–');
const json = (v: unknown) => JSON.stringify(v, null, 1);

const BUDGET_LABEL: Record<string, string> = {
  read: 'model reading', write: 'model writing', queued: 'queued for the model', load: 'model loading',
  provider: 'model (provider)', tools: 'MCP tools', gateway: 'ContextForge overhead',
  observers: 'observers', other: 'hub and network',
};

// Where the run's wall time went, by category, from the spans.
function budget(spans: Span[], wall: number): { key: string; ms: number }[] {
  const acc: Record<string, number> = {};
  const add = (k: string, ms: number) => { acc[k] = (acc[k] ?? 0) + Math.max(ms, 0); };
  for (const s of spans) {
    if (s.kind === 'model') {
      const segs = modelSegments(s.attrs);
      if (segs.length) segs.forEach((x) => add(x.kind, x.ms));
      else add('provider', num(s.duration_ms));
    } else if (s.kind === 'tool') {
      const overhead = num(s.attrs.gateway_overhead_ms);
      add('gateway', overhead);
      add('tools', num(s.duration_ms) - overhead);
    } else if (s.kind === 'observers') {
      add('observers', num(s.duration_ms));
    }
  }
  const counted = Object.values(acc).reduce((a, b) => a + b, 0);
  add('other', wall - counted);
  return Object.entries(acc).map(([key, ms]) => ({ key, ms })).filter((x) => x.ms > 0.5)
    .sort((a, b) => b.ms - a.ms);
}

function TimeBudget({ spans, wall }: { spans: Span[]; wall: number }) {
  const parts = budget(spans, wall);
  const total = parts.reduce((a, b) => a + b.ms, 0) || 1;
  return (
    <div className="budget">
      <div className="budget-bar">
        {parts.map((p) => (
          <span key={p.key} className={`budget-${p.key}`} style={{ width: `${(100 * p.ms) / total}%` }}
                title={`${BUDGET_LABEL[p.key]}: ${dur(p.ms)}`} />
        ))}
      </div>
      <div className="budget-legend">
        {parts.map((p) => (
          <span key={p.key}><i className={`budget-key budget-${p.key}`} />{BUDGET_LABEL[p.key]} {dur(p.ms)}{' '}
            <span className="muted">({Math.round((100 * p.ms) / total)}%)</span></span>
        ))}
      </div>
    </div>
  );
}

function ModelSteps({ spans }: { spans: Span[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const steps = spans.filter((s) => s.kind === 'model').sort((a, b) => a.start_ms - b.start_ms);
  if (!steps.length) return <p className="muted">No model steps.</p>;
  return (
    <div className="table-wrap">
      <table className="metrics-table">
        <thead><tr>
          <th>step</th><th>tool calls</th><th>prompt tokens</th><th>new (est.)</th><th>cached</th>
          <th>reading</th><th>read tok/s</th><th>output tokens</th><th>writing</th><th>write tok/s</th>
          <th>queued</th><th>first token</th><th>total</th><th>cost</th><th />
        </tr></thead>
        <tbody>
          {steps.map((s) => {
            const a = s.attrs;
            const text = typeof a.text === 'string' ? a.text : '';
            const reasoning = typeof a.reasoning === 'string' ? a.reasoning : '';
            return [
              <tr key={s.id}>
                <td>{String(a.step ?? '')}</td><td>{fmtN(a.tool_calls)}</td>
                <td>{fmtN(a.prompt_tokens)}</td><td>{fmtN(a.new_tokens_est)}</td><td>{pct(a.cached_share)}</td>
                <td>{dur(num(a.prompt_s) * 1000 || null)}</td><td>{fmtN(a.read_tok_s, 1)}</td>
                <td>{fmtN(a.output_tokens)}</td><td>{dur(num(a.gen_s) * 1000 || null)}</td>
                <td>{fmtN(a.write_tok_s, 1)}</td><td>{dur(modelSegments(a).find((x) => x.kind === 'queued')?.ms ?? null)}</td>
                <td>{dur(typeof a.first_token_ms === 'number' ? a.first_token_ms : null)}</td>
                <td>{dur(s.duration_ms)}</td><td>{money(a.cost_usd)}</td>
                <td>{(text || reasoning) && (
                  <button type="button" className="mini" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    {open === s.id ? 'hide' : 'text'}
                  </button>
                )}</td>
              </tr>,
              open === s.id && (
                <tr key={`${s.id}-open`}><td colSpan={15}>
                  {reasoning && <Reasoning text={reasoning} />}
                  {text && <div className="run-text"><Markdown text={text} /></div>}
                </td></tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

function GatewayCard({ g }: { g: GatewayTrace }) {
  if (g.note) return <p className="muted">ContextForge: {g.note}</p>;
  return (
    <div className="run-card">
      <div className="run-card-head">
        <strong>ContextForge</strong> <code>{g.name}</code> · HTTP {g.http_status} · {g.status} · {dur(g.duration_ms ?? null)}
        <span className="muted"> trace {g.trace_id}</span>
      </div>
      <table className="metrics-table compact">
        <thead><tr><th>span</th><th>at</th><th>took</th><th>status</th><th>attributes</th></tr></thead>
        <tbody>
          {(g.spans ?? []).map((s, i) => (
            <tr key={i}>
              <td>{s.name}</td><td>{dur(s.start_ms)}</td><td>{dur(s.duration_ms)}</td><td>{s.status}</td>
              <td className="msg"><code>{Object.entries(s.attributes).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}</code></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BurrCard({ b, toolStart }: { b: BurrRun; toolStart: number }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="run-card">
      <div className="run-card-head">
        <strong>pantry (Burr)</strong> <code>{b.app_id}</code>{' '}
        <a href={b.ui_url} target="_blank" rel="noreferrer">open in the Burr UI ↗</a>
      </div>
      {b.note && <p className="muted">{b.note}</p>}
      {b.steps.length > 0 && (
        <table className="metrics-table compact">
          <thead><tr><th>action</th><th>at (in the call)</th><th>took</th><th>result</th><th>state it changed</th><th /></tr></thead>
          <tbody>
            {b.steps.map((s) => [
              <tr key={s.sequence_id} className={s.exception ? 'row-bad' : ''}>
                <td>{s.action}</td>
                <td>{s.start_ms == null ? '–' : dur(s.start_ms - toolStart)}</td>
                <td>{dur(s.ms)}</td>
                <td className="msg"><code>{s.exception ?? (typeof s.result === 'string' ? s.result : JSON.stringify(s.result))}</code></td>
                <td>{Object.keys(s.changed).join(', ') || '–'}</td>
                <td>{Object.keys(s.changed).length > 0 && (
                  <button type="button" className="mini" onClick={() => setOpen(open === s.sequence_id ? null : s.sequence_id)}>
                    {open === s.sequence_id ? 'hide' : 'state'}
                  </button>
                )}</td>
              </tr>,
              open === s.sequence_id && (
                <tr key={`${s.sequence_id}-state`}><td colSpan={6}><pre className="run-pre">{json(s.changed)}</pre></td></tr>
              ),
            ])}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ToolCalls({ detail }: { detail: RunDetail }) {
  const tools = detail.trace.spans.filter((s) => s.kind === 'tool').sort((a, b) => a.start_ms - b.start_ms);
  if (!tools.length) return <p className="muted">No tool calls.</p>;
  return (
    <>
      {tools.map((t) => {
        const a = t.attrs;
        const gateway = detail.gateway.find((g) => g.tool_span === t.id);
        const burr = detail.burr.find((b) => b.tool_span === t.id);
        return (
          <div key={t.id} className="run-tool">
            <div className="run-card-head">
              <strong>{String(a.tool ?? t.name)}</strong> {t.status !== 'ok' && <span className="eval-check eval-fail">{t.status}</span>}{' '}
              <span className="muted">
                at {dur(t.start_ms)} · {dur(t.duration_ms)} in the hub · MCP {dur(typeof a.mcp_ms === 'number' ? a.mcp_ms : null)}
                {typeof a.gateway_overhead_ms === 'number' && <> · ContextForge overhead {dur(a.gateway_overhead_ms)}</>}
                {' '}· result {fmtN(a.result_chars)} chars, the model read {fmtN(a.model_chars)}
              </span>
            </div>
            <details><summary>arguments</summary><pre className="run-pre">{json(a.arguments)}</pre></details>
            {typeof a.preview === 'string' && (
              <details><summary>result preview</summary><pre className="run-pre">{a.preview}</pre></details>
            )}
            {gateway && <GatewayCard g={gateway} />}
            {burr && <BurrCard b={burr} toolStart={t.start_ms} />}
          </div>
        );
      })}
    </>
  );
}

function Disclosure({ spans }: { spans: Span[] }) {
  const events = spans.flatMap((s) => s.events.map((e) => ({ ...e, where: s.name })))
    .filter((e) => e.name === 'observation' || e.name === 'tools_offered' || e.name === 'goal_enabled'
      || e.name === 'notice')
    .sort((a, b) => a.at_ms - b.at_ms);
  if (!events.length) return <p className="muted">No observers fired (or every tool was offered from the start).</p>;
  return (
    <table className="metrics-table compact">
      <thead><tr><th>at</th><th>where</th><th>what</th><th>detail</th></tr></thead>
      <tbody>
        {events.map((e, i) => {
          const a = e.attrs as Record<string, unknown>;
          const added = Array.isArray(a.added) ? (a.added as string[]) : [];
          return (
            <tr key={i}>
              <td>{dur(e.at_ms)}</td><td>{e.where}</td>
              <td>{e.name === 'observation' ? `${String(a.observer)}.${String(a.condition)}` : e.name}</td>
              <td className="msg">{a.value === false ? 'did not fire' : ''}
                {added.length > 0 && <>added {added.join(', ')}</>}
                {typeof a.text === 'string' && a.text}{typeof a.reason === 'string' && ` (${a.reason})`}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function RunView({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setDetail(null);
    runDetail(id).then(setDetail).catch((e: Error) => setError(e.message));
  }, [id]);
  const answer = useMemo(() => {
    const steps = (detail?.trace.spans ?? []).filter((s) => s.kind === 'model' && typeof s.attrs.text === 'string');
    return steps.length ? String(steps[steps.length - 1].attrs.text) : '';
  }, [detail]);
  if (error) return <ErrorBanner error={error} />;
  if (!detail) return <p className="muted">Loading the run…</p>;
  const t = detail.trace;
  const models = t.spans.filter((s) => s.kind === 'model');
  const sum = (k: string) => models.reduce((acc, s) => acc + num(s.attrs[k]), 0);
  const queued = models.reduce((acc, s) => acc + (modelSegments(s.attrs).find((x) => x.kind === 'queued')?.ms ?? 0), 0);
  const kpis: [string, string][] = [
    ['time', dur(t.wall_ms)], ['steps', String(t.steps)],
    ['tokens in / out', `${fmtN(t.input_tokens)} / ${fmtN(t.output_tokens)}`],
    ['reading', dur(sum('prompt_s') * 1000 || null)], ['writing', dur(sum('gen_s') * 1000 || null)],
    ['queued', dur(queued || null)], ['tool calls', String(t.spans.filter((s) => s.kind === 'tool').length)],
    ['cost (paid list)', money(t.cost_usd)], ['confidence', pct(t.evals?.answer_confidence)],
  ];
  return (
    <div className="run-view">
      <section className="panel">
        <div className="plan-header">
          <h2>Run {t.id}</h2>
          <div className="row-gap">
            <a className="secondary-link" href={`/hub/runs/${encodeURIComponent(t.id)}`} target="_blank" rel="noreferrer">JSON ↗</a>
            <button type="button" className="secondary" onClick={onClose}>Back to metrics</button>
          </div>
        </div>
        <p className="card-sub">
          <code>{t.model}</code> · {t.target} · {t.disclosure} toolset · {t.status} · {new Date(t.started_at).toLocaleString()}
        </p>
        <p className="run-message">“{t.message}”</p>
        <div className="kpis">
          {kpis.map(([k, v]) => <div key={k} className="kpi"><span className="kpi-v">{v}</span><span className="kpi-k">{k}</span></div>)}
        </div>
        <h3>Where the time went</h3>
        <TimeBudget spans={t.spans} wall={num(t.wall_ms)} />
        <p className="muted">
          Sources: the hub's trace{detail.gateway.length > 0 && ', ContextForge (each tool call\'s gateway trace)'}
          {detail.burr.length > 0 && ', pantry\'s Burr tracker (each plan call\'s steps, at their recorded times)'}
          {t.browser && ', the browser'}.
        </p>
      </section>
      <section className="panel">
        <h3>Timeline</h3>
        <Waterfall trace={t} />
      </section>
      <section className="panel">
        <h3>Model steps</h3>
        <ModelSteps spans={t.spans} />
      </section>
      <section className="panel">
        <h3>Tool calls: the hub, ContextForge and pantry</h3>
        <ToolCalls detail={detail} />
      </section>
      <div className="grid-2">
        <section className="panel">
          <h3>Evals and confidence</h3>
          {t.evals ? <EvalCard evals={t.evals} /> : <p className="muted">Not evaluated.</p>}
        </section>
        <section className="panel">
          <h3>Observers and tools offered</h3>
          <Disclosure spans={t.spans} />
        </section>
      </div>
      {t.browser && (
        <section className="panel">
          <h3>Browser</h3>
          <div className="kpis">
            {Object.entries(t.browser).filter(([k]) => k.endsWith('_ms') || k === 'events').map(([k, v]) => (
              <div key={k} className="kpi"><span className="kpi-v">{k.endsWith('_ms') ? dur(v as number) : String(v)}</span>
                <span className="kpi-k">{k.replace(/_ms$/, '').replace(/_/g, ' ')}</span></div>
            ))}
          </div>
        </section>
      )}
      {answer && (
        <section className="panel">
          <h3>The answer</h3>
          <div className="run-text"><Markdown text={answer} /></div>
        </section>
      )}
    </div>
  );
}
