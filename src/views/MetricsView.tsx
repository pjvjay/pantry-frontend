import { useCallback, useEffect, useState } from 'react';
import { ErrorBanner } from '../components/common';
import { dur } from '../components/flow';
import { getMetrics, traceList } from '../hub';
import type { Metrics, MetricsRow, TraceSummary } from '../types';
import RunView from './RunView';

// Every layer of the Assistant's workflow, measured: the models (tokens, cache, rates, time to
// first token, cost), the MCP tools and the gateway's overhead, pantry's own pipeline steps, the
// observers, the online evals, the browser (web vitals, API calls, the chat stream) and the hub's
// HTTP routes, rolled up from recent turns; and each turn's trace as a waterfall.

const fmt = (key: string, v: unknown): string => {
  if (v == null) return '–';
  if (typeof v !== 'number') return String(v);
  if (key.endsWith('_ms')) return dur(v);
  if (key.endsWith('share') || key === 'answer_confidence' || key === 'pass_share') return `${Math.round(v * 100)}%`;
  if (key.endsWith('usd')) return v === 0 ? '$0' : `$${v < 0.01 ? v.toFixed(5) : v.toFixed(3)}`;
  if (key.endsWith('tok_s')) return v.toFixed(1);
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
};

const LABELS: Record<string, string> = {
  turn_p50_ms: 'turn p50', turn_p95_ms: 'turn p95', step_p50_ms: 'step p50', step_p95_ms: 'step p95',
  ttft_p50_ms: 'first token p50', queued_p95_ms: 'queued p95', read_tok_s: 'read tok/s', write_tok_s: 'write tok/s',
  cached_share: 'cached', prompt_tokens_p50: 'prompt tokens p50', tokens_in_per_turn: 'in/turn',
  tokens_out_per_turn: 'out/turn', cost_per_turn_usd: 'cost/turn (paid)', answered_share: 'answered',
  answer_confidence: 'confidence', steps_per_turn: 'steps/turn', gateway_overhead_p50_ms: 'gateway overhead',
  result_chars_p50: 'result chars', model_chars_p50: 'chars to model', error_share: 'errors',
  pass_share: 'pass', server_p50_ms: 'hub time p50',
};

function Table({ rows, keys }: { rows: MetricsRow[]; keys?: string[] }) {
  if (rows.length === 0) return <p className="muted">Nothing measured yet.</p>;
  const cols = keys ?? Object.keys(rows[0]);
  return (
    <div className="table-wrap">
      <table className="metrics-table">
        <thead><tr>{cols.map((k) => <th key={k}>{LABELS[k] ?? k.replace(/_/g, ' ')}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((k) => <td key={k}>{fmt(k, r[k])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MetricsView() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<string | null>(
    () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('trace'));

  const load = useCallback(() => {
    Promise.all([getMetrics(), traceList(50)])
      .then(([m, t]) => { setMetrics(m); setTraces(t); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const close = () => { setOpen(null); window.location.hash = '#/metrics'; };
  if (open) return <div className="view"><RunView id={open} onClose={close} /></div>;

  const b = metrics?.browser;
  return (
    <div className="view">
      <section className="panel">
        <div className="plan-header">
          <h2>Metrics</h2>
          <button type="button" className="secondary" onClick={load}>Refresh</button>
        </div>
        <p className="card-sub">
          Every layer of the Assistant's workflow, rolled up from the last {metrics?.traces ?? 0} turn(s):
          the models, the MCP tools and the ContextForge gateway, pantry's own steps, the observers, the
          online evals of each answer, the browser and the hub. Answer confidence is the share of an
          answer's checks that passed (mean {fmt('answer_confidence', metrics?.answer_confidence_mean)}).
        </p>
      </section>
      <ErrorBanner error={error} />
      {/* everything below arrives at once: sections filling in one by one moved the ones under
          them (a layout shift of 0.22 on this page) */}
      {!loaded && <p className="muted">Loading metrics…</p>}
      {metrics && (
        <>
          <section className="panel">
            <h3>Models</h3>
            <Table rows={metrics.models} keys={['model', 'turns', 'answered_share', 'answer_confidence',
              'turn_p50_ms', 'turn_p95_ms', 'steps_per_turn', 'step_p50_ms', 'ttft_p50_ms', 'queued_p95_ms',
              'read_tok_s', 'write_tok_s', 'cached_share', 'prompt_tokens_p50', 'tokens_in_per_turn',
              'tokens_out_per_turn', 'cost_per_turn_usd']} />
            <p className="muted">
              Cost is what the turn's tokens would cost on a paid key (local models: $0; Gemini's free tier
              bills nothing but allows {metrics.free_tier_requests_per_day} requests per model per day).
              Prices: <a href={metrics.prices_source.split(' ')[0]} target="_blank" rel="noreferrer">{metrics.prices_source}</a>
            </p>
          </section>
          <section className="panel">
            <h3>MCP tools and the gateway</h3>
            <Table rows={metrics.tools} />
          </section>
          <section className="panel">
            <h3>Online evals</h3>
            <Table rows={metrics.evals} />
          </section>
          <div className="grid-2">
            <section className="panel">
              <h3>pantry pipeline steps</h3>
              <Table rows={metrics.pantry_steps} />
            </section>
            <section className="panel">
              <h3>Observers that fired</h3>
              <Table rows={metrics.observers} />
            </section>
          </div>
          <section className="panel">
            <h3>Browser</h3>
            {b && (
              <p className="card-sub">
                page loads {String(b.page_loads)}: first byte p50 {fmt('_ms', b.page_ttfb_p50_ms)}, LCP p50 {fmt('_ms', b.lcp_p50_ms)},
                INP p95 {fmt('_ms', b.inp_p95_ms)}, CLS max {fmt('x', b.cls_max)}, long tasks {String(b.long_tasks)} ·
                chat turns {String(b.chat_turns)}: first byte p50 {fmt('_ms', b.ttfb_p50_ms)}, first event p50{' '}
                {fmt('_ms', b.first_event_p50_ms)}, stream lag p95 {fmt('_ms', b.stream_lag_p95_ms)}, render p95{' '}
                {fmt('_ms', b.render_p95_ms)}
              </p>
            )}
            {Array.isArray(b?.cls_sources) && (b.cls_sources as MetricsRow[]).length > 0 && (
              <>
                <p className="muted">What moved (layout shift by element, worst first):</p>
                <Table rows={b.cls_sources as MetricsRow[]} />
              </>
            )}
            <Table rows={b?.api ?? []} />
          </section>
          <section className="panel">
            <h3>Hub HTTP</h3>
            <Table rows={metrics.hub_http} />
          </section>
        </>
      )}
      {loaded && <section className="panel">
        <h3>Recent turns</h3>
        {traces.length === 0 ? <p className="muted">No Assistant turns yet.</p> : (
          <div className="table-wrap">
            <table className="metrics-table">
              <thead><tr><th>when</th><th>model</th><th>toolset</th><th>message</th><th>status</th>
                <th>time</th><th>steps</th><th>tokens in/out</th><th>confidence</th><th /></tr></thead>
              <tbody>
                {traces.map((t) => (
                  <tr key={t.id}>
                    <td>{new Date(t.started_at).toLocaleTimeString()}</td>
                    <td><code>{t.model}</code></td>
                    <td>{t.disclosure}</td>
                    <td className="msg">{t.message}</td>
                    <td>{t.status}</td>
                    <td>{dur(t.wall_ms)}</td>
                    <td>{t.steps}</td>
                    <td>{(t.input_tokens ?? 0).toLocaleString()} / {(t.output_tokens ?? 0).toLocaleString()}</td>
                    <td>{fmt('answer_confidence', t.answer_confidence)}</td>
                    <td><button type="button" className="secondary" onClick={() => { setOpen(t.id); window.location.hash = `#/metrics?trace=${t.id}`; }}>run</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>}
    </div>
  );
}
