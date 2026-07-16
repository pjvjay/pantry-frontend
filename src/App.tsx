import { useEffect, useState } from 'react';
import { getHealth, getRecipes, planRecipe } from './api';
import type { Health, Recipe, ShoppingPlan } from './types';

const modelShort = (model: string) =>
  model.includes('haiku') ? 'haiku' : model.includes('sonnet') ? 'sonnet' : model || '—';

function HealthChip({ health }: { health: Health | null }) {
  if (!health) return <span className="chip chip-muted">api: connecting…</span>;
  return (
    <span className="chip chip-ok" title={`default: ${health.default_model} · escalation: ${health.escalation_model}`}>
      api: {health.status} · {health.routing_strategy}
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

function PlanView({ plan }: { plan: ShoppingPlan }) {
  return (
    <section className="panel">
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
      </div>
    </section>
  );
}

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadError, setLoadError] = useState('');
  const [planning, setPlanning] = useState<string | null>(null);
  const [plan, setPlan] = useState<ShoppingPlan | null>(null);
  const [planError, setPlanError] = useState('');

  useEffect(() => {
    getHealth().then(setHealth).catch(() => setHealth(null));
    getRecipes()
      .then(setRecipes)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  const onPlan = async (slug: string) => {
    setPlanning(slug);
    setPlan(null);
    setPlanError('');
    try {
      setPlan(await planRecipe(slug));
    } catch (e) {
      setPlanError((e as Error).message);
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

      {planError && (
        <div className="banner banner-error">
          Planning failed: {planError}
          <div className="banner-hint">
            The /plan endpoint calls the Anthropic API — if the key isn't configured in this
            environment, browsing recipes still works but planning won't.
          </div>
        </div>
      )}

      {plan && <PlanView plan={plan} />}

      <footer>
        pantry-platform demo · React SPA → FastAPI → Postgres · shipped by ArgoCD from{' '}
        <a href="https://github.com/pjvjay/pantry-gitops" target="_blank" rel="noreferrer">
          pantry-gitops
        </a>
      </footer>
    </div>
  );
}
