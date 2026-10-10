// The wizard's Ingredients stage: for every chosen recipe, each ingredient as the plan would buy
// it (/mealplan/basket): the product, the store and how far it is, the price, where it is from
// and its labels, with the basket's total next to the budget. Choosing an ingredient opens its
// Options across the whole plan (components/tripoptions.tsx with no trip): the products that
// could take its place, ranked, and the recipes a choice changes; one choice pins every line
// that buys it, as one undo step.
//
// An ingredient no store nearby sells is said so, and Schedule waits until each one has an
// answer: other meals (back to Meals), another product (its Options), or "skip this ingredient"
// (the recipe goes without it). The words are in mealplan/basket.ts.
import { useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { basketAtLeast, basketView } from '../mealplan/basket';
import type { LineView, RecipeView } from '../mealplan/basket';
import { againstBudget } from '../mealplan/catalog';
import { USABLE_RESOLVE, budgetOf, recipeTitle } from '../mealplan/model';
import { useMealPlan } from '../mealplan/store';
import type { KeyedCall } from '../mealplan/store';
import type { MealBasket } from '../types';
import { ServingsPrompt } from './mealtray';
import { TripLineOptionsDialog } from './tripoptions';

type Open = (lineKey: string, productId: number, name: string) => void;

function Line({ l, title, onOptions, onMeals }: { l: LineView; title: string; onOptions: Open; onMeals: () => void }) {
  const mp = useMealPlan();
  const skip = (yes: boolean) => mp.dispatch({ type: 'skipLine', recipeKey: l.recipeKey, lineNo: l.lineNo,
    ingredient: l.ingredient, skip: yes });
  const open = () => { if (l.productId !== null) onOptions(l.key, l.productId, l.product ?? l.ingredient); };
  return (
    <li className={`mp-ing${l.available ? '' : ' mp-ing-missing'}${l.skipped ? ' mp-ing-skipped' : ''}`}>
      <div className="mp-ing-head">
        {l.productId !== null ? (
          <button type="button" className="mp-ing-open" aria-haspopup="dialog" aria-label={l.optionsLabel}
                  data-ing-line={l.key} onClick={open}>
            <span className="mp-ing-name">{l.ingredient}</span>
            <span className="mp-ing-product">{l.product}</span>
            <span aria-hidden="true"> ›</span>
          </button>
        ) : (
          <span className="mp-ing-name">{l.ingredient} <span className="muted">· nothing chosen</span></span>
        )}
        <span className="mp-ing-price">{l.available ? l.price : ''}</span>
      </div>
      <div className="muted">
        {[l.need, l.available ? l.store : '', l.available ? l.cost : ''].filter(Boolean).join(' · ')}
      </div>
      <div className="mp-ing-facts">
        <span className={l.origin.flag ? 'cart-flag' : 'muted'}>{l.origin.text}</span>
        {l.labels.map((x) => <span key={x} className="chip chip-muted">{x}</span>)}
        {l.pinned && <span className="chip chip-ok">your choice</span>}
        {l.shared && <span className="muted">{l.shared}</span>}
      </div>
      {!l.available && (
        <div className="mp-ing-answer" role="group" aria-label={`${l.ingredient}: not sold nearby`}>
          <span className={l.skipped ? 'muted' : 'cart-flag'}>
            {l.skipped ? `Skipped: ${title} goes without it.` : `Not sold nearby: ${l.why}.`}
          </span>
          {/* the skip button stays where it is whichever it says, so focus stays on it */}
          {!l.skipped && <button type="button" className="secondary mini" onClick={onMeals}>Back to meals</button>}
          {!l.skipped && l.productId !== null && (
            <button type="button" className="secondary mini" aria-haspopup="dialog" onClick={open}>Another product</button>
          )}
          <button type="button" className="secondary mini" onClick={() => skip(!l.skipped)}>
            {l.skipped ? 'Need it after all' : 'Skip this ingredient'}
          </button>
        </div>
      )}
    </li>
  );
}

function RecipeIngredients({ r, onOptions, onMeals }: { r: RecipeView; onOptions: Open; onMeals: () => void }) {
  return (
    <section className="mp-ing-recipe" aria-label={r.title}>
      <h3 className="mp-section-head">
        {r.title} <span className="muted">· {r.meals} {r.meals === 1 ? 'meal' : 'meals'}</span>
        {r.unanswered > 0 && <span className="cart-flag"> · {r.unanswered} to answer</span>}
      </h3>
      {r.meals === 0 && <p className="muted">No meals of it in the plan: nothing is bought for it.</p>}
      {r.lines.length === 0 && <p className="muted">No ingredients to show yet.</p>}
      <ul className="mp-ing-lines">
        {r.lines.map((l) => <Line key={l.key} l={l} title={r.title} onOptions={onOptions} onMeals={onMeals} />)}
      </ul>
    </section>
  );
}

export function IngredientsStage({ basket, onMeals }: { basket: KeyedCall<MealBasket>; onMeals: () => void }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const [options, setOptions] = useState<{ productId: number; name: string } | null>(null);
  // The ingredient Options was opened from: focus goes back to its name, which stays whatever
  // the choice (the answer buttons beside it go once it is sold nearby).
  const openedFrom = useRef('');
  const returnTo = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() {
      return openedFrom.current
        ? document.querySelector<HTMLElement>(`[data-ing-line="${CSS.escape(openedFrom.current)}"]`) : null;
    },
  }), []);
  const b = basket.answer;
  const view = b ? basketView(b, mp.state) : null;
  const shown = new Set(view?.recipes.map((r) => r.key) ?? []);
  const keys = Object.keys(d.recipes);
  const total = b ? againstBudget(b.est_total, basketAtLeast(b), budgetOf(d.prefs)) : null;
  // recipes whose products are not checked yet, or could not be
  const waiting = keys.filter((k) => !d.resolved[k] || !USABLE_RESOLVE.includes(d.resolved[k].status));

  if (!keys.length) {
    return <p className="mp-empty">No recipes yet. <button type="button" className="linkish" onClick={onMeals}>Add meals</button></p>;
  }
  return (
    <>
      <p className="muted">
        Each recipe's ingredients as your trips would buy them, from the stores you shop at. Choose an
        ingredient to see the other products that could take its place.
      </p>
      {total && (
        <p className={`mp-total ${total.over ? 'cart-flag' : ''}`}>
          <strong>Basket</strong> {total.text}
          <span className="muted"> · whole packs, each product bought once; trips on different days can cost more</span>
        </p>
      )}
      {basket.status === 'checking' && <p className="muted" role="status">Checking the ingredients…</p>}
      {basket.status === 'error' && (
        <div className="banner banner-error" role="alert">
          The ingredients could not be checked: {basket.error}{' '}
          <button type="button" className="mini" onClick={basket.retry}>Try again</button>
        </div>
      )}

      {waiting.map((k) => {
        const r = d.resolved[k];
        const title = recipeTitle(mp.state, k);
        return (
          <p key={k} className={r || mp.resolve.status === 'error' ? 'cart-flag' : 'muted'}>
            {!r && mp.resolve.status !== 'error' && `Checking the products for ${title}…`}
            {!r && mp.resolve.status === 'error' && `The products for ${title} could not be checked: ${mp.resolve.error}`}
            {r && `${title}: ${r.message || r.status.replace(/_/g, ' ')}`}
            {(r || mp.resolve.status === 'error') && (
              <>
                {' '}
                <button type="button" className="linkish" onClick={() => mp.retryResolve(r ? k : undefined)}>Try again</button>
                {' '}
                <button type="button" className="linkish" onClick={() => mp.dispatch({ type: 'removeRecipe', key: k })}>
                  Take it out
                </button>
              </>
            )}
          </p>
        );
      })}

      {keys.filter((k) => d.resolved[k]?.status === 'needs_servings' && d.recipes[k].servings == null).map((k) => (
        <ServingsPrompt key={k} recipeKey={k} title={recipeTitle(mp.state, k)} />
      ))}

      {view && view.unanswered.length > 0 && (
        <div className="banner banner-update mp-unanswered">
          <strong>
            {view.unanswered.length === 1 ? '1 ingredient is' : `${view.unanswered.length} ingredients are`} not
            sold near you:
          </strong>{' '}
          {view.unanswered.map((l) => `${l.ingredient} (${recipeTitle(mp.state, l.recipeKey)})`).join(', ')}. For
          each, choose another product, skip it, or go back to Meals for other recipes.{' '}
          <button type="button" className="secondary mini" onClick={onMeals}>Back to meals</button>
        </div>
      )}

      {view?.recipes.map((r) => (
        <RecipeIngredients key={r.key} r={r} onMeals={onMeals}
                           onOptions={(key, productId, name) => {
                             openedFrom.current = key;
                             setOptions({ productId, name });
                           }} />
      ))}
      {keys.filter((k) => !shown.has(k) && d.resolved[k] && USABLE_RESOLVE.includes(d.resolved[k].status)).map((k) => (
        <p key={k} className="muted">{recipeTitle(mp.state, k)}: checking its ingredients…</p>
      ))}

      <TripLineOptionsDialog date={null} productId={options?.productId ?? null} productName={options?.name ?? ''}
                             onClose={() => setOptions(null)} returnTo={returnTo} />
    </>
  );
}
