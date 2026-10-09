// The agentic flow made visible: a plan as a card of ingredient photos, a recipe page's images,
// a step's reasoning, the answer's evals and confidence, and a turn's trace as a waterfall of
// spans from every layer (browser, model, tools, gateway, pantry's own steps and LLM calls).
import { useState } from 'react';
import { ingredientImage, remoteImage } from '../hub';
import type { Evals, PlanConfidence, Span, Trace } from '../types';

const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
const money = (v: unknown) => (typeof v === 'number' ? `$${v.toFixed(2)}` : '–');
export const dur = (ms: number | null | undefined) => (ms == null ? '–'
  : ms >= 60_000 ? `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
    : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);

// An ingredient's photo (Wikipedia, cached by the hub); a plain tile when there is none.
export function IngredientImage({ name, size = 56 }: { name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className="ing-img ing-img-none" style={{ width: size, height: size }}>{name.slice(0, 1)}</span>;
  return (
    <img className="ing-img" src={ingredientImage(name)} alt={name} width={size} height={size}
         loading="lazy" onError={() => setFailed(true)} />
  );
}

type Line = {
  ingredient: string; product: string; store?: string; price?: number; trip_store?: string;
  trip_price?: number | null; origin_country?: string; origin_status?: string;
  confidence?: number; match?: string; size?: string;
};
type Summary = {
  recipe_name?: string; total_cost?: number; lines?: Line[]; origin_status?: string;
  trip?: { stores: string[]; total_cost: number; travel_cost?: number } | null;
  not_stocked?: { ingredient: string }[]; out_of_range?: { ingredient: string; reason?: string }[];
  skipped?: { ingredient: string }[];
};

// A plan tool's result as the shopper would read it: one tile per purchase with its photo,
// where the recommended trip buys it, the price there, the origin and the planner's confidence.
export function PlanCard({ summary }: { summary: Summary }) {
  const lines = summary.lines ?? [];
  const left = [...(summary.not_stocked ?? []), ...(summary.out_of_range ?? []), ...(summary.skipped ?? [])];
  return (
    <div className="plan-card">
      <div className="plan-card-head">
        <strong>{summary.recipe_name ?? 'Plan'}</strong>
        <span className="muted">
          {lines.length} item(s) · {money(summary.total_cost)}
          {summary.trip && <> · trip {summary.trip.stores.join(' → ')} {money(summary.trip.total_cost)} with travel</>}
          {summary.origin_status && summary.origin_status !== 'not_requested' && <> · origin {summary.origin_status}</>}
        </span>
      </div>
      <div className="plan-tiles">
        {lines.map((l) => (
          <div key={`${l.ingredient}-${l.product}`} className="plan-tile">
            <IngredientImage name={l.ingredient} />
            <div className="plan-tile-body">
              <div className="plan-tile-ing">{l.ingredient}</div>
              <div className="plan-tile-prod">{l.product}</div>
              <div className="muted">
                {l.trip_store || l.store || 'no store chosen'} · {money(l.trip_price ?? l.price)}
              </div>
              <div className="plan-tile-tags">
                {(l.origin_country || l.origin_status) && (
                  <span className={`chip ${l.origin_status === 'resolved' ? 'chip-ok' : 'chip-muted'}`}>
                    {l.origin_country || l.origin_status}
                  </span>
                )}
                {l.match && l.match !== 'exact' && <span className="chip chip-warn">{l.match} match</span>}
                {l.confidence != null && (
                  <span className="confidence" title="the planner's confidence in this product">
                    <span className="confidence-fill" style={{ width: pct(l.confidence) }} />
                    <span className="confidence-label">{pct(l.confidence)}</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {left.length > 0 && (
        <div className="muted">not planned: {left.map((d) => d.ingredient).join(', ')}</div>
      )}
    </div>
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
        {traceId && <a href={`#/metrics?trace=${traceId}`}>trace ↗</a>}
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

// A turn's spans as a waterfall: each bar where it started and how long it took, nested by
// parent. Click a row for its attributes, events and the model's reasoning.
export function Waterfall({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState<string | null>(null);
  const total = Math.max(...trace.spans.map((s) => s.end_ms ?? s.start_ms), 1);
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
  return (
    <div className="waterfall">
      {order.map((s) => {
        const left = (100 * s.start_ms) / total;
        const width = Math.max((100 * ((s.end_ms ?? s.start_ms) - s.start_ms)) / total, 0.3);
        const reasoning = typeof s.attrs.reasoning === 'string' ? s.attrs.reasoning : '';
        return (
          <div key={s.id} className="wf-row">
            <button type="button" className="wf-label" style={{ paddingLeft: depth(s) * 14 }}
                    onClick={() => setOpen(open === s.id ? null : s.id)}>
              <span className={`wf-kind wf-kind-${s.kind.replace('.', '-')}`}>{KIND_LABEL[s.kind]}</span>
              {s.name}{s.attrs.approx ? ' ≈' : ''}
            </button>
            <div className="wf-track">
              <div className={`wf-bar wf-${s.kind.replace('.', '-')} ${s.status !== 'ok' ? 'wf-bad' : ''}`}
                   style={{ left: `${left}%`, width: `${width}%` }} title={dur(s.duration_ms)} />
            </div>
            <span className="wf-dur">{dur(s.duration_ms)}</span>
            {open === s.id && (
              <div className="wf-detail">
                {reasoning && <Reasoning text={reasoning} />}
                {s.events.map((e, i) => (
                  <div key={i} className="muted">{dur(e.at_ms)}: {e.name} {JSON.stringify(e.attrs).slice(0, 300)}</div>
                ))}
                <pre>{JSON.stringify(Object.fromEntries(Object.entries(s.attrs)
                  .filter(([k]) => k !== 'reasoning' && k !== 'preview')), null, 1)}</pre>
                {typeof s.attrs.preview === 'string' && (
                  <details><summary>result preview</summary><pre>{s.attrs.preview}</pre></details>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
