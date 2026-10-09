// The plan renderers shared by the Planner and the Assistant: query-plan timeline, trip
// options, gate alerts, coverage, a shopping plan and a week plan.
import type { ReactNode } from 'react';
import type {
  DroppedIngredient,
  LlmCallTrace,
  OriginCoverage,
  PlanExecution,
  ShoppingPlan,
  StepPhase,
  StepResult,
  TripOption,
  WeekPlan,
} from '../types';
import { IngredientImage } from './flow';

export const modelShort = (model: string) =>
  model.includes('haiku') ? 'haiku'
    : model.includes('sonnet') ? 'sonnet'
      : model.startsWith('gemini:') ? model.slice(7).replace(/^gemini-/, '')
        : model === 'demo-deterministic' ? 'demo'
          : model || '—';

const modelClass = (model: string) =>
  model.includes('haiku') ? 'model-haiku'
    : model.includes('sonnet') ? 'model-sonnet'
      : model.startsWith('gemini:') ? 'model-gemini'
        : model === 'demo-deterministic' ? 'chip-warn' : '';

export function ModelChip({ model }: { model: string }) {
  return <span className={`chip ${modelClass(model)}`} title={model}>{modelShort(model)}</span>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? 'high' : value >= 0.5 ? 'mid' : 'low';
  return (
    <div className="conf">
      <div className="conf-track">
        <div className={`conf-fill conf-${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="conf-label">{pct}%</span>
    </div>
  );
}

const STEP_TITLES: Record<StepResult['kind'], string> = {
  existence: 'existence check',
  options: 'store options',
  statistics: 'brand stats',
  lookup: 'substitute lookup',
  llm: 'LLM call',
};

const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

// The CSS class of a phase: its colour in the bar and the legend.
const phaseClass = (name: string) =>
  name.startsWith('waiting for') ? 'wait'
    : ({ 'DNS lookup': 'dns', 'TCP connect': 'connect', 'TLS handshake': 'tls', upload: 'upload',
      download: 'download', 'retry wait': 'retry' } as Record<string, string>)[name] ?? 'other';

// Where a call's time went: one segment per phase, as wide as its share of the total.
export function PhaseBar({ phases, legend = false }: { phases: StepPhase[]; legend?: boolean }) {
  const total = phases.reduce((t, p) => t + p.ms, 0) || 1;
  const many = new Set(phases.map((p) => p.attempt)).size > 1;
  const label = (p: StepPhase) => `${many ? `#${p.attempt} ` : ''}${p.name} ${secs(p.ms)}`;
  return (
    <span className="phases">
      <span className="phase-bar" role="img" aria-label={phases.map(label).join(', ')}>
        {phases.map((p, i) => (
          <span key={i} className={`phase phase-${phaseClass(p.name)}`} title={label(p)}
            style={{ width: `${Math.max((p.ms / total) * 100, 0.8)}%` }} />
        ))}
      </span>
      {legend && (
        <span className="phase-legend">
          {phases.map((p, i) => (
            <span key={i}><i className={`phase phase-${phaseClass(p.name)}`} />{label(p)}</span>
          ))}
        </span>
      )}
    </span>
  );
}

// pantry's Burr UI (scripts/up.sh starts it; VITE_BURR_UI_URL points elsewhere).
const BURR_UI_URL = (import.meta.env.VITE_BURR_UI_URL as string | undefined) ?? 'http://127.0.0.1:7241';

// A link to the Burr run that traced one plan call, step by step.
export function BurrLink({ run }: { run?: string }) {
  if (!run) return null;
  return (
    <a className="burr-link" href={`${BURR_UI_URL}/project/pantry-planner/null/${encodeURIComponent(run)}`}
      target="_blank" rel="noreferrer" title="Open this plan call's step-by-step trace in the Burr UI">
      Burr trace ↗
    </a>
  );
}

// The LLM calls a plan made, one line each: model, total, the wait on the provider against
// the time the provider reports for itself, and the phase bar.
export function LlmCalls({ calls, heading }: { calls: LlmCallTrace[]; heading: string }) {
  return (
    <div className="llm-calls">
      {calls.map((c, i) => {
        const wait = c.phases.filter((p) => p.name.startsWith('waiting for'))
          .reduce((t, p) => t + p.ms, 0);
        const server = c.phases.find((p) => p.name.startsWith('waiting for'))?.name
          .replace('waiting for ', '') ?? 'the server';
        return (
          <div key={i} className="llm-call">
            <span className="muted">{heading}</span> <code>{c.step}</code>{' '}
            {c.model.replace(/^gemini:/, '')} · {secs(c.total_ms)}
            {wait > 0 && <> · waiting for {server} {secs(wait)}</>}
            {c.server_ms != null && <> ({server} reports {secs(c.server_ms)})</>}
            {c.attempts > 1 && <> · {c.attempts} attempts</>}
            {c.status != null && c.status !== 200 && <> · HTTP {c.status}</>}
            <PhaseBar phases={c.phases} legend />
          </div>
        );
      })}
    </div>
  );
}

// Specific steps get a clearer title than their generic kind.
const stepTitle = (s: StepResult) =>
  s.step_id === 't5_trip_optimizer' ? 'trip optimizer'
    : s.step_id === 'w3_menu' ? 'menu selection'
      : STEP_TITLES[s.kind];

export function PlanTimeline({ steps, heading }: { steps: StepResult[]; heading: string }) {
  return (
    <div className="timeline">
      <div className="timeline-heading">{heading}</div>
      {steps.map((s) => (
        <details key={s.step_id} className={`step step-${s.outcome}`}>
          <summary>
            <span className="step-icon">{s.outcome === 'aborted' ? '✗' : '✓'}</span>
            <span className="step-name">{s.step_id}</span>
            <span className="step-title">{stepTitle(s)}</span>
            <span className="step-label">{s.label}</span>
            <span className="step-meta">
              {s.kind === 'llm' ? `${s.duration_ms.toLocaleString()} ms` : `${s.row_count} rows · ${s.duration_ms} ms`}
            </span>
            {s.phases && s.phases.length > 0 && <PhaseBar phases={s.phases} legend />}
          </summary>
          <pre><code>{s.sql_display}</code></pre>
        </details>
      ))}
    </div>
  );
}

export function TripOptionsPanel({ options }: { options: TripOption[] }) {
  if (options.length === 0) return null;
  return (
    <div className="trips">
      <div className="timeline-heading">
        Where to shop (basket vs travel)
        <span className="basis"> · optimal store split over straight-line
        distance at an assumed $/km — the search is exact, the inputs are
        estimates</span>
      </div>
      {options.map((o) => (
        <details key={o.stores.join('|')} className={`trip ${o.recommended ? 'trip-rec' : ''}`}>
          <summary>
            <span className="trip-stops">{o.stores.length} stop{o.stores.length > 1 ? 's' : ''}</span>
            <span className="trip-stores">{o.stores.join(' → ')}</span>
            <span className="trip-math">
              ${o.basket_cost.toFixed(2)} basket + {o.travel_km} km (${o.travel_cost.toFixed(2)})
            </span>
            <span className="trip-total">${o.total_cost.toFixed(2)}</span>
            {o.recommended && <span className="chip chip-ok">recommended</span>}
            {!o.recommended && o.savings_vs_one_stop !== 0 && (
              <span className="chip chip-muted">
                {o.savings_vs_one_stop > 0 ? 'saves' : 'costs'} $
                {Math.abs(o.savings_vs_one_stop).toFixed(2)} vs one stop
              </span>
            )}
          </summary>
          {o.items.length > 0 && (
            <ul className="trip-items">
              {o.items.map((it, i) => (
                <li key={`${it.product_id}-${i}`}>
                  {it.product_name} — <strong>{it.store_name}</strong> ${it.price.toFixed(2)}
                </li>
              ))}
            </ul>
          )}
        </details>
      ))}
    </div>
  );
}

const GATE_TITLES: Record<string, string> = {
  missing_ingredients: 'Ingredients not stocked',
  unavailable_within_constraints: 'Unavailable within your constraints',
  budget_infeasible: 'Budget infeasible',
};

export function AbortAlert({ execution }: { execution: PlanExecution }) {
  const alert = execution.aborted;
  if (!alert) return null;
  return (
    <section className="panel">
      <div className="alert-card">
        <div className="alert-title">
          ✗ {GATE_TITLES[alert.code] ?? alert.code} <span className="chip chip-warn">{alert.stage}</span>
        </div>
        <p className="alert-message">{alert.message}</p>
        <ul className="alert-details">
          {alert.details.map((d) => (
            <li key={d.name}>
              <strong>{d.name}</strong> — {d.reason}
              {d.suggestions.length > 0 && (
                <span className="alert-suggestions">
                  {d.suggestions.map((sug) => <span key={sug} className="chip">{sug}</span>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <PlanTimeline steps={execution.steps} heading="Query plan (aborted at the ✗ step):" />
    </section>
  );
}

export function CoverageNote({ coverage }: { coverage?: OriginCoverage | null }) {
  if (!coverage || coverage.lines_total === 0) return null;
  // Spend-weighted is the headline: a basket can be half-covered by count
  // and barely covered by money. Never render an unverified basket as clean.
  const pct = Math.round(coverage.spend_fraction * 100);
  return (
    <div className={`coverage ${coverage.meets_floor ? 'coverage-ok' : 'coverage-warn'}`}>
      <strong>Origin checked for {pct}% of spend</strong>{' '}
      ({coverage.lines_known} of {coverage.lines_total} lines
      {coverage.lines_excluded_origin > 0 &&
        `; ${coverage.lines_excluded_origin} candidate(s) excluded`})
      {!coverage.meets_floor && (
        <div className="hint">
          Below the {Math.round(coverage.floor * 100)}% floor — the unchecked
          lines are not evidence of foreign origin, but this basket has not
          been verified well enough to call it clean.
        </div>
      )}
    </div>
  );
}

function Dropped({ title, items, tone }: { title: string; items?: DroppedIngredient[]; tone: string }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`dropped dropped-${tone}`}>
      <div className="dropped-title">{title} ({items.length})</div>
      <ul>
        {items.map((d) => (
          <li key={d.ingredient}>
            <strong>{d.ingredient}</strong> — {d.reason}
            {d.suggestions.length > 0 && (
              <span className="alert-suggestions">
                {d.suggestions.map((s) => <span key={s} className="chip">{s}</span>)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

const MATCH_HINT: Record<string, string> = {
  exact: 'the product is the ingredient asked for',
  form: 'same ingredient in another form (e.g. ground for whole)',
  generic: 'a substitution: a more general product than asked for',
};

export function PlanView({ plan }: { plan: ShoppingPlan }) {
  const gaps = (plan.not_stocked?.length ?? 0) + (plan.out_of_range?.length ?? 0)
    + (plan.skipped?.length ?? 0);
  return (
    <section className="panel">
      {plan.interpretation.length > 0 && (
        <div className="interpretation">
          <span className="interp-label">Interpreted as:</span>
          {plan.interpretation.map((line) => (
            <span key={line} className="chip">{line}</span>
          ))}
        </div>
      )}
      {plan.plan_trace.length > 0 && (
        <PlanTimeline
          steps={plan.plan_trace}
          heading={plan.candidate_count > 0
            ? `Query plan · ${plan.candidate_count} candidates retrieved:`
            : 'Plan trace (LLM calls phase by phase, then the trip optimizer):'}
        />
      )}
      <div className="plan-header">
        <h2>Shopping plan · {plan.recipe_name}</h2>
        <div className="plan-meta">
          <span className="chip">{plan.routing_strategy}</span>
          {/* In demo mode every line says demo-deterministic while preselected_model still names
              the router's pick; show what actually planned the lines. */}
          <ModelChip model={plan.line_items.length > 0
            && plan.line_items.every((l) => l.model_used === 'demo-deterministic')
            ? 'demo-deterministic' : plan.preselected_model} />
          {plan.escalated && <span className="chip chip-warn">escalated</span>}
          <BurrLink run={plan.burr_run} />
          {plan.origin_status && plan.origin_status !== 'not_requested' && (
            <span className={`chip ${plan.origin_status === 'verified' ? 'chip-ok' : 'chip-warn'}`}>
              origin {plan.origin_status}
            </span>
          )}
          <span className="chip chip-muted">
            LLM ${plan.total_llm_cost_usd.toFixed(4)} · {(plan.total_latency_ms / 1000).toFixed(1)}s
          </span>
        </div>
      </div>
      <TripOptionsPanel options={plan.trip_options} />
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th aria-label="photo" />
              <th>Ingredient</th>
              <th>Matched product</th>
              <th className="num">Price</th>
              <th>Confidence</th>
              <th>Model</th>
            </tr>
          </thead>
          <tbody>
            {plan.line_items.map((li) => (
              <tr key={li.line_no}>
                <td><IngredientImage name={li.ingredient_name.split(' + ')[0]} size={40} /></td>
                <td>
                  {li.ingredient_name}
                  {li.also_lines && li.also_lines.length > 0 && (
                    <div className="muted">one purchase for lines {[li.line_no, ...li.also_lines].join(', ')}</div>
                  )}
                </td>
                <td>
                  <div className="prod-name">
                    {li.product_name}
                    {li.match && li.match !== 'exact' && (
                      <span className={`claim-chip match-${li.match}`} title={MATCH_HINT[li.match]}>
                        {li.match === 'generic' ? 'substitution' : li.match}
                      </span>
                    )}
                    {(li.packs ?? 1) > 1 && <span className="claim-chip">× {li.packs} packs</span>}
                  </div>
                  <div className="prod-desc" title={li.reasoning}>{li.product_description}</div>
                  {li.store_name && <div className="prod-store">at {li.store_name}</div>}
                  {li.origin && li.origin.status === 'resolved' && (
                    <div className="muted">origin: {li.origin.country} ({li.origin.claim_type})</div>
                  )}
                </td>
                <td className="num">${li.price.toFixed(2)}</td>
                <td><ConfidenceBar value={li.confidence} /></td>
                <td><ModelChip model={li.model_used} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>
                Total for the planned lines
                {plan.ingredient_count ? ` (${plan.line_items.length} purchases for ${plan.ingredient_count} ingredients)` : ''}
              </td>
              <td className="num total">${plan.total_cost.toFixed(2)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
        <CoverageNote coverage={plan.origin_coverage} />
      </div>
      {gaps > 0 ? (
        <>
          <Dropped title="Not stocked anywhere" items={plan.not_stocked} tone="bad" />
          <Dropped title="Stocked, but not within your limits" items={plan.out_of_range} tone="warn" />
          <Dropped title="Skipped" items={plan.skipped} tone="muted" />
        </>
      ) : (plan.ingredient_count ?? 0) > 0 && (
        <p className="muted">Every ingredient was planned: nothing is out of stock or out of range.</p>
      )}
    </section>
  );
}

// actions: controls for the header, such as the Planner's "Open in Meal plan".
export function WeekView({ week, actions }: { week: WeekPlan; actions?: ReactNode }) {
  return (
    <section className="panel">
      <div className="plan-header">
        <h2>Week plan · {week.days.length} dinners</h2>
        {actions}
        <div className="plan-meta">
          <span className="chip chip-ok">
            merged basket ${week.total_cost.toFixed(2)}
          </span>
          <span className="chip">standalone ${week.standalone_cost.toFixed(2)}</span>
          {week.overlap_savings > 0 && (
            <span className="chip chip-ok">overlap saves ${week.overlap_savings.toFixed(2)}</span>
          )}
          {week.budget != null && <span className="chip">budget ${week.budget.toFixed(2)}</span>}
          <span className="chip chip-muted">LLM ${week.total_llm_cost_usd.toFixed(4)}</span>
        </div>
      </div>
      {week.notes.length > 0 && (
        <ul className="week-notes">
          {week.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <PlanTimeline steps={week.plan_trace} heading="Query plan:" />
      <TripOptionsPanel options={week.trip_options} />
      <div className="week-days">
        {week.days.map((d) => (
          <details key={d.recipe_slug} className="step">
            <summary>
              <span className="step-name">{d.recipe_name}</span>
              <span className="step-label">{d.line_items.length} items</span>
              <span className="step-meta">${d.day_cost.toFixed(2)}</span>
            </summary>
            <ul className="trip-items">
              {d.line_items.map((li) => (
                <li key={li.line_no}>
                  {li.ingredient_name} → {li.product_name}
                  {li.store_name && <> at <strong>{li.store_name}</strong></>} ${li.price.toFixed(2)}
                </li>
              ))}
            </ul>
          </details>
        ))}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Buy once</th>
              <th>Store</th>
              <th className="num">Price</th>
              <th>Used by</th>
            </tr>
          </thead>
          <tbody>
            {week.shopping_list.map((w) => (
              <tr key={w.product_id}>
                <td className="prod-name">{w.product_name}</td>
                <td>{w.store_name}</td>
                <td className="num">${w.price.toFixed(2)}</td>
                <td>
                  {w.used_by.map((r) => <span key={r} className="chip chip-muted">{r}</span>)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Week total (shared items once)</td>
              <td className="num total">${week.total_cost.toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <CoverageNote coverage={week.origin_coverage} />
      </div>
    </section>
  );
}
