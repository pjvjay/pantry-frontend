import { useEffect, useState } from 'react';
import { PlanAbortError, getRecipes } from '../api';
import { ErrorBanner, parseList } from '../components/common';
import { ImportSheet } from '../components/ImportSheet';
import { AbortAlert, PlanView, WeekView } from '../components/plan';
import { planNLWith, planRecipeWith, planWeekWith } from '../hub';
import type { PlanExecution, Recipe, ShoppingPlan, WeekPlan } from '../types';

const RECIPE_SAMPLE = `Sichuan Mala Chicken (serves 2)
- 1 lb boneless skinless chicken thigh
- 1 tablespoon Shaoxing wine
- 1 tablespoon light soy sauce
- 1 cup whole dried red Sichuan chilies
- 2 teaspoons Sichuan peppercorns
- 1/4 cup cornstarch
- 5 garlic cloves
- 1 thumb ginger
- 4 green onions
- 1 cup chopped cilantro
- 1 tablespoon truffle oil`;

// Shopping points for the location option. The catalog's stores sit around downtown Vancouver;
// Richmond shows a plan whose nearest stores are out of range.
const PLACES: { label: string; lat: number | null; lon: number | null }[] = [
  { label: 'Server default (downtown Vancouver)', lat: null, lon: null },
  { label: 'Kitsilano', lat: 49.2684, lon: -123.1683 },
  { label: 'East Vancouver', lat: 49.2765, lon: -123.07 },
  { label: 'Richmond', lat: 49.1666, lon: -123.1336 },
];

function OriginInputs({ prefer, exclude, setPrefer, setExclude }: {
  prefer: string; exclude: string; setPrefer: (v: string) => void; setExclude: (v: string) => void;
}) {
  return (
    <>
      <label>
        prefer origins
        <input value={prefer} onChange={(e) => setPrefer(e.target.value)} placeholder="Canada, Italy" />
      </label>
      <label>
        exclude origins
        <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="United States" />
      </label>
    </>
  );
}

export default function PlannerView() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  const [place, setPlace] = useState(0);
  const [maxKm, setMaxKm] = useState('5');
  const [allowPartial, setAllowPartial] = useState(true);
  const [prefer, setPrefer] = useState('');
  const [exclude, setExclude] = useState('');
  const [days, setDays] = useState(5);
  const [budget, setBudget] = useState('');
  const [excludeTags, setExcludeTags] = useState('');
  const [planning, setPlanning] = useState<string | null>(null);
  const [plan, setPlan] = useState<ShoppingPlan | null>(null);
  const [week, setWeek] = useState<WeekPlan | null>(null);
  const [planError, setPlanError] = useState('');
  const [planAbort, setPlanAbort] = useState<PlanExecution | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    getRecipes().then(setRecipes).catch((e: Error) => setLoadError(e.message));
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setPlanning(key);
    setPlan(null);
    setWeek(null);
    setPlanError('');
    setPlanAbort(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof PlanAbortError) setPlanAbort(e.execution);
      else setPlanError((e as Error).message);
    } finally {
      setPlanning(null);
    }
  };

  const origins = () => ({ exclude_origin: parseList(exclude), preference: parseList(prefer) });

  const onPlanText = () => run('__nl__', async () => {
    const p = PLACES[place];
    setPlan(await planNLWith(text, {
      lat: p.lat, lon: p.lon, max_km: maxKm.trim() ? Number(maxKm) : null,
      allow_partial: allowPartial, ...origins(),
    }));
  });

  const onPlanWeek = () => run('__week__', async () => {
    setWeek(await planWeekWith({
      days, max_total_budget: budget.trim() ? Number(budget) : null,
      exclude_tags: parseList(excludeTags), ...origins(),
    }));
  });

  const onPlanRecipe = (slug: string) => run(slug, async () => {
    const p = PLACES[place];
    setPlan(await planRecipeWith(slug, parseList(exclude), parseList(prefer), {
      lat: p.lat, lon: p.lon, max_km: maxKm.trim() ? Number(maxKm) : null,
    }));
  });

  // The import sheet's reviewed recipe, planned by /plan/spec with this page's options and shown
  // here like any other plan.
  const p = PLACES[place];
  const specOptions = {
    lat: p.lat, lon: p.lon, max_km: maxKm.trim() ? Number(maxKm) : null,
    allow_partial: allowPartial, ...origins(),
  };
  const onImported = (planned: ShoppingPlan) => {
    setWeek(null);
    setPlanError('');
    setPlanAbort(null);
    setPlan(planned);
  };

  const busy = planning !== null;
  return (
    <div className="view">
      <ErrorBanner error={loadError && `Couldn't load recipes: ${loadError}`}
                   hint="Is the pantry API up and the database seeded? See the System tab." />

      <section className="panel">
        <h2>Plan from a recipe</h2>
        <p className="card-sub">
          Paste any recipe. The recipe is parsed into ingredient lines, every line is matched
          against the store catalog with SQL, and products are chosen per line. The query plan,
          trip optimizer and coverage below are what the server actually ran.{' '}
          <strong>Import a recipe</strong> instead reads a link (with the local demo hub) or a
          pasted ingredient list into lines you review, and plans exactly those, with no AI parse.
        </p>
        <form className="recipe-input" onSubmit={(e) => { e.preventDefault(); void onPlanText(); }}>
          <textarea rows={9} value={text} onChange={(e) => setText(e.target.value)}
                    placeholder={RECIPE_SAMPLE} />
          <div className="form-row">
            <label>
              shopping from
              <select value={place} onChange={(e) => setPlace(Number(e.target.value))}>
                {PLACES.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
              </select>
            </label>
            <label>
              within km
              <input type="number" min={0.5} max={100} step={0.5} value={maxKm}
                     onChange={(e) => setMaxKm(e.target.value)} placeholder="any" />
            </label>
            <label className="check">
              <input type="checkbox" checked={allowPartial}
                     onChange={(e) => setAllowPartial(e.target.checked)} />
              plan what it can (list the rest)
            </label>
          </div>
          <div className="form-row">
            <OriginInputs prefer={prefer} exclude={exclude} setPrefer={setPrefer} setExclude={setExclude} />
            <button type="button" className="secondary" onClick={() => setText(RECIPE_SAMPLE)}>
              Use sample
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => setImporting(true)}>
              Import a recipe
            </button>
            <button disabled={busy || !text.trim()}>
              {planning === '__nl__' ? 'Planning…' : 'Plan my shopping'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        <h2>Plan a week of dinners</h2>
        <p className="card-sub">
          Picks dinners from the recipe library, merges the basket so shared ingredients are
          bought once, and keeps the total under the budget when one is given.
        </p>
        <form className="form-row" onSubmit={(e) => { e.preventDefault(); void onPlanWeek(); }}>
          <label>
            dinners
            <input type="number" min={1} max={14} value={days}
                   onChange={(e) => setDays(Number(e.target.value))} />
          </label>
          <label>
            budget $
            <input type="number" min={1} step="0.01" placeholder="optional" value={budget}
                   onChange={(e) => setBudget(e.target.value)} />
          </label>
          <label>
            exclude diet tags
            <input value={excludeTags} onChange={(e) => setExcludeTags(e.target.value)}
                   placeholder="dairy, gluten" />
          </label>
          <button disabled={busy}>{planning === '__week__' ? 'Planning…' : 'Plan my week'}</button>
        </form>
      </section>

      <p className="or-divider">
        …or plan one of the library recipes, priced at stores near the shopping location within
        the distance above (with the server default and no distance, catalog prices without stores):
      </p>
      <section className="recipes">
        {recipes.map((r) => (
          <article key={r.slug} className={`card ${plan?.recipe_slug === r.slug ? 'card-active' : ''}`}>
            <h3>{r.name}</h3>
            <p className="card-sub">serves {r.servings} · {r.ingredients.length} ingredients</p>
            <p className="card-ings">{r.ingredients.map((i) => i.name).join(', ')}</p>
            <button onClick={() => void onPlanRecipe(r.slug)} disabled={busy}>
              {planning === r.slug ? 'Planning…' : 'Plan shopping'}
            </button>
          </article>
        ))}
      </section>

      <ErrorBanner error={planError && `Planning failed: ${planError}`}
                   hint="Planning calls the server's LLM. Switch to demo mode on the System tab if the model is unavailable or over quota." />
      {planAbort && <AbortAlert execution={planAbort} />}
      {plan && <PlanView plan={plan} />}
      {week && <WeekView week={week} />}

      <ImportSheet open={importing} onClose={() => setImporting(false)} onPlanned={onImported}
                   planOptions={specOptions} />
    </div>
  );
}
