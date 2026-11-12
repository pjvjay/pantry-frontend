import { useEffect, useId, useRef, useState } from 'react';
import { PlanAbortError, getRecipes } from '../api';
import { ErrorBanner, parseList } from '../components/common';
import { Icon } from '../components/icons';
import { ImportSheet } from '../components/ImportSheet';
import { OpenInMealPlan } from '../components/OpenInMealPlan';
import { AbortAlert, PlanView, WeekView } from '../components/plan';
import { planNLWith, planRecipeWith, planWeekWith } from '../hub';
import { hrefFor } from '../routes';
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

// Where the planner's health and its LLM switch are.
const SYSTEM = hrefFor({ name: 'workshop', tab: 'system' });

function OriginInputs({ prefer, exclude, setPrefer, setExclude }: {
  prefer: string; exclude: string; setPrefer: (v: string) => void; setExclude: (v: string) => void;
}) {
  return (
    <>
      <label>
        Prefer origins
        <input value={prefer} onChange={(e) => setPrefer(e.target.value)} placeholder="Canada, Italy" />
      </label>
      <label>
        Leave out origins
        <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="United States" />
      </label>
    </>
  );
}

// The Planner lab: the one-off planner, for trying the API's own planning by hand. Each way in is a
// card with one primary action (a recipe pasted, a week of dinners), and the library's recipes are
// cards of their own, each with a quieter Plan shopping. What comes back is drawn by
// components/plan.tsx, as the import sheet and the Assistant's steps draw it.
export default function PlannerView() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');
  // Plan my shopping pressed with nothing pasted: it says what to do instead of doing nothing
  const [textEmpty, setTextEmpty] = useState(false);
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
  const recipeBox = useRef<HTMLTextAreaElement>(null);
  const textId = useId();
  const textNote = useId();
  const libraryId = useId();

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

  const onPlanText = () => {
    if (!text.trim()) {
      setTextEmpty(true);
      recipeBox.current?.focus();
      return;
    }
    void run('__nl__', async () => {
      const p = PLACES[place];
      setPlan(await planNLWith(text, {
        lat: p.lat, lon: p.lon, max_km: maxKm.trim() ? Number(maxKm) : null,
        allow_partial: allowPartial, ...origins(),
      }));
    });
  };

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
    <div className="view ws-stack">
      <ErrorBanner error={loadError && `Couldn't load recipes: ${loadError}`}
                   hint={<>Is the pantry API up and the database seeded? See <a href={SYSTEM}>Workshop › System</a>.</>} />

      <section className="card">
        <h2 className="card-title">Plan from a recipe</h2>
        <p className="card-sub">
          Paste any recipe. The recipe is parsed into ingredient lines, every line is matched
          against the store catalog with SQL, and products are chosen per line. The query plan,
          trip optimizer and coverage below are what the server actually ran.{' '}
          <strong>Import a recipe</strong> instead reads a link (with the local demo hub) or a
          pasted ingredient list into lines you review, and plans exactly those, with no AI parse.
        </p>
        <form className="recipe-input" onSubmit={(e) => { e.preventDefault(); onPlanText(); }}>
          <label htmlFor={textId}>Recipe</label>
          <textarea id={textId} ref={recipeBox} rows={9} value={text} placeholder={RECIPE_SAMPLE}
                    aria-describedby={textEmpty && !text.trim() ? textNote : undefined}
                    onChange={(e) => { setText(e.target.value); setTextEmpty(false); }} />
          {/* on the page from the start (empty), so the words are heard when there is nothing to plan */}
          <p id={textNote} className="planner-note" role="status">
            {textEmpty && !text.trim() ? 'Paste a recipe first, or press Use the sample.' : ''}
          </p>
          <div className="form-row">
            <label>
              Shopping from
              <select value={place} onChange={(e) => setPlace(Number(e.target.value))}>
                {PLACES.map((p, i) => <option key={p.label} value={i}>{p.label}</option>)}
              </select>
            </label>
            <label>
              Within (km)
              <input type="number" min={0.5} max={100} step={0.5} value={maxKm}
                     onChange={(e) => setMaxKm(e.target.value)} placeholder="any" />
            </label>
            <label className="check">
              <input type="checkbox" checked={allowPartial}
                     onChange={(e) => setAllowPartial(e.target.checked)} />
              Plan what it can, and list the rest
            </label>
          </div>
          <div className="form-row">
            <OriginInputs prefer={prefer} exclude={exclude} setPrefer={setPrefer} setExclude={setExclude} />
          </div>
          <div className="planner-actions">
            <button type="button" className="btn btn-ghost" onClick={() => { setText(RECIPE_SAMPLE); setTextEmpty(false); }}>
              Use the sample
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setImporting(true)}>
              <Icon name="link" size={16} />Import a recipe
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {planning === '__nl__' ? 'Planning…' : 'Plan my shopping'}
            </button>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 className="card-title">Plan a week of dinners</h2>
        <p className="card-sub">
          Picks dinners from the recipe library, merges the basket so shared ingredients are
          bought once, and keeps the total under the budget when one is given. Want to choose the
          recipes and days yourself? <a href={hrefFor({ name: 'plan' })}>Open your plan</a>.
        </p>
        <form className="form-row" onSubmit={(e) => { e.preventDefault(); void onPlanWeek(); }}>
          <label>
            Dinners
            <input type="number" min={1} max={14} value={days}
                   onChange={(e) => setDays(Number(e.target.value))} />
          </label>
          <label>
            Budget ($)
            <input type="number" min={1} step="0.01" placeholder="optional" value={budget}
                   onChange={(e) => setBudget(e.target.value)} />
          </label>
          <label>
            Leave out diet tags
            <input value={excludeTags} onChange={(e) => setExcludeTags(e.target.value)}
                   placeholder="dairy, gluten" />
          </label>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {planning === '__week__' ? 'Planning…' : 'Plan my week'}
          </button>
        </form>
      </section>

      <section aria-labelledby={libraryId}>
        <h2 id={libraryId} className="ws-section-title">Plan a recipe from the library</h2>
        <p className="card-sub">
          Priced at stores near the shopping place above, within its distance; with the server
          default and no distance, at catalog prices without stores.
        </p>
        <ul className="recipes">
          {recipes.map((r) => (
            <li key={r.slug} className={`card${plan?.recipe_slug === r.slug ? ' card-active' : ''}`}>
              <h3 className="card-title">{r.name}</h3>
              <p className="card-sub">serves {r.servings} · {r.ingredients.length} ingredients</p>
              <p className="card-ings">{r.ingredients.map((i) => i.name).join(', ')}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void onPlanRecipe(r.slug)}
                      disabled={busy}>
                {planning === r.slug ? 'Planning…' : 'Plan shopping'}<span className="sr-only"> for {r.name}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <ErrorBanner error={planError && `Planning failed: ${planError}`}
                   hint={<>Planning calls the server's LLM. If the model is unavailable or over quota, switch to demo mode in <a href={SYSTEM}>Workshop › System</a>.</>} />
      {planAbort && <AbortAlert execution={planAbort} />}
      {plan && <PlanView plan={plan} />}
      {week && <WeekView week={week} actions={<OpenInMealPlan week={week} />} />}

      <ImportSheet open={importing} onClose={() => setImporting(false)} onPlanned={onImported}
                   planOptions={specOptions} />
    </div>
  );
}
