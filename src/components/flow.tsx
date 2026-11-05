// The agentic flow made visible: an ingredient's photo, a recipe page's images,
// a step's reasoning, the answer's evals and confidence, and a turn's trace as a waterfall of
// spans from every layer (browser, model, tools, gateway, pantry's own steps and LLM calls).
import { useState } from 'react';
import { ingredientImage, remoteImage } from '../hub';
import type { Evals, PlanConfidence, Span, Trace } from '../types';

const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
export const dur = (ms: number | null | undefined) => {
  if (ms == null) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const s = Math.round(ms / 1000);              // round once, so 119.6 s is 2m 0s, not 1m 60s
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};

// An ingredient's photo (Wikipedia, cached by the hub); a plain tile when there is none.
export function IngredientImage({ name, size = 56 }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="ing-img ing-img-none" style={{ width: size, height: size }}>{name.slice(0, 1)}</span>;
  return (
    <img className="ing-img" src={ingredientImage(name)} alt={name} width={size} height={size}
         loading="lazy" onError={() => setFailed(true)} />
  );
}

const IMG_URL = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s"'<>)]+\.(?:jpe?g|png|webp|avif)(?:\?[^\s"'<>)]*)?)/gi;
const NOT_A_PHOTO = /logo|icon|avatar|sprite|pixel|badge|button|emoji|gravatar|spinner|\.svg|\.gif/i;

// The photos a fetched page holds (markdown images and image links), logos and icons left out.
export function imagesIn(text: string, limit = 6): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(IMG_URL)) {
    const url = m[1] ?? m[2];
    if (url && !NOT_A_PHOTO.test(url) && !seen.includes(url)) seen.push(url);
    if (seen.length >= limit) break;
  }
  return seen;
}

export function RecipeImages({ urls }: { urls: string[] }) {
  const [broken, setBroken] = useState<string[]>([]);
  const shown = urls.filter((u) => !broken.includes(u));
  if (shown.length === 0) return null;
  return (
    <div className="recipe-images">
      <span className="muted">from the page:</span>
      {shown.map((u) => (
        <img key={u} src={remoteImage(u)} alt="" loading="lazy" referrerPolicy="no-referrer"
             onError={() => setBroken((b) => [...b, u])} />
      ))}
    </div>
  );
}

export function Reasoning({ text, label = 'reasoning' }: { text: string; label?: string }) {
  return (
    <details className="reasoning">
      <summary>{label} · {text.length.toLocaleString()} chars</summary>
      <pre>{text}</pre>
    </details>
  );
}

function ConfidenceBadge({ value, label }: { value: number | null; label: string }) {
  const tone = value == null ? 'muted' : value >= 0.9 ? 'ok' : value >= 0.6 ? 'warn' : 'bad';
  return <span className={`conf-badge conf-${tone}`}>{label} {pct(value)}</span>;
}

function PlanConfidenceLine({ plan }: { plan: PlanConfidence }) {
  return (
    <div className="muted">
      plan: {plan.lines} line(s), line confidence min {pct(plan.min_line_confidence)} · mean {pct(plan.mean_line_confidence)},
      exact matches {pct(plan.exact_share)}
      {plan.origin_spend_verified != null && <>, origin verified for {pct(plan.origin_spend_verified)} of spend</>}
      {plan.left_out > 0 && <>, {plan.left_out} ingredient(s) left out</>}
    </div>
  );
}

// The answer's online evals: each check against this turn's own tool results.
export function EvalCard({ evals, traceId }: { evals: Evals; traceId?: string }) {
  return (
    <div className="eval-card">
      <div className="eval-head">
        <ConfidenceBadge value={evals.answer_confidence} label="answer confidence" />
        <span className="muted">{evals.passed} of {evals.total} checks passed</span>
        {traceId && <a href={`#/metrics?trace=${traceId}`} title="Everything recorded about this run, from every system">run details ↗</a>}
      </div>
      <div className="eval-checks">
        {evals.checks.map((c) => (
          <span key={c.name} className={`eval-check ${c.passed ? 'eval-pass' : 'eval-fail'}`}
                title={c.detail || (c.passed ? 'passed' : 'failed')}>
            {c.passed ? '✓' : '✗'} {c.name.replace(/_/g, ' ')}
          </span>
        ))}
      </div>
      {evals.checks.filter((c) => !c.passed && c.detail).map((c) => (
        <div key={c.name} className="eval-detail">{c.name.replace(/_/g, ' ')}: {c.detail}</div>
      ))}
      {evals.plan && <PlanConfidenceLine plan={evals.plan} />}
    </div>
  );
}

const KIND_LABEL: Record<Span['kind'], string> = {
  turn: 'turn', observers: 'observers', model: 'model', tool: 'MCP tool', gateway: 'gateway',
  'gateway.tool': 'gateway', 'pantry.step': 'pantry', 'pantry.llm': 'pantry LLM', browser: 'browser',
};

// A model step's time split the way Ollama reports it: waiting behind another request, loading,
// reading the prompt, writing the answer. Cloud models report none of it (the bar stays whole).
export function modelSegments(a: Record<string, unknown>): { kind: string; ms: number }[] {
  const n = (k: string) => (typeof a[k] === 'number' ? (a[k] as number) * 1000 : 0);
  const wall = n('wall_s');
  const [load, read, write] = [n('load_s'), n('prompt_s'), n('gen_s')];
  if (!wall || !(read || write)) return [];
  const queued = typeof a.queued_ms === 'number' ? a.queued_ms : Math.max(wall - load - read - write, 0);
  return [{ kind: 'queued', ms: queued }, { kind: 'load', ms: load }, { kind: 'read', ms: read },
    { kind: 'write', ms: write }].filter((x) => x.ms > 0);
}

// A turn's spans as a waterfall: each bar where it started and how long it took, nested by
// parent. Click a row for its attributes, events and the model's reasoning, and zoom into it:
// a 0.6 s tool call inside a 7-minute turn is a sliver until you do.
export function Waterfall({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState<string | null>(null);
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const total = Math.max(...trace.spans.map((s) => s.end_ms ?? s.start_ms), 1);
  const [from, to] = zoom ?? [0, total];
  const width = Math.max(to - from, 1);
  const depth = (s: Span): number => {
    let d = 0;
    let p = s.parent;
    while (p) {
      d += 1;
      p = trace.spans.find((x) => x.id === p)?.parent ?? null;
    }
    return d;
  };
  const order: Span[] = [];
  const visit = (parent: string | null) => {
    trace.spans.filter((s) => s.parent === parent).sort((a, b) => a.start_ms - b.start_ms)
      .forEach((s) => { order.push(s); visit(s.id); });
  };
  visit(null);
  const shown = order.filter((s) => (s.end_ms ?? s.start_ms) >= from && s.start_ms <= to);
  const zoomTo = (s: Span) => {
    const end = s.end_ms ?? s.start_ms;
    const pad = Math.max((end - s.start_ms) * 0.05, 1);
    setZoom([Math.max(s.start_ms - pad, 0), end + pad]);
  };
  return (
    <div className="waterfall">
      <div className="wf-scale muted">
        <span>{dur(from)}</span>
        {zoom && <button type="button" className="mini" onClick={() => setZoom(null)}>show the whole run</button>}
        <span>{zoom ? `+${dur(to - from)}` : dur(to)}</span>
      </div>
      {shown.map((s) => {
        const start = Math.max(s.start_ms, from);
        const end = Math.min(s.end_ms ?? s.start_ms, to);
        const left = (100 * (start - from)) / width;
        const barWidth = Math.max((100 * (end - start)) / width, 0.3);
        const reasoning = typeof s.attrs.reasoning === 'string' ? s.attrs.reasoning : '';
        const segments = s.kind === 'model' ? modelSegments(s.attrs) : [];
        const segTotal = segments.reduce((acc, x) => acc + x.ms, 0);
        return (
          <div key={s.id} className="wf-row">
            <button type="button" className="wf-label" style={{ paddingLeft: depth(s) * 14 }}
                    onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span className={`wf-kind wf-kind-${s.kind.replace('.', '-')}`}>{KIND_LABEL[s.kind]}</span>
              {s.name}{s.attrs.approx ? ' ≈' : ''}
            </button>
            <div className="wf-track">
              <div className={`wf-bar wf-${s.kind.replace('.', '-')} ${s.status !== 'ok' ? 'wf-bad' : ''}`}
                   style={{ left: `${left}%`, width: `${barWidth}%` }} title={dur(s.duration_ms)}>
                {segments.map((x) => (
                  <span key={x.kind} className={`wf-seg wf-seg-${x.kind}`}
                        style={{ width: `${(100 * x.ms) / segTotal}%` }} title={`${x.kind} ${dur(x.ms)}`} />
                ))}
              </div>
            </div>
            <span className="wf-dur">{dur(s.duration_ms)}</span>
            {open === s.id && (
              <div className="wf-detail">
                <button type="button" className="mini" onClick={() => zoomTo(s)}>zoom to this</button>
                {segments.length > 0 && (
                  <div className="muted">{segments.map((x) => `${x.kind} ${dur(x.ms)}`).join(' · ')}</div>
                )}
                {reasoning && <Reasoning text={reasoning} />}
                {s.events.map((e, i) => (
                  <div key={i} className="muted">{dur(e.at_ms)}: {e.name} {JSON.stringify(e.attrs).slice(0, 300)}</div>
                ))}
                <pre>{JSON.stringify(Object.fromEntries(Object.entries(s.attrs)
                  .filter(([k]) => k !== 'reasoning' && k !== 'preview' && k !== 'text')), null, 1)}</pre>
                {typeof s.attrs.preview === 'string' && (
                  <details><summary>result preview</summary><pre>{s.attrs.preview}</pre></details>
                )}
              </div>
            )}
          </div>
        );
      })}
      {segmentsLegend}
    </div>
  );
}

const segmentsLegend = (
  <div className="wf-legend muted">
    model bars: <span className="wf-seg-key wf-seg-queued" /> queued <span className="wf-seg-key wf-seg-load" /> loading{' '}
    <span className="wf-seg-key wf-seg-read" /> reading <span className="wf-seg-key wf-seg-write" /> writing
  </div>
);
