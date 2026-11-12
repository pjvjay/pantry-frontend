import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { StateTag } from '../components/evidence';
import { dur } from '../components/flow';
import { Icon } from '../components/icons';
import { HubErrorBanner, ScrollRegion, Skeleton, StatRow, StatTile } from '../components/ui';
import { useRowNav } from '../components/useRowNav';
import { getMetrics, traceList } from '../hub';
import { hrefFor } from '../routes';
import type { Metrics, MetricsRow, TraceSummary } from '../types';
import { figureColumns, newestFirst, runStatus, traceOf, whenText } from '../workshop';
import { RunDrawer } from './RunView';

// Every layer of the Assistant's workflow, measured: the models (tokens, cache, rates, time to
// first token, cost), the MCP tools and the gateway's overhead, pantry's own pipeline steps, the
// observers, the online evals, the browser (web vitals, API calls, the chat stream) and the hub's
// HTTP routes, rolled up from recent turns; and each turn's trace as a waterfall.
//
// The recent turns come first, newest first by when each began (workshop.ts newestFirst), as a grid
// of rows the keyboard walks (components/useRowNav.ts): Enter opens the run in a drawer over this
// page (RunView.tsx). On a phone the grid keeps the question, its state and its time, with when it
// was asked under the question; the model, the steps, the tokens and the confidence are in the
// run's drawer. The drawer is in the address
// (#/workshop/metrics?trace=<id>), so a run can be linked to (the Assistant's "Run details" does)
// and the browser's Back closes it. Closed by its own way back, a drawer this page opened takes its
// history entry with it (history.back()), so Back afterwards leaves Metrics; the entry is marked as
// this page's in the history's own state, so that holds after Back and Forward through it too. One
// that came in by its address is replaced by Metrics' own address instead, so Back still goes where
// the shopper came from. Figures sit right-aligned in equal widths; a long or wide table scrolls in
// its own box (ScrollRegion: a stop for the keyboard while it does), a long one under a head that
// stays.

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

// Past this many rows a table scrolls in its own box, its head kept in view.
const TALL = 12;

function Table({ rows, keys, label }: { rows: MetricsRow[]; keys?: string[]; label: string }) {
  if (rows.length === 0) return <p className="muted">Nothing measured yet.</p>;
  const cols = keys ?? Object.keys(rows[0]);
  const figures = figureColumns(rows, cols);
  const tall = rows.length > TALL;
  return (
    <ScrollRegion label={label} className={tall ? 'table-scroll ws-tall' : 'table-scroll'}>
      <table className={tall ? 'table table-sticky' : 'table'} aria-label={label}>
        <thead>
          <tr>{cols.map((k) => <th key={k} className={figures.has(k) ? 'num' : undefined}>{LABELS[k] ?? k.replace(/_/g, ' ')}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{cols.map((k) => <td key={k} className={figures.has(k) ? 'num' : undefined}>{fmt(k, r[k])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

// "Wed 11 Nov, 10:54 AM" on two lines, the day over the time, so the column stays narrow.
function When({ at }: { at: string }) {
  const [day, time] = whenText(at).split(', ');
  return <><span className="turns-day">{day}</span>{time && <span className="turns-time">{time}</span>}</>;
}

function RecentTurns({ traces, onOpen, open, rowsOut }: {
  traces: TraceSummary[];
  onOpen: (id: string) => void;
  open: string | null;
  // the row of a run, for the drawer to give focus back to
  rowsOut: RefObject<(id: string) => HTMLTableRowElement | null>;
}) {
  const ids = useMemo(() => traces.map((t) => t.id), [traces]);
  const grid = useRowNav(ids, { onOpen, chosen: open });
  const hint = useId();
  (rowsOut as { current: (id: string) => HTMLTableRowElement | null }).current = grid.rowElement;
  if (traces.length === 0) {
    return <p className="muted">No Assistant turns yet. Ask a question under Ask, and its run shows here.</p>;
  }
  return (
    // the rows are the keyboard's way in and out (one Tab stop), so the box needs no stop of its own
    <div className="table-scroll ws-tall">
      <p id={hint} className="sr-only">Up and Down move along the runs; Enter opens one.</p>
      <table className="table table-sticky ws-grid turns" role="grid" aria-label="Recent turns" aria-describedby={hint}>
        <thead>
          <tr>
            <th className="col-wide">When</th><th>Question</th><th className="col-wide">Model and toolset</th><th>Status</th>
            <th className="num">Time</th><th className="num col-wide">Steps</th>
            <th className="num col-wide">Tokens in / out</th><th className="num col-wide">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {traces.map((t) => (
            <tr key={t.id} {...grid.rowProps(t.id)} className={open === t.id ? 'row-active' : undefined}>
              <td className="col-wide"><When at={t.started_at} /></td>
              <td className="turns-q">
                <span className="turns-q-text">{t.message}</span>
                <span className="turns-when">{whenText(t.started_at)}</span>
              </td>
              <td className="col-wide turns-model"><code>{t.model}</code><span className="muted">{t.disclosure} toolset</span></td>
              <td><StateTag state={runStatus(t.status)} /></td>
              <td className="num">{dur(t.wall_ms)}</td>
              <td className="num col-wide">{t.steps}</td>
              <td className="num col-wide">{(t.input_tokens ?? 0).toLocaleString()} / {(t.output_tokens ?? 0).toLocaleString()}</td>
              <td className="num col-wide">{fmt('answer_confidence', t.answer_confidence)}</td>
            </tr>
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
  const turnsId = useId();

  // The run open in the drawer: the address's, kept in step with it (a "Run details" link, Back
  // and Forward all change the hash on this page).
  const [open, setOpen] = useState<string | null>(() => traceOf(window.location.hash));
  // the run this page is opening, pushing an entry onto the history; once there, the entry is
  // marked ({ trace }) in the history's state, which the browser keeps with it through Back and
  // Forward (and a reload)
  const pushed = useRef<string | null>(null);
  const leaving = useRef(false);
  useEffect(() => {
    const onHash = () => {
      const id = traceOf(window.location.hash);
      if (id !== null && id === pushed.current) {
        const now: unknown = window.history.state;
        window.history.replaceState({ ...(typeof now === 'object' && now !== null ? now : {}), trace: id }, '');
      }
      pushed.current = null;
      leaving.current = false;
      setOpen(id);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openRun = (id: string) => {
    if (open === id) return;
    pushed.current = id;
    window.location.hash = hrefFor({ name: 'workshop', tab: 'metrics', query: `trace=${encodeURIComponent(id)}` });
  };
  const close = () => {
    if (!open || leaving.current) return;
    leaving.current = true;
    if ((window.history.state as { trace?: unknown } | null)?.trace === open) {
      // this page's own entry: the hashchange that follows closes the drawer
      window.history.back();
    } else {
      window.history.replaceState(window.history.state, '', hrefFor({ name: 'workshop', tab: 'metrics' }));
      leaving.current = false;
      setOpen(null);
    }
  };

  // Where the keyboard goes when the drawer closes: the row of the run it showed, else the list's
  // heading (a run opened by its address, with the list not drawn yet or the run not in it).
  const lastOpen = useRef(open);
  if (open) lastOpen.current = open;
  const rowOf = useRef<(id: string) => HTMLTableRowElement | null>(() => null);
  const heading = useRef<HTMLHeadingElement>(null);
  const backTo = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() {
      const row = lastOpen.current ? rowOf.current(lastOpen.current) : null;
      return row ?? heading.current;
    },
  }), []);

  const load = useCallback(() => {
    Promise.all([getMetrics(), traceList(50)])
      .then(([m, t]) => { setMetrics(m); setTraces(newestFirst(t)); setError(''); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const b = metrics?.browser;
  return (
    <div className="view ws-stack">
      <section className="card">
        <div className="card-head">
          <h2 className="card-title">Metrics</h2>
          <button type="button" className="btn btn-secondary btn-sm" onClick={load}>
            <Icon name="refresh" size={16} />Refresh
          </button>
        </div>
        <p className="card-sub">
          Every layer of the Assistant's workflow, rolled up from{' '}
          {metrics ? <>the last {metrics.traces} {metrics.traces === 1 ? 'turn' : 'turns'}</> : 'its recent turns'}:
          the models, the MCP tools and the ContextForge gateway, pantry's own steps, the observers, the
          online evals of each answer, the browser and the hub. Answer confidence is the share of an
          answer's checks that passed{metrics?.answer_confidence_mean != null
            && <> (mean {fmt('answer_confidence', metrics.answer_confidence_mean)})</>}.
        </p>
      </section>
      <HubErrorBanner error={error} />
      {/* everything below arrives at once: sections filling in one by one moved the ones under
          them (a layout shift of 0.22 on this page) */}
      {!loaded && <section className="card"><Skeleton kind="row" count={8} label="Loading metrics" /></section>}
      {loaded && !error && (
        <section className="card" aria-labelledby={turnsId}>
          <h3 id={turnsId} ref={heading} tabIndex={-1} className="card-title metrics-turns-h">Recent turns</h3>
          <p className="card-sub">Each Assistant run, newest first. Open one for its timeline, steps, tool calls and checks.</p>
          <RecentTurns traces={traces} onOpen={openRun} open={open} rowsOut={rowOf} />
        </section>
      )}
      {metrics && (
        <>
          <section className="card">
            <h3 className="card-title">Models</h3>
            <Table label="Models" rows={metrics.models} keys={['model', 'turns', 'answered_share', 'answer_confidence',
              'turn_p50_ms', 'turn_p95_ms', 'steps_per_turn', 'step_p50_ms', 'ttft_p50_ms', 'queued_p95_ms',
              'read_tok_s', 'write_tok_s', 'cached_share', 'prompt_tokens_p50', 'tokens_in_per_turn',
              'tokens_out_per_turn', 'cost_per_turn_usd']} />
            <p className="muted">
              Cost is what the turn's tokens would cost on a paid key (local models: $0; Gemini's free tier
              bills nothing but allows {metrics.free_tier_requests_per_day} requests per model per day).
              Prices: <a href={metrics.prices_source.split(' ')[0]} target="_blank" rel="noreferrer">{metrics.prices_source}</a>
            </p>
          </section>
          <section className="card">
            <h3 className="card-title">MCP tools and the gateway</h3>
            <Table label="MCP tools and the gateway" rows={metrics.tools} />
          </section>
          <section className="card">
            <h3 className="card-title">Online evals</h3>
            <Table label="Online evals" rows={metrics.evals} />
          </section>
          <div className="grid-2">
            <section className="card">
              <h3 className="card-title">pantry pipeline steps</h3>
              <Table label="pantry pipeline steps" rows={metrics.pantry_steps} />
            </section>
            <section className="card">
              <h3 className="card-title">Observers that fired</h3>
              <Table label="Observers that fired" rows={metrics.observers} />
            </section>
          </div>
          <section className="card">
            <h3 className="card-title">Browser</h3>
            {b && (
              <>
                <p className="card-sub">Page loads, then the Assistant's chat turns, as this browser measured them.</p>
                <StatRow className="metrics-browser">
                  <StatTile label="Page loads" value={fmt('n', b.page_loads)} />
                  <StatTile label="First byte p50" value={fmt('_ms', b.page_ttfb_p50_ms)} />
                  <StatTile label="LCP p50" value={fmt('_ms', b.lcp_p50_ms)} />
                  <StatTile label="INP p95" value={fmt('_ms', b.inp_p95_ms)} />
                  <StatTile label="CLS max" value={fmt('x', b.cls_max)} />
                  <StatTile label="Long tasks" value={fmt('n', b.long_tasks)} />
                  <StatTile label="Chat turns" value={fmt('n', b.chat_turns)} />
                  <StatTile label="Chat first byte p50" value={fmt('_ms', b.ttfb_p50_ms)} />
                  <StatTile label="First event p50" value={fmt('_ms', b.first_event_p50_ms)} />
                  <StatTile label="Stream lag p95" value={fmt('_ms', b.stream_lag_p95_ms)} />
                  <StatTile label="Render p95" value={fmt('_ms', b.render_p95_ms)} />
                </StatRow>
              </>
            )}
            {Array.isArray(b?.cls_sources) && (b.cls_sources as MetricsRow[]).length > 0 && (
              <>
                <p className="muted">What moved (layout shift by element, worst first):</p>
                <Table label="What moved" rows={b.cls_sources as MetricsRow[]} />
              </>
            )}
            <Table label="The browser's API calls" rows={b?.api ?? []} />
          </section>
          <section className="card">
            <h3 className="card-title">Hub HTTP</h3>
            <Table label="Hub HTTP" rows={metrics.hub_http} />
          </section>
        </>
      )}
      <RunDrawer id={open} onClose={close} returnFocus={backTo} />
    </div>
  );
}
