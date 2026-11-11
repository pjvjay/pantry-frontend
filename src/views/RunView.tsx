import { useEffect, useMemo, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { StateTag } from '../components/evidence';
import { EvalCard, Reasoning, Waterfall, dur, modelSegments } from '../components/flow';
import { Icon } from '../components/icons';
import Markdown from '../components/Markdown';
import { Sheet } from '../components/Sheet';
import { Notice, Skeleton } from '../components/ui';
import { runDetail } from '../hub';
import { useHubStatus } from '../hubStatus';
import type { BurrRun, GatewayTrace, RunDetail, Span } from '../types';
import { runStatus } from '../workshop';

// One Assistant run as every system saw it, on one clock, in a drawer over Workshop › Metrics (the
// drawer preset of components/Sheet.tsx):
//   the hub's trace: the turn, the observers, each model step (tokens, cache, queued, reading,
//     writing, reasoning), each MCP tool call and the online evals;
//   ContextForge: each tool call's gateway trace (request, tool invocation, status, sizes);
//   pantry's Burr tracker: each plan call's actions at their recorded times, with their results
//     and the state they changed;
//   the browser: how the answer's stream arrived and painted.
//
// The drawer's header stays in view whatever the body shows: the way back to Metrics, the question
// the run answered, its model and state, and the raw JSON. So a run that cannot be read (gone, or
// the hub is off) still says which run it was and has the way back and a Try again, rather than a
// lone red banner where the page was. Wide tables scroll in their own box, never the drawer.

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

// The run's time as one bar of parts, in the waterfall's colours for the same kinds of time
// (styles/workshop.css), with a legend that names each part, its time and its share.
function TimeBudget({ spans, wall }: { spans: Span[]; wall: number }) {
  const parts = budget(spans, wall);
  const total = parts.reduce((a, b) => a + b.ms, 0) || 1;
  return (
    <div className="budget">
      <div className="budget-bar" aria-hidden="true">
        {parts.map((p) => (
          <span key={p.key} className={`budget-${p.key}`} style={{ width: `${(100 * p.ms) / total}%` }}
                title={`${BUDGET_LABEL[p.key]}: ${dur(p.ms)}`} />
        ))}
      </div>
      <ul className="budget-legend">
        {parts.map((p) => (
          <li key={p.key}><i className={`budget-key budget-${p.key}`} aria-hidden="true" />{BUDGET_LABEL[p.key]}{' '}
            <span className="figures">{dur(p.ms)}</span>{' '}
            <span className="muted figures">({Math.round((100 * p.ms) / total)}%)</span></li>
        ))}
      </ul>
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
          <th>Step</th><th className="num">Tool calls</th><th className="num">Prompt tokens</th><th className="num">New (est.)</th>
          <th className="num">Cached</th><th className="num">Reading</th><th className="num">Read tok/s</th>
          <th className="num">Output tokens</th><th className="num">Writing</th><th className="num">Write tok/s</th>
          <th className="num">Queued</th><th className="num">First token</th><th className="num">Total</th><th className="num">Cost</th>
          <th><span className="sr-only">Text</span></th>
        </tr></thead>
        <tbody>
          {steps.map((s, i) => {
            const a = s.attrs;
            const text = typeof a.text === 'string' ? a.text : '';
            const reasoning = typeof a.reasoning === 'string' ? a.reasoning : '';
            const key = `${s.id}-${i}`;
            return [
              <tr key={key}>
                <td>{String(a.step ?? '')}</td><td className="num">{fmtN(a.tool_calls)}</td>
                <td className="num">{fmtN(a.prompt_tokens)}</td><td className="num">{fmtN(a.new_tokens_est)}</td>
                <td className="num">{pct(a.cached_share)}</td>
                <td className="num">{dur(num(a.prompt_s) * 1000 || null)}</td><td className="num">{fmtN(a.read_tok_s, 1)}</td>
                <td className="num">{fmtN(a.output_tokens)}</td><td className="num">{dur(num(a.gen_s) * 1000 || null)}</td>
                <td className="num">{fmtN(a.write_tok_s, 1)}</td>
                <td className="num">{dur(modelSegments(a).find((x) => x.kind === 'queued')?.ms ?? null)}</td>
                <td className="num">{dur(typeof a.first_token_ms === 'number' ? a.first_token_ms : null)}</td>
                <td className="num">{dur(s.duration_ms)}</td><td className="num">{money(a.cost_usd)}</td>
                <td>{(text || reasoning) && (
                  <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open === key}
                          onClick={() => setOpen(open === key ? null : key)}>
                    {open === key ? 'Hide' : 'Text'}
                  </button>
                )}</td>
              </tr>,
              open === key && (
                <tr key={`${key}-open`}><td colSpan={15}>
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
        <strong>ContextForge</strong> <code>{g.name}</code> · HTTP {g.http_status} · {g.status} · <span className="figures">{dur(g.duration_ms ?? null)}</span>
        <span className="muted"> trace {g.trace_id}</span>
      </div>
      <div className="table-wrap">
        <table className="metrics-table compact">
          <thead><tr><th>Span</th><th className="num">At</th><th className="num">Took</th><th>Status</th><th>Attributes</th></tr></thead>
          <tbody>
            {(g.spans ?? []).map((s, i) => (
              <tr key={i}>
                <td>{s.name}</td><td className="num">{dur(s.start_ms)}</td><td className="num">{dur(s.duration_ms)}</td><td>{s.status}</td>
                <td className="msg"><code>{Object.entries(s.attributes).map(([k, v]) => `${k}=${String(v)}`).join(' · ')}</code></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BurrCard({ b, toolStart }: { b: BurrRun; toolStart: number }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="run-card">
      <div className="run-card-head">
        <strong>pantry (Burr)</strong> <code>{b.app_id}</code>{' '}
        <a href={b.ui_url} target="_blank" rel="noreferrer">open in the Burr UI<Icon name="external" className="ico-inline ico-end" /> <span className="sr-only">(opens in a new tab)</span></a>
      </div>
      {b.note && <p className="muted">{b.note}</p>}
      {b.steps.length > 0 && (
        <div className="table-wrap">
          <table className="metrics-table compact">
            <thead><tr><th>Action</th><th className="num">At (in the call)</th><th className="num">Took</th><th>Result</th><th>State it changed</th><th><span className="sr-only">State</span></th></tr></thead>
            <tbody>
              {b.steps.map((s) => [
                <tr key={s.sequence_id} className={s.exception ? 'row-bad' : ''}>
                  <td>{s.action}</td>
                  <td className="num">{s.start_ms == null ? '–' : dur(s.start_ms - toolStart)}</td>
                  <td className="num">{dur(s.ms)}</td>
                  <td className="msg"><code>{s.exception ?? (typeof s.result === 'string' ? s.result : JSON.stringify(s.result))}</code></td>
                  <td>{Object.keys(s.changed).join(', ') || '–'}</td>
                  <td>{Object.keys(s.changed).length > 0 && (
                    <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open === s.sequence_id}
                            onClick={() => setOpen(open === s.sequence_id ? null : s.sequence_id)}>
                      {open === s.sequence_id ? 'Hide' : 'State'}
                    </button>
                  )}</td>
                </tr>,
                open === s.sequence_id && (
                  <tr key={`${s.sequence_id}-state`}><td colSpan={6}><pre className="run-pre">{json(s.changed)}</pre></td></tr>
                ),
              ])}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ToolCalls({ detail }: { detail: RunDetail }) {
  const tools = detail.trace.spans.filter((s) => s.kind === 'tool').sort((a, b) => a.start_ms - b.start_ms);
  if (!tools.length) return <p className="muted">No tool calls.</p>;
  return (
    <>
      {tools.map((t, i) => {
        const a = t.attrs;
        const gateway = detail.gateway.find((g) => g.tool_span === t.id);
        const burr = detail.burr.find((b) => b.tool_span === t.id);
        return (
          <div key={`${t.id}-${i}`} className="run-tool">
            <div className="run-card-head">
              <strong>{String(a.tool ?? t.name)}</strong>{' '}
              {t.status !== 'ok' && <StateTag state={{ kind: 'attention', word: t.status }} />}{' '}
              <span className="muted figures">
                at {dur(t.start_ms)} · {dur(t.duration_ms)} in the hub · MCP {dur(typeof a.mcp_ms === 'number' ? a.mcp_ms : null)}
                {typeof a.gateway_overhead_ms === 'number' && <> · ContextForge overhead {dur(a.gateway_overhead_ms)}</>}
                {' '}· result {fmtN(a.result_chars)} chars, the model read {fmtN(a.model_chars)}
              </span>
            </div>
            <details><summary>Arguments</summary><pre className="run-pre">{json(a.arguments)}</pre></details>
            {typeof a.preview === 'string' && (
              <details><summary>Result preview</summary><pre className="run-pre">{a.preview}</pre></details>
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
    <div className="table-wrap">
      <table className="metrics-table compact">
        <thead><tr><th className="num">At</th><th>Where</th><th>What</th><th>Detail</th></tr></thead>
        <tbody>
          {events.map((e, i) => {
            const a = e.attrs as Record<string, unknown>;
            const added = Array.isArray(a.added) ? (a.added as string[]) : [];
            return (
              <tr key={i}>
                <td className="num">{dur(e.at_ms)}</td><td>{e.where}</td>
                <td>{e.name === 'observation' ? `${String(a.observer)}.${String(a.condition)}` : e.name}</td>
                <td className="msg">{a.value === false ? 'did not fire' : ''}
                  {added.length > 0 && <>added {added.join(', ')}</>}
                  {typeof a.text === 'string' && a.text}{typeof a.reason === 'string' && ` (${a.reason})`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="run-sec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

// What the drawer's body shows once the run is read.
function RunBody({ detail }: { detail: RunDetail }) {
  const t = detail.trace;
  const answer = useMemo(() => {
    const steps = t.spans.filter((s) => s.kind === 'model' && typeof s.attrs.text === 'string');
    return steps.length ? String(steps[steps.length - 1].attrs.text) : '';
  }, [t]);
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
    <div className="run-body">
      <dl className="kpis">
        {kpis.map(([k, v]) => <div key={k} className="kpi"><dt className="kpi-k">{k}</dt><dd className="kpi-v">{v}</dd></div>)}
      </dl>
      <Section title="Where the time went">
        <TimeBudget spans={t.spans} wall={num(t.wall_ms)} />
        <p className="muted">
          Sources: the hub's trace{detail.gateway.length > 0 && ', ContextForge (each tool call\'s gateway trace)'}
          {detail.burr.length > 0 && ', pantry\'s Burr tracker (each plan call\'s steps, at their recorded times)'}
          {t.browser && ', the browser'}.
        </p>
      </Section>
      <Section title="Timeline">
        <Waterfall trace={t} />
      </Section>
      <Section title="Model steps">
        <ModelSteps spans={t.spans} />
      </Section>
      <Section title="Tool calls: the hub, ContextForge and pantry">
        <ToolCalls detail={detail} />
      </Section>
      <div className="grid-2">
        <Section title="Evals and confidence">
          {t.evals ? <EvalCard evals={t.evals} /> : <p className="muted">Not evaluated.</p>}
        </Section>
        <Section title="Observers and tools offered">
          <Disclosure spans={t.spans} />
        </Section>
      </div>
      {t.browser && (
        <Section title="Browser">
          <dl className="kpis">
            {Object.entries(t.browser).filter(([k]) => k.endsWith('_ms') || k === 'events').map(([k, v]) => (
              <div key={k} className="kpi"><dt className="kpi-k">{k.replace(/_ms$/, '').replace(/_/g, ' ')}</dt>
                <dd className="kpi-v">{k.endsWith('_ms') ? dur(v as number) : String(v)}</dd></div>
            ))}
          </dl>
        </Section>
      )}
      {answer && (
        <Section title="The answer">
          <div className="run-text"><Markdown text={answer} /></div>
        </Section>
      )}
    </div>
  );
}

// `id`: the run to show, or null for none (the drawer closes). `returnFocus`: where the keyboard
// goes when it closes, for a drawer opened by an address rather than from a row.
export function RunDrawer({ id, onClose, returnFocus }: {
  id: string | null;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const hub = useHubStatus();
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  // Read when it opens (or opens on another run); closed, it keeps what it showed while it slides
  // out. An answer for a run since closed or replaced never lands.
  useEffect(() => {
    if (!id) return undefined;
    let alive = true;
    setDetail((d) => (d?.trace.id === id ? d : null));
    setError('');
    runDetail(id).then((d) => { if (alive) setDetail(d); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [id, attempt]);

  const shown = detail && detail.trace.id === id ? detail : null;
  const t = shown?.trace;
  const hubOff = hub.state === 'refused' || hub.state === 'unreachable';
  const description = t ? (
    <>
      <span className="run-head-q">“{t.message}”</span>
      <span className="run-head-meta">
        <StateTag state={runStatus(t.status)} />
        <span><code>{t.model}</code> · {t.target} · {t.disclosure} toolset · {new Date(t.started_at).toLocaleString()}</span>
      </span>
    </>
  ) : id ? <span className="run-head-meta"><code>{id}</code></span> : null;

  return (
    <Sheet variant="drawer" open={id != null} onClose={onClose} returnFocus={returnFocus}
           closeLabel="Back to Metrics" title="Run details" description={description} className="run-drawer"
           actions={id && !error ? (
             <a className="btn btn-ghost btn-sm" href={`/hub/runs/${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">
               JSON<Icon name="external" size={16} /><span className="sr-only"> (opens in a new tab)</span>
             </a>
           ) : undefined}>
      {error ? (
        <Notice tone={hubOff ? 'warn' : 'danger'} title="This run could not be read"
                hint={hubOff ? 'The demo hub keeps the runs, and it is not answering now.'
                  : 'The hub keeps the last 500 runs: an older one, or one from another hub, is not there.'}
                actions={[{ label: 'Try again', icon: 'refresh', onClick: () => setAttempt((n) => n + 1) },
                  { label: 'Back to Metrics', icon: 'arrow-left', onClick: onClose }]}>
          {error}
        </Notice>
      ) : shown ? <RunBody detail={shown} /> : <Skeleton kind="row" count={8} label="Loading the run" />}
    </Sheet>
  );
}
