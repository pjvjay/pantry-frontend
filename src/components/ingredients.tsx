// The wizard's Ingredients stage: for every chosen recipe, each ingredient as the plan would buy
// it (/mealplan/basket): the product, the store and how far it is, the price, where it is from
// and its labels, with the basket's total next to the budget. Choosing an ingredient opens its
// Options across the whole plan (components/tripoptions.tsx with no trip): the products that
// could take its place, ranked, and the recipes a choice changes; one choice pins every line
// that buys it, as one undo step.
//
// An ingredient the plan cannot buy nearby says why (only products from a country the plan
// leaves out, none stocked, none within the distance), and Schedule waits until each one has an
// answer: other meals (back to Meals), another product (its Options), or "skip this ingredient"
// (the recipe goes without it). The words are in mealplan/basket.ts.
import { useId, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { basketAtLeast, basketView, unansweredGroups } from '../mealplan/basket';
import type { LineView, RecipeView } from '../mealplan/basket';
import { againstBudget } from '../mealplan/catalog';
import { USABLE_RESOLVE, budgetOf, recipeTitle } from '../mealplan/model';
import { useMealPlan } from '../mealplan/store';
import type { KeyedCall } from '../mealplan/store';
import type { MealBasket } from '../types';
import { Icon } from './icons';
import { ServingsPrompt } from './mealtray';
import { ProductPicture, RecipePicture } from './pictures';
import { STORES_HEAD, StoresPanel } from './stores';
import { TripLineOptionsDialog } from './tripoptions';

type Open = (lineKey: string, productId: number, name: string) => void;

// One ingredient as a row: its product's picture, its name and the product, the price, then the
// need, store and cost, its origin and labels. The row is one button that opens the
// ingredient's Options (its words name the product and price; the rest describes it), so a
// click anywhere on it, Enter or Space open them. A row the plan cannot buy is tinted, with an
// edge, a warning sign and what is wrong in bold, and its answers under it, outside the button.
// With no product there are no Options to open: the row is not a button, and its answers say
// what can be done. onStores: to "Your stores", for an ingredient sold only at stores turned off.
function Line({ l, title, onOptions, onMeals, onStores }: { l: LineView; title: string; onOptions: Open;
  onMeals: () => void; onStores: () => void }) {
  const mp = useMealPlan();
  const facts = useId();
  const skip = (yes: boolean) => mp.dispatch({ type: 'skipLine', recipeKey: l.recipeKey, lineNo: l.lineNo,
    ingredient: l.ingredient, skip: yes });
  const open = () => { if (l.productId !== null) onOptions(l.key, l.productId, l.product ?? l.ingredient); };
  const meta = [l.need, l.available ? l.store : '', l.available ? l.cost : ''].filter(Boolean).join(' · ');
  const body = (
    <>
      <ProductPicture product={l.productName} ingredient={l.ingredient} />
      <span className="mp-ing-main">
        <span className="mp-ing-title">
          <span className="mp-ing-name">{l.ingredient}</span>
          <span className="mp-ing-product">{l.product ?? 'nothing chosen'}</span>
        </span>
        <span id={facts} className="mp-ing-about">
          {l.issue && (
            <span className="mp-ing-issue">
              <Icon name="alert" size={16} />
              <strong>{l.skipped ? `Skipped: ${l.issue.label.charAt(0).toLowerCase()}${l.issue.label.slice(1)}` : l.issue.label}</strong>
            </span>
          )}
          {meta && <span className="mp-ing-meta">{meta}</span>}
          <span className="mp-ing-facts">
            <span className={l.origin.flag ? 'cart-flag' : 'muted'}>{l.origin.text}</span>
            {l.labels.map((x) => <span key={x} className="chip chip-muted">{x}</span>)}
            {l.pinned && <span className="chip chip-ok">your choice</span>}
            {l.shared && <span className="muted">{l.shared}</span>}
          </span>
        </span>
      </span>
      <span className="mp-ing-side">
        {l.available && <span className="mp-ing-price">{l.price}</span>}
        {l.productId !== null && <span className="mp-ing-go" aria-hidden="true">Options ›</span>}
      </span>
    </>
  );
  const cls = `mp-ing${l.issue ? ' mp-ing-missing' : ''}${l.skipped ? ' mp-ing-skipped' : ''}`;
  return (
    <li className={cls}>
      {l.productId !== null ? (
        <button type="button" className="mp-ing-open" aria-haspopup="dialog" aria-label={l.optionsLabel}
                aria-describedby={facts} data-ing-line={l.key} onClick={open}>
          {body}
        </button>
      ) : <div className="mp-ing-open">{body}</div>}
      {!l.available && (
        <div className="mp-ing-answer" role="group" aria-label={`${l.ingredient}: not sold nearby`}>
          {l.skipped ? <span className="muted">{title} goes without it.</span>
            : l.why && <span className="mp-ing-why">{l.why}.</span>}
          {/* the skip button stays where it is whichever it says, so focus stays on it */}
          {!l.skipped && l.kind === 'stores_off' && (
            <button type="button" className="secondary mini" onClick={onStores}>Turn a store back on</button>
          )}
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

function RecipeIngredients({ r, onOptions, onMeals, onStores }: { r: RecipeView; onOptions: Open; onMeals: () => void;
  onStores: () => void }) {
  const head = useId();
  return (
    <section className="mp-ing-recipe" aria-labelledby={head}>
      <div className="mp-ing-recipe-head">
        <RecipePicture pic={r.picture} slot={r.slot} size="head" />
        <div>
          <h3 id={head} className="mp-ing-recipe-title">{r.title}</h3>
          <p className="mp-ing-recipe-sub">
            {r.meals} {r.meals === 1 ? 'meal' : 'meals'} · {r.lines.length} {r.lines.length === 1 ? 'ingredient' : 'ingredients'}
            {r.unanswered > 0 && <span className="cart-flag"> · {r.unanswered} to answer</span>}
          </p>
        </div>
      </div>
      {r.meals === 0 && <p className="muted">No meals of it in the plan: nothing is bought for it.</p>}
      {r.lines.length === 0 && <p className="muted">No ingredients to show yet.</p>}
      <ul className="mp-ing-lines">
        {r.lines.map((l) => (
          <Line key={l.key} l={l} title={r.title} onOptions={onOptions} onMeals={onMeals} onStores={onStores} />
        ))}
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

  // "Turn a store back on": the stores panel, its heading focused
  const toStores = () => {
    const h = document.getElementById(STORES_HEAD);
    h?.scrollIntoView({ block: 'start' });
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
  };
  if (!keys.length) {
    return (
      <>
        <StoresPanel />
        <p className="mp-empty">No recipes yet. <button type="button" className="linkish" onClick={onMeals}>Add meals</button></p>
      </>
    );
  }
  return (
    <>
      <StoresPanel />
      <p className="muted">
        Each recipe's ingredients as your trips would buy them, from the stores above. Choose an
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
            {view.unanswered.length === 1 ? '1 ingredient' : `${view.unanswered.length} ingredients`} the plan
            cannot buy near you.
          </strong>{' '}
          {unansweredGroups(view.unanswered).map((g) => (
            <span key={g.heading}>
              {g.heading}: {g.lines.map((l) => `${l.ingredient} (${recipeTitle(mp.state, l.recipeKey)})`).join(', ')}.{' '}
            </span>
          ))}
          For each, choose another product, skip it
          {view.unanswered.some((l) => l.kind === 'stores_off') && ', turn a store back on'}, or go back to Meals for
          other recipes.{' '}
          <button type="button" className="secondary mini" onClick={onMeals}>Back to meals</button>
        </div>
      )}

      {view?.recipes.map((r) => (
        <RecipeIngredients key={r.key} r={r} onMeals={onMeals} onStores={toStores}
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
