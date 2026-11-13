// Options on a meal-plan trip line: the chat cart's Options dialog (components/alternatives.tsx)
// fed by pantry-api's /mealplan/alternatives over REST, so it works wherever the Meal plan does,
// with no hub (the Hugging Face Space, AKS). The rows are pantry-api's ranking for every recipe
// line the purchase covers, each with what choosing it does to the plan's trips.
//
// "Use this" pins the product on each of those lines as one edit, so one Undo puts it back. The
// plan as it would be is scheduled first (no model call): a choice pantry-api refuses says why in
// the dialog and changes nothing, and otherwise that answer is shown at once. Focus then returns
// to the trip line that now buys the chosen product.
//
// With no date (the wizard's Check ingredients stage) the dialog is for an ingredient across the whole
// plan: the ranking has no trip cost, the words name the recipes a choice changes, and focus
// returns to the ingredient it was opened from (returnTo). An ingredient the plan buys nothing
// for is asked by its recipe line (line mode): "Options for X: nothing chosen yet", the rows that
// can be chosen, the ones out of reach (only at a store turned off, only beyond the distance, or
// stocked nowhere) with where they are sold, the nearest offer and a button that brings each in,
// the ones held back by the origin rule with their evidence, and when nothing can be chosen, the
// row's own answers.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { scheduleMealPlan, tripLineOptions } from '../api';
import { strategyOf } from '../mealplan/board';
import { step } from '../mealplan/model';
import { countryRules } from '../mealplan/origin';
import {
  choiceAnnouncement, chosenLineKey, lineChoices, nearestText, nothingText, optionsDescription, optionsEdit,
  optionsRequest, optionsTitle, reachText, stockNotice, storesToTurnOn, tripLineKey,
} from '../mealplan/options';
import type { OptionsAsk } from '../mealplan/options';
import { useMealPlan } from '../mealplan/store';
import { distanceLabel, widerDistance } from '../mealplan/stores';
import type { MealStores, OutOfReachRow, TripLineOptions } from '../types';
import { AlternativesDialog } from './alternatives';
import { ProductPicture } from './pictures';

// A recipe line with no product, opened in line mode, and the row's own answers for the sheet
// when nothing can be chosen: back to Pick meals, skip it or need it after all, and Your stores.
export interface LineAsk {
  recipeKey: string;
  lineNo: number;
  ingredient: string;
  skipped: boolean;
  onMeals: () => void;
  onStores: () => void;
  stores: MealStores | null;
}

export function TripLineOptionsDialog({ date, productId, productName, onClose, returnTo, line = null }: {
  // null: across the whole plan, with no trip
  date: string | null;
  // across the plan: where focus goes on close (the ingredient opened from, whose answer
  // buttons a choice may take away), instead of the element that opened the dialog
  returnTo?: RefObject<HTMLElement | null>;
  // null with no line: closed
  productId: number | null;
  productName: string;
  onClose: () => void;
  // a line with no product (Check ingredients), asked by its recipe line
  line?: LineAsk | null;
}) {
  const mp = useMealPlan();
  const strategy = mp.state.draft.prefs.strategy;
  const [opts, setOpts] = useState<TripLineOptions | null>(null);
  // The draft the next load sends: the latest, not the one of the render that made `load`.
  const draft = useRef(mp.state.draft);
  draft.current = mp.state.draft;
  const ask: OptionsAsk | null = productId !== null ? { productId }
    : line ? { line: { recipeKey: line.recipeKey, lineNo: line.lineNo } } : null;

  // The trip line focus returns to: the one the dialog was opened from, or after a choice the
  // line that now buys the chosen product (a new element, found by its data-trip-line).
  const focusKey = useRef('');
  const openKey = productId !== null ? tripLineKey(date, productId) : line ? `line:${line.recipeKey}|${line.lineNo}` : '';
  useEffect(() => {
    if (openKey) focusKey.current = openKey;
    setOpts(null);
  }, [openKey]);
  const returnFocus = useMemo<RefObject<HTMLElement | null>>(() => ({
    get current() {
      return focusKey.current
        ? document.querySelector<HTMLElement>(`[data-trip-line="${focusKey.current}"]`) : null;
    },
  }), []);
  // across the plan: the ingredient it was opened from, which stays where it is
  const opener = useMemo<RefObject<HTMLElement | null>>(() => ({ current: null }), []);

  const load = (limit: number) => tripLineOptions(optionsRequest(draft.current, ask as OptionsAsk, date, strategy,
    limit)).then((o) => {
    setOpts(o);
    return o.ranking;
  });

  const choose = async (chosen: number | null) => {
    if (!opts) return;
    const edit = optionsEdit(opts.lines, chosen, mp.state.draft.pins);
    if (!edit) {
      onClose();
      return;
    }
    // What the edit will make, the next rev, scheduled before anything changes.
    const trial = step(mp.state, edit);
    if (trial.refused) throw new Error(trial.refused);
    const answer = await scheduleMealPlan(trial.state.draft);
    const before = date ? strategyOf(mp.schedule.answer, strategy)?.trips.find((t) => t.date === date) : undefined;
    const after = date ? strategyOf(answer, strategy)?.trips.find((t) => t.date === date) : undefined;
    const pick = chosen ?? opts.lines[0]?.planner_product_id ?? null;
    // the planner's own pick may have no row (no store in range sells it): its line names it
    const name = opts.ranking.items.find((it) => it.product_id === pick)?.product
      ?? after?.lines.find((ln) => ln.product.id === pick)?.product.name ?? 'the planner’s pick';
    const out = mp.dispatch(edit);
    if (out.refused) throw new Error(out.refused);
    focusKey.current = chosenLineKey(opts, chosen);
    mp.adoptSchedule(answer);
    mp.announce(choiceAnnouncement(opts, name, before, after));
    onClose();
  };

  const ingredient = opts?.ranking.ingredient || line?.ingredient || productName;
  const choices = opts && opts.product_id === null ? lineChoices(opts.ranking) : null;
  const maxKm = mp.state.draft.settings.max_km;

  // A row out of reach, with where it is sold and what would bring it in: its store turned back
  // on, or a longer distance. Either is an undoable edit; the sheet then asks again.
  const reachRow = (x: OutOfReachRow) => {
    const turnOn = storesToTurnOn(x, line?.stores ?? null);
    const km = x.why === 'out_of_range' ? widerDistance(maxKm, x.nearest?.distance_km ?? null) : undefined;
    const near = nearestText(x);
    const others = x.stores.filter((n) => n !== x.nearest?.store);
    return (
      <li key={x.product_id} className="alt-reach-row">
        <ProductPicture product={x.product} ingredient={ingredient} />
        <span className="alt-reach-what">
          <strong>{x.product}</strong>
          <span className="alt-reach-why">{reachText(x, maxKm)}</span>
          {near && <span className="alt-reach-near">Nearest: {near}</span>}
          {x.why !== 'stores_off' && others.length > 0 && (
            <span className="alt-reach-near">Also at {others.join(', ')}</span>
          )}
        </span>
        {turnOn.map((st) => (
          <button key={st.id} type="button" className="btn btn-secondary btn-sm"
                  onClick={() => mp.dispatch({ type: 'setStoreOff', storeId: st.id, name: st.name, off: false })}>
            Turn {st.name} back on
          </button>
        ))}
        {x.why === 'stores_off' && !turnOn.length && line && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onClose(); line.onStores(); }}>
            Your stores
          </button>
        )}
        {km !== undefined && (
          <button type="button" className="btn btn-secondary btn-sm"
                  onClick={() => mp.dispatch({ type: 'setSettings', settings: { max_km: km } })}>
            {km === null ? 'Go any distance' : `Go up to ${distanceLabel(km)}`}
          </button>
        )}
      </li>
    );
  };

  const extra = choices && choices.outOfReach.length > 0 && (
    <section className="alt-section alt-section-reach" aria-label="Out of reach">
      <h3>Out of reach as your plan stands</h3>
      <ul className="alt-reach">{choices.outOfReach.map(reachRow)}</ul>
    </section>
  );

  const empty = line && choices && (
    <div className="alt-nothing" role="note">
      <p>{nothingText(ingredient, choices)}</p>
      <div className="alt-nothing-actions">
        {!line.skipped && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { onClose(); line.onMeals(); }}>Back to Pick meals</button>
        )}
        <button type="button" className="btn btn-secondary btn-sm"
                onClick={() => mp.dispatch({ type: 'skipLine', recipeKey: line.recipeKey, lineNo: line.lineNo,
                  ingredient: line.ingredient, skip: !line.skipped })}>
          {line.skipped ? 'Need it after all' : 'Skip this ingredient'}
        </button>
      </div>
    </div>
  );

  return (
    <AlternativesDialog
      conversationId={null}
      target={ask === null ? null : {
        ref: 0, pinned: opts?.pinned ?? false,
        line: { line_no: productId ?? line?.lineNo ?? 0, product: productName, ingredient },
      }}
      blocked=""
      returnFocus={date ? returnFocus : returnTo ?? opener}
      onChoose={choose}
      onClose={onClose}
      load={load}
      loadKey={`${openKey}@${mp.state.draft.rev}`}
      place={date ? 'trip' : 'plan'}
      rules={countryRules(mp.state.draft.settings)}
      title={productId === null && line ? optionsTitle(ingredient, false) : undefined}
      description={opts ? optionsDescription(opts) : undefined}
      notice={opts ? stockNotice(opts) : ''}
      empty={empty || undefined}
      extra={extra || undefined}
    />
  );
}
