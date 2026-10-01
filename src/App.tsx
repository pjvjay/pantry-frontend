import { useEffect, useState } from 'react';
import {
  PlanAbortError,
  getHealth,
  getRecipes,
  planNL,
  planRecipe,
  planWeek,
  rankByOrigin,
} from './api';
import type {
  Health,
  OriginCoverage,
  OriginRanking,
  PlanExecution,
  Recipe,
  ShoppingPlan,
  StepResult,
  TripOption,
  UnrankedProduct,
  WeekPlan,
} from './types';

const RECIPE_PLACEHOLDER = `Paste a whole recipe, e.g.

Spaghetti Bolognese (serves 4)
- 400g spaghetti
- 500g ground beef
- 1 yellow onion
- 1 can crushed tomatoes
- olive oil

Notes: under $30, no dairy, only stores within 10km`;

function RecipeInput({ onPlan, busy }: { onPlan: (text: string) => void; busy: boolean }) {
  const [text, setText] = useState('');
  return (
    <form className="recipe-input" onSubmit={(e) => { e.preventDefault(); onPlan(text); }}>
      <textarea rows={8} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={RECIPE_PLACEHOLDER} />
      <button disabled={busy || !text.trim()}>
        {busy ? 'Planning…' : 'Plan my shopping'}
      </button>
    </form>
  );
}

const modelShort = (model: string) =>
  model.includes('haiku') ? 'haiku' : model.includes('sonnet') ? 'sonnet' : model || '—';

function HealthChip({ health }: { health: Health | null }) {
  if (!health) return <span className="chip chip-muted">api: connecting…</span>;
  return (
    <span className="health-chips">
      <span className="chip chip-ok" title={`default: ${health.default_model} · escalation: ${health.escalation_model}`}>
        api: {health.status} · {health.routing_strategy}
      </span>
      {health.demo_mode && (
        <span
          className="chip chip-warn"
          title="Deterministic stand-ins replace the Claude parse & selection calls — the query-plan SQL, gates, and optimizers run for real. Run locally with your own ANTHROPIC_API_KEY for the full LLM pipeline."
        >
          demo mode — no LLM
        </span>
      )}
    </span>
  );
}

function ConfidenceBar({ value }: { value: number }) {
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
};

// Specific steps get a clearer title than their generic kind.
const stepTitle = (s: StepResult) =>
  s.step_id === 't5_trip_optimizer' ? 'trip optimizer'
    : s.step_id === 'w3_menu' ? 'menu selection'
      : STEP_TITLES[s.kind];

function PlanTimeline({ steps, heading }: { steps: StepResult[]; heading: string }) {
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
            <span className="step-meta">{s.row_count} rows · {s.duration_ms} ms</span>
          </summary>
          <pre><code>{s.sql_display}</code></pre>
        </details>
      ))}
    </div>
  );
}

function TripOptionsPanel({ options }: { options: TripOption[] }) {
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

function AbortAlert({ execution }: { execution: PlanExecution }) {
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


function CoverageNote({ coverage }: { coverage?: OriginCoverage | null }) {
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

function PlanView({ plan }: { plan: ShoppingPlan }) {
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
          heading={`Query plan · ${plan.candidate_count} candidates retrieved:`}
        />
      )}
      <div className="plan-header">
        <h2>Shopping plan · {plan.recipe_name}</h2>
        <div className="plan-meta">
          <span className="chip">{plan.routing_strategy}</span>
          <span className={`chip model-${modelShort(plan.preselected_model)}`}>
            {modelShort(plan.preselected_model)}
          </span>
          {plan.escalated && <span className="chip chip-warn">escalated</span>}
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
                <td>{li.ingredient_name}</td>
                <td>
                  <div className="prod-name">{li.product_name}</div>
                  <div className="prod-desc" title={li.reasoning}>{li.product_description}</div>
                  {li.store_name && <div className="prod-store">at {li.store_name}</div>}
                </td>
                <td className="num">${li.price.toFixed(2)}</td>
                <td><ConfidenceBar value={li.confidence} /></td>
                <td><span className={`chip model-${modelShort(li.model_used)}`}>{modelShort(li.model_used)}</span></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total basket</td>
              <td className="num total">${plan.total_cost.toFixed(2)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
        <CoverageNote coverage={plan.origin_coverage} />
      </div>
    </section>
  );
}

function WeekPlanner({ onPlan, busy }: {
  onPlan: (days: number, budget: number | null) => void; busy: boolean;
}) {
  const [days, setDays] = useState(5);
  const [budget, setBudget] = useState('');
  return (
    <form
      className="week-form"
      onSubmit={(e) => {
        e.preventDefault();
        onPlan(days, budget.trim() ? Number(budget) : null);
      }}
    >
      <span className="week-label">…or plan a whole week from the recipe library:</span>
      <label>
        dinners
        <input type="number" min={2} max={7} value={days}
               onChange={(e) => setDays(Number(e.target.value))} />
      </label>
      <label>
        budget $
        <input type="number" min={1} step="0.01" placeholder="optional" value={budget}
               onChange={(e) => setBudget(e.target.value)} />
      </label>
      <button disabled={busy}>{busy ? 'Planning…' : 'Plan my week'}</button>
    </form>
  );
}

function WeekView({ week }: { week: WeekPlan }) {
  return (
    <section className="panel">
      <div className="plan-header">
        <h2>Week plan · {week.days.length} dinners</h2>
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

const REASON_LABELS: Record<UnrankedProduct['reason'], string> = {
  no_evidence: 'No source published an origin',
  conflicting: 'Sources disagree — no winner picked',
  lookup_failed: 'Lookup failed (outage or rate limit) — not a finding',
  guess_only: 'Name-based guess only — not evidence',
};

function parseCountries(text: string): string[] {
  return text.split(',').map((c) => c.trim()).filter(Boolean);
}

function OriginPanel() {
  const [preference, setPreference] = useState('Canada');
  const [exclude, setExclude] = useState('United States');
  const [result, setResult] = useState<OriginRanking | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showUnranked, setShowUnranked] = useState(false);

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      setResult(await rankByOrigin(parseCountries(preference), parseCountries(exclude)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel origin-panel">
      <h2>Where things come from</h2>
      <p className="card-sub">
        Rank the catalog against countries you prefer. Nothing is inferred — products are
        placed only on ingested label and database evidence.
      </p>

      <div className="origin-controls">
        <label>
          Prefer, in order
          <input
            value={preference}
            onChange={(e) => setPreference(e.target.value)}
            placeholder="Canada, Mexico"
          />
        </label>
        <label>
          Exclude
          <input
            value={exclude}
            onChange={(e) => setExclude(e.target.value)}
            placeholder="United States"
          />
        </label>
        <button onClick={run} disabled={busy}>
          {busy ? 'Ranking…' : 'Rank catalog'}
        </button>
      </div>

      {error && <div className="banner banner-error">Ranking failed: {error}</div>}

      {result && (
        <>
          <div className="origin-counts">
            <span className="chip chip-ok">{result.counts.ranked ?? 0} ranked</span>
            <span className="chip pill-bad">{result.counts.excluded ?? 0} excluded</span>
            <span className="chip pill-warn">{result.counts.unranked ?? 0} unverified</span>
            <span className="chip chip-muted">{result.counts.total ?? 0} in catalog</span>
          </div>

          <p className="coverage-note">{result.coverage_note}</p>

          {result.ranked.length > 0 && (
            <table className="origin-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Placement</th>
                  <th>On the label</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {result.ranked.map((r) => (
                  <tr key={r.product_id}>
                    <td>{r.product_name}</td>
                    <td>
                      {r.tier_label}
                      {r.origin.claim_type && (
                        <span className="claim-chip">{r.origin.claim_type}</span>
                      )}
                    </td>
                    <td className="verbatim">{r.origin.verbatim || '—'}</td>
                    <td className="muted">
                      {r.origin.source} · {r.origin.confidence}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {result.excluded.length > 0 && (
            <>
              <h3 className="origin-subhead">Excluded ({result.excluded.length})</h3>
              <ul className="origin-list">
                {result.excluded.map((e) => (
                  <li key={e.product_id}>
                    <strong>{e.product_name}</strong> — {e.excluded_country}, evidenced by{' '}
                    <code>{e.matched_field}</code>
                    {e.matched_field === 'ingredient_origin' && (
                      <span className="hint">
                        {' '}processed elsewhere, but the ingredients are from an excluded country
                      </span>
                    )}
                    {e.verbatim && <div className="verbatim">“{e.verbatim}”</div>}
                  </li>
                ))}
              </ul>
            </>
          )}

          <h3 className="origin-subhead">
            Unverified ({result.unranked.length}){' '}
            <button className="linkish" onClick={() => setShowUnranked((v) => !v)}>
              {showUnranked ? 'hide' : 'show'}
            </button>
          </h3>
          <p className="card-sub">
            Held out of the ranking on purpose. No origin was published for these — that is
            not evidence that they are foreign, or domestic.
          </p>
          {showUnranked && (
            <ul className="origin-list">
              {result.unranked.map((u) => (
                <li key={u.product_id}>
                  <strong>{u.product_name}</strong> — {REASON_LABELS[u.reason]}
                  {u.detail && <span className="muted"> ({u.detail})</span>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadError, setLoadError] = useState('');
  const [planning, setPlanning] = useState<string | null>(null);
  const [plan, setPlan] = useState<ShoppingPlan | null>(null);
  const [week, setWeek] = useState<WeekPlan | null>(null);
  const [planError, setPlanError] = useState('');
  const [planAbort, setPlanAbort] = useState<PlanExecution | null>(null);

  const resetResults = () => {
    setPlan(null);
    setWeek(null);
    setPlanError('');
    setPlanAbort(null);
  };

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    getRecipes()
      .then(setRecipes)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const onPlan = async (slug: string) => {
    setPlanning(slug);
    resetResults();
    try {
      setPlan(await planRecipe(slug));
    } catch (e) {
      setPlanError((e as Error).message);
    } finally {
      setPlanning(null);
    }
  };

  const onPlanNL = async (text: string) => {
    setPlanning('__nl__');
    resetResults();
    try {
      setPlan(await planNL(text));
    } catch (e) {
      if (e instanceof PlanAbortError) {
        setPlanAbort(e.execution);      // gate abort: render the alert card
      } else {
        setPlanError((e as Error).message);
      }
    } finally {
      setPlanning(null);
    }
  };

  const onPlanWeek = async (days: number, budget: number | null) => {
    setPlanning('__week__');
    resetResults();
    try {
      setWeek(await planWeek(days, budget));
    } catch (e) {
      if (e instanceof PlanAbortError) {
        setPlanAbort(e.execution);
      } else {
        setPlanError((e as Error).message);
      }
    } finally {
      setPlanning(null);
    }
  };

  return (
    <div className="app">
      <header>
        <div>
          <h1>🥫 Pantry Planner</h1>
          <p className="tagline">
            LLM grocery matching, deployed the GitOps way —{' '}
            <a href="https://github.com/pjvjay/pantry-platform" target="_blank" rel="noreferrer">
              how this runs
            </a>
          </p>
        </div>
        <HealthChip health={health} />
      </header>

      {loadError && (
        <div className="banner banner-error">
          Couldn't load recipes: {loadError}. Is the API up and the database seeded?
        </div>
      )}

      <RecipeInput onPlan={onPlanNL} busy={planning !== null} />

      <WeekPlanner onPlan={onPlanWeek} busy={planning !== null} />

      <p className="or-divider">…or plan one of the sample recipes:</p>

      <section className="recipes">
        {recipes.map((r) => (
          <article key={r.slug} className={`card ${plan?.recipe_slug === r.slug ? 'card-active' : ''}`}>
            <h3>{r.name}</h3>
            <p className="card-sub">
              serves {r.servings} · {r.ingredients.length} ingredients
            </p>
            <p className="card-ings">{r.ingredients.map((i) => i.name).join(', ')}</p>
            <button onClick={() => onPlan(r.slug)} disabled={planning !== null}>
              {planning === r.slug ? 'Planning…' : 'Plan shopping'}
            </button>
          </article>
        ))}
      </section>

      <OriginPanel />

      {planError && (
        <div className="banner banner-error">
          Planning failed: {planError}
          <div className="banner-hint">
            The /plan endpoint calls the Anthropic API — if the key isn't configured in this
            environment, browsing recipes still works but planning won't.
          </div>
        </div>
      )}

      {planAbort && <AbortAlert execution={planAbort} />}

      {plan && <PlanView plan={plan} />}

      {week && <WeekView week={week} />}

      <footer>
        pantry-platform demo · React SPA → FastAPI → Postgres · shipped by ArgoCD from{' '}
        <a href="https://github.com/pjvjay/pantry-gitops" target="_blank" rel="noreferrer">
          pantry-gitops
        </a>
      </footer>
    </div>
  );
}
