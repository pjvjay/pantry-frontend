// The plan renderers shared by the Planner lab, the import sheet and the Assistant's steps: the
// query-plan timeline, trip options, gate alerts, coverage, a shopping plan and a week plan.
//
// They wear the console's one set of pieces: each plan is a card (styles/card.css), its figures
// StatTiles, its states Tags (a glyph and words), how well a product matches its line a MatchTag,
// each product its picture with a quiet placeholder (pictures.tsx), and its tables the one table
// style, in a box that scrolls on its own when a phone is narrower than they are (ScrollRegion).
// A model's name or a routing strategy is a plain fact, so a plain chip. Styles: styles/workshop.css.
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
import { PLAN_STATES, coverageStatus, humanize, originStatus } from '../workshop';
import { Icon } from './icons';
import { MatchTag } from './matchmarks';
import { ProductPicture } from './pictures';
import { Notice, ScrollRegion, StatRow, StatTile, Tag } from './ui';
import type { TagKind } from './ui';

export const modelShort = (model: string) =>
  model.includes('haiku') ? 'haiku'
    : model.includes('sonnet') ? 'sonnet'
      : model.startsWith('gemini:') ? model.slice(7).replace(/^gemini-/, '')
        : model === 'demo-deterministic' ? 'demo'
          : model || '—';

// The model that chose a line: a plain fact, its full name on hover.
export function ModelChip({ model }: { model: string }) {
  return <span className="chip" title={model}>{modelShort(model)}</span>;
}

// How sure the planner is of a line, as a meter: the bar shows it, the figure beside it says it.
export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone = value >= 0.8 ? 'high' : value >= 0.5 ? 'mid' : 'low';
  return (
    <div className="conf">
      <div className="conf-track" aria-hidden="true">
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
      Burr trace<Icon name="external" className="ico-inline ico-end" /> <span className="sr-only">(opens in a new tab)</span>
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

// The steps the server ran, one row each, opening into the SQL it ran. Its heading is a label, not
// a heading of the page: the plan's card has the heading.
export function PlanTimeline({ steps, heading }: { steps: StepResult[]; heading: string }) {
  return (
    <div className="timeline">
      <p className="timeline-heading">{heading}</p>
      {steps.map((s) => (
        <details key={s.step_id} className={`step step-${s.outcome}`}>
          <summary>
            <span className="step-icon">
              <Icon name={s.outcome === 'aborted' ? 'x' : 'check'} size={14} strokeWidth={2.4} />
              <span className="sr-only">{s.outcome === 'aborted' ? 'aborted: ' : 'done: '}</span>
            </span>
            <span className="step-name">{s.step_id}</span>
            <span className="step-title">{stepTitle(s)}</span>
            <span className="step-label">{s.label}</span>
            <span className="step-meta">
              {s.kind === 'llm' ? `${s.duration_ms.toLocaleString()} ms` : `${s.row_count} rows · ${s.duration_ms} ms`}
            </span>
            {s.phases && s.phases.length > 0 && <PhaseBar phases={s.phases} legend />}
          </summary>
          <ScrollRegion label={`The SQL of ${s.step_id}`} className="step-sql"><pre><code>{s.sql_display}</code></pre></ScrollRegion>
        </details>
      ))}
    </div>
  );
}

export function TripOptionsPanel({ options }: { options: TripOption[] }) {
  if (options.length === 0) return null;
  return (
    <div className="trips">
      <p className="timeline-heading">
        Where to shop (basket against travel)
        <span className="basis"> · the best split across stores, over straight-line distances at an
        assumed $ per km: the search is exact, its inputs are estimates</span>
      </p>
      {options.map((o) => (
        <details key={o.stores.join('|')} className={`trip ${o.recommended ? 'trip-rec' : ''}`}>
          <summary>
            <span className="trip-stops">{o.stores.length} stop{o.stores.length > 1 ? 's' : ''}</span>
            <span className="trip-stores">{o.stores.join(' → ')}</span>
            <span className="trip-math">
              ${o.basket_cost.toFixed(2)} basket + {o.travel_km} km (${o.travel_cost.toFixed(2)})
            </span>
            <span className="trip-total">${o.total_cost.toFixed(2)}</span>
            {o.recommended && <Tag kind={PLAN_STATES.recommended.kind}>{PLAN_STATES.recommended.word}</Tag>}
            {!o.recommended && o.savings_vs_one_stop !== 0 && (
              <span className="chip">
                {o.savings_vs_one_stop > 0 ? 'saves' : 'costs'} ${Math.abs(o.savings_vs_one_stop).toFixed(2)} against one stop
              </span>
            )}
          </summary>
          {o.items.length > 0 && (
            <ul className="trip-items">
              {o.items.map((it, i) => (
                <li key={`${it.product_id}-${i}`}>
                  {it.product_name}: <strong>{it.store_name}</strong> ${it.price.toFixed(2)}
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
  unavailable_within_constraints: 'Unavailable within your limits',
  budget_infeasible: 'The budget cannot be met',
};

// A plan the server stopped at one of its gates (a 409): why, each ingredient that stopped it with
// what could stand in, and the query plan up to the step that stopped it.
export function AbortAlert({ execution }: { execution: PlanExecution }) {
  const alert = execution.aborted;
  if (!alert) return null;
  return (
    <section className="card plan-abort">
      <Notice tone="danger" title={GATE_TITLES[alert.code] ?? humanize(alert.code)}
              hint={<>Stopped at the <code>{alert.stage}</code> step.</>}>
        <p className="alert-message">{alert.message}</p>
        <ul className="alert-details">
          {alert.details.map((d) => (
            <li key={d.name}>
              <strong>{d.name}</strong>: {d.reason}
              {d.suggestions.length > 0 && (
                <span className="alert-suggestions">
                  {d.suggestions.map((sug) => <span key={sug} className="chip">{sug}</span>)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Notice>
      <PlanTimeline steps={execution.steps} heading="Query plan (it stopped at the step marked with a cross)" />
    </section>
  );
}

export function CoverageNote({ coverage }: { coverage?: OriginCoverage | null }) {
  if (!coverage || coverage.lines_total === 0) return null;
  // Spend-weighted is the headline: a basket can be half-covered by count and barely covered by
  // money. An unverified basket is never drawn as clean: under the floor it needs attention.
  const state = coverageStatus(coverage.spend_fraction, coverage.meets_floor);
  return (
    <div className="coverage">
      <p className="coverage-head">
        <Tag kind={state.kind}>{state.word}</Tag>
        <span className="muted">
          {coverage.lines_known} of {coverage.lines_total} lines
          {coverage.lines_excluded_origin > 0 && `; ${coverage.lines_excluded_origin} candidate(s) left out for their origin`}
        </span>
      </p>
      {!coverage.meets_floor && (
        <p className="coverage-hint">
          Under the {Math.round(coverage.floor * 100)}% floor. The unchecked lines are not evidence of
          a foreign origin, but this basket has not been checked well enough to call it clean.
        </p>
      )}
    </div>
  );
}

// Ingredients a plan could not buy, under a tag that says why.
function Dropped({ title, items, kind }: { title: string; items?: DroppedIngredient[]; kind: TagKind }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="dropped">
      <p className="dropped-head">
        <Tag kind={kind}>{title}</Tag>
        <span className="muted">{items.length} {items.length === 1 ? 'ingredient' : 'ingredients'}</span>
      </p>
      <ul>
        {items.map((d) => (
          <li key={d.ingredient}>
            <strong>{d.ingredient}</strong>: {d.reason}
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

// How well a line's product matches the line, when it is not the very thing asked for.
const MATCH_HINT: Record<string, string> = {
  form: 'the same ingredient in another form (ground for whole, say)',
  generic: 'a substitution: a more general product than the one asked for',
};

function LineMatch({ match }: { match?: string | null }) {
  if (!match || match === 'exact') return null;
  return (
    <span title={MATCH_HINT[match]}>
      {match === 'generic' ? <MatchTag kind="closest" label="Substitution" />
        : match === 'form' ? <MatchTag kind="form" label="Another form" />
          : <MatchTag kind="looser" label={humanize(match)} />}
    </span>
  );
}

export function PlanView({ plan }: { plan: ShoppingPlan }) {
  const gaps = (plan.not_stocked?.length ?? 0) + (plan.out_of_range?.length ?? 0)
    + (plan.skipped?.length ?? 0);
  const origin = plan.origin_status && plan.origin_status !== 'not_requested' ? originStatus(plan.origin_status) : null;
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="card-title">Shopping plan · {plan.recipe_name}</h2>
          {plan.interpretation.length > 0 && (
            <p className="card-sub interpretation">
              <span className="interp-label">Read as:</span>
              {plan.interpretation.map((line) => <span key={line} className="chip">{line}</span>)}
            </p>
          )}
        </div>
        <div className="plan-meta">
          <span className="chip">{plan.routing_strategy}</span>
          {/* In demo mode every line says demo-deterministic while preselected_model still names
              the router's pick; show what actually planned the lines. */}
          <ModelChip model={plan.line_items.length > 0
            && plan.line_items.every((l) => l.model_used === 'demo-deterministic')
            ? 'demo-deterministic' : plan.preselected_model} />
          {plan.escalated && <Tag kind={PLAN_STATES.escalated.kind}>{PLAN_STATES.escalated.word}</Tag>}
          {origin && <Tag kind={origin.kind}>Origin {origin.word.toLowerCase()}</Tag>}
          <BurrLink run={plan.burr_run} />
        </div>
      </div>
      <StatRow className="plan-figures">
        <StatTile label="Total" value={`$${plan.total_cost.toFixed(2)}`}
                  note={plan.ingredient_count
                    ? `${plan.line_items.length} purchases for ${plan.ingredient_count} ingredients` : undefined} />
        <StatTile label="LLM cost" value={`$${plan.total_llm_cost_usd.toFixed(4)}`} />
        <StatTile label="Planning time" value={`${(plan.total_latency_ms / 1000).toFixed(1)} s`} />
      </StatRow>
      {plan.plan_trace.length > 0 && (
        <PlanTimeline
          steps={plan.plan_trace}
          heading={plan.candidate_count > 0
            ? `Query plan · ${plan.candidate_count} candidates retrieved`
            : 'Plan trace (the LLM calls phase by phase, then the trip optimizer)'}
        />
      )}
      <TripOptionsPanel options={plan.trip_options} />
      <ScrollRegion label={`The lines of the plan for ${plan.recipe_name}`} className="table-scroll plan-lines">
        <table className="table">
          <thead>
            <tr>
              <th><span className="sr-only">Picture</span></th>
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
                <td className="plan-pic">
                  <ProductPicture product={li.product_name} ingredient={li.ingredient_name.split(' + ')[0]} />
                </td>
                <td>
                  {li.ingredient_name}
                  {li.also_lines && li.also_lines.length > 0 && (
                    <div className="muted">one purchase for lines {[li.line_no, ...li.also_lines].join(', ')}</div>
                  )}
                </td>
                <td>
                  <div className="prod-name">{li.product_name}</div>
                  <div className="prod-marks">
                    <LineMatch match={li.match} />
                    {(li.packs ?? 1) > 1 && <span className="chip">× {li.packs} packs</span>}
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
              <td colSpan={3}>
                Total for the planned lines
                {plan.ingredient_count ? ` (${plan.line_items.length} purchases for ${plan.ingredient_count} ingredients)` : ''}
              </td>
              <td className="num">${plan.total_cost.toFixed(2)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </ScrollRegion>
      <CoverageNote coverage={plan.origin_coverage} />
      {gaps > 0 ? (
        <>
          <Dropped title="Not stocked anywhere" items={plan.not_stocked} kind="attention" />
          <Dropped title="Stocked, but not within your limits" items={plan.out_of_range} kind="attention" />
          <Dropped title="Skipped" items={plan.skipped} kind="paused" />
        </>
      ) : (plan.ingredient_count ?? 0) > 0 && (
        <p className="muted plan-all">Every ingredient was planned: nothing is out of stock or out of range.</p>
      )}
    </section>
  );
}

// actions: controls for the header, such as the Planner lab's "Open in your plan".
export function WeekView({ week, actions }: { week: WeekPlan; actions?: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2 className="card-title">Week plan · {week.days.length} dinners</h2>
        {actions}
      </div>
      <StatRow className="plan-figures">
        <StatTile label="Merged basket" value={`$${week.total_cost.toFixed(2)}`} note="shared items bought once" />
        <StatTile label="Bought one by one" value={`$${week.standalone_cost.toFixed(2)}`} />
        {week.overlap_savings > 0 && (
          <StatTile label="Merging saves" value={`$${week.overlap_savings.toFixed(2)}`} tone="good" note="by buying shared items once" />
        )}
        {week.budget != null && (
          <StatTile label="Budget" value={`$${week.budget.toFixed(2)}`}
                    tone={week.total_cost > week.budget ? 'warn' : 'default'}
                    note={week.total_cost > week.budget ? `$${(week.total_cost - week.budget).toFixed(2)} over` : 'kept under'} />
        )}
        <StatTile label="LLM cost" value={`$${week.total_llm_cost_usd.toFixed(4)}`} />
      </StatRow>
      {week.notes.length > 0 && (
        <Notice tone="info" title="What the planner noted">
          <ul className="week-notes">{week.notes.map((n) => <li key={n}>{n}</li>)}</ul>
        </Notice>
      )}
      <PlanTimeline steps={week.plan_trace} heading="Query plan" />
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
      <ScrollRegion label="The week's shopping list" className="table-scroll">
        <table className="table">
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
                <td><span className="plan-used">{w.used_by.map((r) => <span key={r} className="chip">{r}</span>)}</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Week total (shared items once)</td>
              <td className="num">${week.total_cost.toFixed(2)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </ScrollRegion>
      <CoverageNote coverage={week.origin_coverage} />
    </section>
  );
}
