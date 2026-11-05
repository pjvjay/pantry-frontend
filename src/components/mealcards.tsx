// The wizard's Meals stage: recipes to add, as cards in Breakfast, Lunch and Dinner sections
// (Snack collapsed), from /mealplan/catalog for the household's diet, avoid-tags and area. A
// card says the recipe's diet, what one more meal of it adds to the plan's cost, and what cannot
// be bought nearby (and whether only the origin rule stops it); Add and the count stepper put
// meals in the plan. A budget bar stays at the top while the page scrolls: the budget, the
// estimated spend, what is left, and the slots filled. An Add that would pass the budget cannot
// be pressed and says by how much; recipes that do not fit the diet are counted under "n hidden
// by your diet". Quick add, Import a recipe and the shopper's own recipes stay below, as other
// ways to add.
//
// The spend is the selection in whole packs, as trips buy it, so it is close to what Ingredients
// and the Shopping plan show. The arithmetic is in mealplan/catalog.ts.
import { useEffect, useId, useMemo, useState } from 'react';

import {
  addCheck, addCost, addCostText, budgetBar, budgetBarText, budgetSaid, byKey, catalogSections, cleanRef,
  costPerMealText, dietBadge, estimateText, estimatedSpend, hiddenText, isMine, money, notInCatalog, ownRecipes,
  picksOf, unavailableText,
} from '../mealplan/catalog';
import type { Pick, Spend } from '../mealplan/catalog';
import { recipePicture } from '../mealplan/images';
import { budgetOf, docRef, mealsOf, recipeTitle } from '../mealplan/model';
import type { PlanEdit } from '../mealplan/model';
import { addStop } from '../mealplan/room';
import { useCatalog, useMealPlan } from '../mealplan/store';
import type { CatalogRecipe } from '../types';
import { ImportSheet } from './ImportSheet';
import { AddRecipes, QuickAdd } from './mealtray';
import { RecipePicture } from './pictures';

// ─── The budget bar ──────────────────────────────────────────

// pending: the recipes' prices have not arrived yet, so the figures would be "$0.00".
function BudgetBar({ spend, pending }: { spend: Spend; pending: boolean }) {
  const mp = useMealPlan();
  const bar = budgetBar(mp.state, spend);
  const t = pending ? { ...budgetBarText(bar), spent: 'estimating…', remaining: '…' } : budgetBarText(bar);
  const over = bar.remaining !== null && bar.remaining < 0;
  const used = bar.budget ? Math.min(100, Math.round((bar.spent / bar.budget) * 100)) : 0;
  return (
    <div className={`mp-budget${over ? ' mp-budget-over' : ''}`} role="group" aria-label="Budget and slots">
      <dl className="mp-budget-figures">
        <div><dt>Budget</dt><dd>{t.budget}</dd></div>
        <div><dt>Estimated</dt><dd>{t.spent}</dd></div>
        <div><dt>Remaining</dt><dd className={over ? 'cart-flag' : undefined}>{over && <span aria-hidden="true">⚠ </span>}{t.remaining}</dd></div>
        <div><dt>Slots</dt><dd>{t.slots}</dd></div>
      </dl>
      {bar.budget !== null && (
        <div className="mp-budget-meter" aria-hidden="true"><span style={{ width: `${used}%` }} /></div>
      )}
    </div>
  );
}

// ─── A recipe card ───────────────────────────────────────────

// spend and picks: the plan's selection as it is, which what one more meal adds depends on.
function RecipeCard({ r, spend, picks, onAdd }: { r: CatalogRecipe; spend: Spend; picks: Pick[];
  onAdd: (r: CatalogRecipe) => void }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const overId = useId();
  const inPlan = d.recipes[r.key];
  const meals = inPlan ? mealsOf(d, r.key).length : 0;
  const adds = addCost(picks, r);
  const check = addCheck(budgetOf(d.prefs), spend, adds?.cost ?? null);
  const cannot = unavailableText(r, d.settings.exclude_origin ?? []);
  const badge = dietBadge(r.diets);
  // the shopper's own recipe as saved here, with the picture its import kept
  const ownDoc = isMine(r) ? mp.myRecipes.find((x) => x.key === r.key) ?? inPlan?.ref.doc ?? r.ref.doc : null;
  // the meal's places first, then the budget: both are said when both stop it
  const full = addStop(d, inPlan?.slot ?? r.slot, inPlan?.wanted ?? 0);
  const over = check.ok ? null : money(check.over);
  const blocked = over && `would go ${over} over the budget`;
  const addProps = {
    'aria-disabled': blocked || full ? true : undefined,
    'aria-describedby': blocked || full ? overId : undefined,
    onClick: () => { if (!blocked && !full) onAdd(r); },
  } as const;
  return (
    <li className={`mp-card${inPlan ? ' mp-card-in' : ''}`}>
      <RecipePicture pic={recipePicture(r.image, ownDoc)} slot={r.slot} size="card" />
      <div className="mp-card-head">
        <strong className="mp-card-title">{r.title}</strong>
        {badge && <span className="chip chip-ok">{badge}</span>}
        {isMine(r) && <span className="chip chip-muted">my recipe</span>}
      </div>
      <div className="mp-card-cost">
        {addCostText(adds)}
        {r.est_cost_per_meal !== null && <span className="muted"> · {costPerMealText(r)}</span>}
      </div>
      {r.contains.length > 0 && <div className="muted mp-card-note">contains {r.contains.join(', ')}</div>}
      {!r.fits && <div className="cart-flag mp-card-note">Not for your diet: {r.why_not ?? 'it does not fit'}.</div>}
      {cannot.map((t) => <div key={t} className="cart-flag mp-card-note">{t}</div>)}
      <div className="mp-card-ctl">
        {inPlan ? (
          <span className="mp-stepper">
            <button type="button" className="secondary mini" aria-label={`One ${r.title} meal fewer`}
                    disabled={inPlan.wanted <= 0}
                    onClick={() => mp.dispatch({ type: 'setWanted', key: r.key, wanted: inPlan.wanted - 1 })}>−</button>
            <output aria-label={`${r.title} meals`}>{meals}</output>
            <button type="button" className="secondary mini" aria-label={`One ${r.title} meal more`}
                    data-more={r.key} {...addProps}>+</button>
          </span>
        ) : (
          <button type="button" className="mini" aria-label={`Add ${r.title}`} {...addProps}>+ Add</button>
        )}
        {(full || blocked) && (
          <span id={overId} className="mp-card-over">
            {full && <span className="mp-card-full">{full}.</span>}
            {full && blocked && ' '}
            {blocked && <span className="cart-flag">{full ? `It would also go ${over} over the budget.` : blocked}</span>}
          </span>
        )}
      </div>
    </li>
  );
}

function Hidden({ list }: { list: CatalogRecipe[] }) {
  if (!list.length) return null;
  return (
    <details className="mp-hidden">
      <summary>{hiddenText(list.length)}</summary>
      <ul>{list.map((r) => <li key={r.key}>{r.title}: <span className="muted">{r.why_not ?? 'does not fit'}</span></li>)}</ul>
    </details>
  );
}

// ─── The stage ───────────────────────────────────────────────

export function MealsStage({ quickText, setQuickText }: { quickText: string; setQuickText: (t: string) => void }) {
  const mp = useMealPlan();
  const catalog = useCatalog(true);
  const [importing, setImporting] = useState(false);
  // An Add turns the card's button into a count: focus goes to its "+", not the page.
  const [focusMore, setFocusMore] = useState<{ key: string } | null>(null);
  useEffect(() => {
    if (focusMore) document.querySelector<HTMLElement>(`[data-more="${CSS.escape(focusMore.key)}"]`)?.focus();
  }, [focusMore]);
  const recipes = useMemo(() => byKey(catalog.answer), [catalog.answer]);
  const spend = estimatedSpend(mp.state, recipes);
  const picks = picksOf(mp.state, recipes);
  const c = catalog.answer;
  const sections = c ? catalogSections(c, mp.state) : [];
  const own = c ? ownRecipes(c, mp.state) : { shown: [], hidden: [] };
  const others = c ? notInCatalog(c, mp.state) : [];

  // One more meal of a recipe: the first adds it to the plan with one meal. The live region
  // hears what changed and what is left of the budget after it.
  const add = (r: CatalogRecipe) => {
    const inPlan = mp.state.draft.recipes[r.key];
    // the shopper's own recipe goes in as saved here, its picture and all
    const own = isMine(r) ? mp.myRecipes.find((x) => x.key === r.key) : undefined;
    const edit: PlanEdit = inPlan ? { type: 'setWanted', key: r.key, wanted: inPlan.wanted + 1 }
      : { type: 'addRecipe', ref: own ? docRef(own) : cleanRef(r.ref), title: r.title, slot: r.slot, wanted: 1 };
    const out = mp.dispatch(edit);
    if (out.refused) return;
    if (!inPlan) setFocusMore({ key: r.key });
    const left = budgetSaid(budgetBar(out.state, estimatedSpend(out.state, recipes)));
    if (left) mp.announce(`${out.said} ${left}`);
  };

  return (
    <>
      <BudgetBar spend={spend} pending={!c} />
      {c && spend.unknown.length > 0 && (
        <p className="muted">Not in the estimate (cost unknown): {spend.unknown.join(', ')}.</p>
      )}
      {catalog.status === 'checking' && !c && <p className="muted" role="status">Loading the recipes…</p>}
      {catalog.status === 'error' && (
        <div className="banner banner-error" role="alert">
          The recipes could not be loaded: {catalog.error}{' '}
          <button type="button" className="mini" onClick={catalog.retry}>Try again</button>
          <div className="banner-hint">The lists below still add recipes, without estimates.</div>
        </div>
      )}
      {c && <p className="muted mp-est-basis">{estimateText(spend)}</p>}

      {sections.map((sec) => {
        const head = (
          <>
            {sec.label}{' '}
            <span className="muted">
              · {sec.count.filled} of {sec.count.capacity} filled
              {sec.overflow > 0 && `; ${sec.overflow} more than the days hold will wait in the tray`}
            </span>
          </>
        );
        const body = (
          <>
            {sec.shown.length > 0 ? (
              <ul className="mp-cards">
                {sec.shown.map((r) => <RecipeCard key={r.key} r={r} spend={spend} picks={picks} onAdd={add} />)}
              </ul>
            ) : <p className="muted">No {sec.label.toLowerCase()} recipes fit your diet.</p>}
            <Hidden list={sec.hidden} />
          </>
        );
        return sec.collapsed ? (
          <details key={sec.slot} className="mp-section" open={sec.count.meals > 0 || undefined}>
            <summary><h3 className="mp-section-head">{head}</h3></summary>
            {body}
          </details>
        ) : (
          <section key={sec.slot} className="mp-section" aria-label={sec.label}>
            <h3 className="mp-section-head">{head}</h3>
            {body}
          </section>
        );
      })}

      {others.length > 0 && (
        <section className="mp-section" aria-label="Also in this plan">
          <h3 className="mp-section-head">Also in this plan</h3>
          <ul className="mp-add-list">
            {others.map((k) => {
              const r = mp.state.draft.recipes[k];
              const title = recipeTitle(mp.state, k);
              const full = addStop(mp.state.draft, r.slot, r.wanted);
              return (
                <li key={k}>
                  <span>{title} <span className="muted">· cost not estimated</span></span>
                  <span className="mp-stepper">
                    <button type="button" className="secondary mini" aria-label={`One ${title} meal fewer`}
                            disabled={r.wanted <= 0}
                            onClick={() => mp.dispatch({ type: 'setWanted', key: k, wanted: r.wanted - 1 })}>−</button>
                    <output aria-label={`${title} meals`}>{mealsOf(mp.state.draft, k).length}</output>
                    <button type="button" className="secondary mini" aria-label={`One ${title} meal more`}
                            aria-disabled={full ? true : undefined} aria-describedby={full ? `mp-full-${k}` : undefined}
                            onClick={() => { if (!full) mp.dispatch({ type: 'setWanted', key: k, wanted: r.wanted + 1 }); }}>+</button>
                    <button type="button" className="linkish" aria-label={`Remove ${title} from the plan`}
                            onClick={() => mp.dispatch({ type: 'removeRecipe', key: k })}>remove</button>
                    {full && <span id={`mp-full-${k}`} className="mp-card-full">{full}.</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="mp-more" aria-labelledby="mp-more-head">
        <h3 id="mp-more-head" className="mp-section-head">Other ways to add</h3>
        <QuickAdd text={quickText} setText={setQuickText} />
        <div className="mp-toolbar mp-file">
          <button type="button" className="secondary mini" aria-haspopup="dialog"
                  onClick={() => setImporting(true)}>Import a recipe…</button>
        </div>
        {c ? (
          <>
            <h4>My recipes</h4>
            {mp.myRecipesProblem && <p className="cart-flag">{mp.myRecipesProblem}</p>}
            {own.shown.length > 0 ? (
              <ul className="mp-cards">
                {own.shown.map((r) => <RecipeCard key={r.key} r={r} spend={spend} picks={picks} onAdd={add} />)}
              </ul>
            ) : (
              <p className="muted">None yet. Recipes you import or paste are saved in this browser and appear here.</p>
            )}
            <Hidden list={own.hidden} />
          </>
        ) : catalog.status === 'error' && <AddRecipes />}
      </section>

      {/* "Add to meal plan" in the sheet leaves the recipe in the inbox; it joins the plan here */}
      <ImportSheet open={importing} onClose={() => { setImporting(false); mp.syncSaved(); }} />
    </>
  );
}
