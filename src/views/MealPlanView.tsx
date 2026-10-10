// The Meal plan tab (#/mealplan?step=1..6): six stages under a progress indicator, with Back
// and Next under each.
//   1 Basics:        the period, the budget, the household, its diet and origin rules, where
//                    and when it shops (components/basics.tsx).
//   2 Meals:         recipe cards by meal under a budget bar; Quick add, import and the
//                    shopper's own recipes (components/mealcards.tsx).
//   3 Ingredients:   each recipe's ingredients as the plan would buy them, and an answer for
//                    each one no store nearby sells (components/ingredients.tsx).
//   4 Schedule:      the 7 or 14 day calendar with the tray, drag and drop, Fill empty slots,
//                    Suggest cook days, undo and the nutrition band (components/mealcal.tsx).
//   5 Shopping plan: the trips code suggests, the warnings and their fixes, the total against
//                    the budget (components/mealtrips.tsx).
//   6 Calendar:      times and reminders, the events, the .ics and Google Calendar
//                    (components/CalendarExport.tsx).
// Where a stage opens and what stops Next are decided in mealplan/wizard.ts. The plan lives in
// MealPlanProvider (above the tab switch, so it survives changing tabs) and is saved in this
// browser only. Every change re-runs /mealplan/schedule, which is pure: no model call, and the
// same plan gives the same answer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { BasicsStage, PlanFile, ShoppingSettings } from '../components/basics';
import { CalendarExport, TimingSettings, useTiming } from '../components/CalendarExport';
import { IngredientsStage } from '../components/ingredients';
import { ActionBar, DragGhost, MoveSheet, PlanBoard } from '../components/mealcal';
import type { BoardCtl } from '../components/mealcal';
import { MealsStage } from '../components/mealcards';
import { CookDaysDiff, CoverageChips, ShopPanel, TripSheet, WarningsPanel } from '../components/mealtrips';
import { EXAMPLE_SENTENCE, FirstRunSheet, RecipeTray } from '../components/mealtray';
import { PeriodBand, TargetsEditor } from '../components/nutrition';
import { usePointerDrag } from '../components/usePointerDrag';
import { StageNav, Stepper } from '../components/wizard';
import { unansweredCount } from '../mealplan/basket';
import { strategyOf, summaryLine, tripPriced } from '../mealplan/board';
import { againstBudget } from '../mealplan/catalog';
import { moveConsequence, tripMoveConsequence, warningsFor } from '../mealplan/consequences';
import { addDays, dayLabel } from '../mealplan/dates';
import { dropEdit, keyIntent, parseTarget } from '../mealplan/dnd';
import type { DragEffect, DragPayload } from '../mealplan/dnd';
import { STRATEGY_NAMES, budgetOf, recipeTitle } from '../mealplan/model';
import type { PlanEdit } from '../mealplan/model';
import { pinFix } from '../mealplan/options';
import { useBasket, useMealPlan } from '../mealplan/store';
import { nextBlock, routeStep, stepFromHash, stepHash, stepName, stepTitle, wizardFacts } from '../mealplan/wizard';
import type { StepNo } from '../mealplan/wizard';
import type { RemedyOp } from '../types';

const inText = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// A meal's chip, on the board or in the tray, and a day's trip chip (mealcal.tsx).
const mealChipSelector = (mealId: string) => `[data-meal="${CSS.escape(mealId)}"] .mp-chip-main`;
const tripChipSelector = (date: string) => `[data-trip="${CSS.escape(date)}"] .mp-trip-main`;

// The stage the shopper was on when they last left the tab, for opening it again in this page.
let lastStep: StepNo | null = null;

export default function MealPlanView() {
  const mp = useMealPlan();
  const { state, schedule } = mp;
  const d = state.draft;
  const strategy = d.prefs.strategy;
  const answer = schedule.answer;
  const hasRecipes = Object.keys(d.recipes).length > 0;

  // ─── Stages ──────────────────────────────────────────────
  const basket = useBasket(true);
  const facts = useMemo(() => wizardFacts(state, mp.resolve.status === 'error', {
    state: !hasRecipes || basket.current ? 'ok' : basket.status === 'error' ? 'error' : 'waiting',
    unanswered: unansweredCount(basket.answer, state),
  }), [state, mp.resolve.status, hasRecipes, basket.current, basket.status, basket.answer]);
  const factsRef = useRef(facts);
  factsRef.current = facts;
  const [step, setStep] = useState<StepNo>(() =>
    routeStep(stepFromHash(window.location.hash), facts, lastStep, hasRecipes));
  const stepRef = useRef(step);
  stepRef.current = step;
  // Where focus goes once the next stage is drawn, instead of its heading.
  const focusNext = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef<StepNo | null>(null);

  // A stage asked for by the address (a stepper link, Back and Next, the browser's own Back): no
  // further than the plan allows. '#/mealplan' alone (the tab) keeps the stage shown, and says so.
  useEffect(() => {
    const onHash = () => {
      const asked = stepFromHash(window.location.hash);
      if (asked !== null) setStep(routeStep(asked, factsRef.current, null, true));
      else if (window.location.hash.startsWith('#/mealplan')) {
        window.history.replaceState(null, '', stepHash(stepRef.current));
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // The address always names the stage shown, so a reload or a bookmark comes back to it. This
  // runs after the Calendar stage has read and cleared Google's ?calendar= return.
  useEffect(() => {
    lastStep = step;
    if (window.location.hash.startsWith('#/mealplan') && stepFromHash(window.location.hash) !== step) {
      window.history.replaceState(null, '', stepHash(step));
    }
  }, [step]);

  // A new stage: focus its heading (or what was asked for), so the keyboard and a screen reader
  // start there. Not on the first one: opening the tab leaves focus where it was.
  useEffect(() => {
    if (shown.current === null || shown.current === step) {
      shown.current = step;
      return;
    }
    shown.current = step;
    const target = focusNext.current ? document.querySelector<HTMLElement>(focusNext.current) : null;
    focusNext.current = null;
    (target ?? heading.current)?.focus();
  }, [step]);

  const go = useCallback((n: StepNo, focus: string | null = null) => {
    focusNext.current = focus;
    window.location.hash = stepHash(n);
  }, []);

  // ─── Schedule: the board and its gestures ────────────────
  const [held, setHeld] = useState<DragPayload | null>(null);
  const heldRef = useRef(held);
  heldRef.current = held;
  // The drag hook's tap lands here; pick is defined further down.
  const pickRef = useRef<(p: DragPayload) => void>(() => undefined);
  const [mealSheet, setMealSheet] = useState<string | null>(null);
  const [tripSheet, setTripSheet] = useState<string | null>(null);
  // a product whose Options open with the trip sheet (a warning's open_options remedy)
  const [tripOptions, setTripOptions] = useState<number | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [firstRun, setFirstRun] = useState(() => d.rev === 0 && Object.keys(d.recipes).length === 0);
  // Where focus goes once the render that moved or put something down is on screen. It is
  // state, not a ref, so it is used by the render it was asked for and by no later one: a
  // leftover request would pull focus out of whatever the shopper is typing in next.
  const [focusTo, setFocusTo] = useState<{ selector: string } | null>(null);
  const timing = useTiming();

  // Nothing stays held on another stage.
  useEffect(() => setHeld(null), [step]);

  const label = useCallback((p: DragPayload) => {
    if (p.kind === 'trip') return `the trip on ${dayLabel(p.date)}`;
    const m = d.meals.find((x) => x.id === p.mealId);
    return m ? recipeTitle(state, m.recipe_key) : 'that meal';
  }, [d.meals, state]);

  // A meal moved, to a slot or back to the tray: focus it where it landed, so the keyboard
  // carries on from there instead of from the page.
  const apply = useCallback((edit: PlanEdit | null) => {
    if (!edit) return;
    const out = mp.dispatch(edit);
    if (!out.refused && (edit.type === 'place' || edit.type === 'unplace')) {
      setFocusTo({ selector: mealChipSelector(edit.mealId) });
    }
  }, [mp]);

  const onEffect = useCallback((effect: NonNullable<DragEffect>) => {
    switch (effect.kind) {
      case 'start':
        setHeld(null);
        mp.setDragging(true);
        break;
      case 'tap':
        pickRef.current(effect.payload);
        break;
      case 'drop':
        mp.setDragging(false);
        apply(dropEdit(effect.payload, effect.target));
        break;
      case 'cancel':
        mp.setDragging(false);
        mp.announce('Move cancelled.');
        break;
      default:
        break;
    }
  }, [mp, label, apply]);

  const { drag, grip, ghost } = usePointerDrag(onEffect);

  // Recipes saved or sent from recipe import in this same page since the tab was last open.
  const { syncSaved } = mp;
  useEffect(() => { syncSaved(); }, [syncSaved]);

  useEffect(() => {
    if (focusTo) document.querySelector<HTMLElement>(focusTo.selector)?.focus();
  }, [focusTo]);

  // Tapping what is held puts it down; anything else is picked up instead.
  const pick = useCallback((p: DragPayload) => {
    const h = heldRef.current;
    const same = h !== null && JSON.stringify(h) === JSON.stringify(p);
    setHeld(same ? null : p);
    mp.announce(same ? 'Put down.'
      : `Picked up ${label(p)}. Choose where it goes: Tab to a slot and press Enter, or Escape to cancel.`);
  }, [mp, label]);
  pickRef.current = pick;

  // Escape or Cancel: focus goes back to what was picked up (the Cancel button pressed is gone
  // once nothing is held).
  const cancelHeld = useCallback(() => {
    if (!held) return;
    setHeld(null);
    mp.announce('Move cancelled.');
    setFocusTo({ selector: held.kind === 'meal' ? mealChipSelector(held.mealId) : tripChipSelector(held.date) });
  }, [held, mp]);

  const dropOn = useCallback((key: string) => {
    if (!held) return;
    const edit = dropEdit(held, key);
    setHeld(null);
    if (!edit) {
      mp.announce(`That is not a place for ${label(held)}.`);
      return;
    }
    apply(edit);
  }, [held, mp, label, apply]);

  // The plan's mood on the board: meals a must-fix warning names, under the strategy shown.
  const atRisk = useMemo(() => new Set(answer ? warningsFor(answer, strategy)
    .filter((w) => w.level === 'must_fix').flatMap((w) => w.meal_ids) : []), [answer, strategy]);

  const ctl: BoardCtl = {
    state, schedule: answer, strategy, held, drag, grip, pick, dropOn, dispatch: apply,
    openMeal: (id) => { setHeld(null); setMealSheet(id); },
    openTrip: (t) => setTripSheet(t.date),
    atRisk, hideEmpty,
  };

  // What dropping here would mean, for the ghost: a preview from the last answer.
  const preview = useMemo(() => {
    const t = parseTarget(drag?.over);
    const p = drag?.payload;
    if (!t || !p) return null;
    if (p.kind === 'meal' && t.kind === 'slot') {
      return `preview: ${moveConsequence(answer, strategy, p.mealId, t.date, t.slot).lines[0]}`;
    }
    if (p.kind === 'meal' && t.kind === 'tray') return 'back to the tray';
    if (p.kind === 'trip' && t.kind === 'shop') {
      return `preview: ${tripMoveConsequence(answer, strategy, p.tripId, t.date).lines[0]}`;
    }
    return null;
  }, [drag, answer, strategy]);

  // Escape and undo for the whole tab; nothing while typing.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const intent = keyIntent(e, { holding: Boolean(held), inText: inText(e.target) });
    if (intent === 'cancel') {
      e.preventDefault();
      cancelHeld();
    } else if (intent === 'undo' && mp.canUndo) {
      e.preventDefault();
      mp.undo();
    } else if (intent === 'redo' && mp.canRedo) {
      e.preventDefault();
      mp.redo();
    }
  };

  // Filling empties the tray, which disables or removes the button pressed, so focus goes to the
  // stage's heading rather than being dropped on the page; the live region says what moved.
  const fill = () => {
    const out = mp.dispatch({ type: 'fillEmpty' });
    if (!out.refused) heading.current?.focus();
  };

  // Every remedy that is not an edit lands here (consequences.remedyStep), so none is a button
  // that does nothing.
  const onAsk = (op: RemedyOp) => {
    switch (op.op) {
      case 'set_servings': {
        // the question is in the tray's recipe row, on Schedule
        const id = `#mp-servings-${CSS.escape(op.recipe_key)}`;
        const input = document.querySelector<HTMLElement>(id);
        if (input) {
          input.scrollIntoView({ block: 'center' });
          input.focus();
        } else go(4, id);
        break;
      }
      case 'set_packs': case 'approve_trip':
        setTripSheet(op.date);
        break;
      case 'open_options':
        setTripSheet(op.date);
        setTripOptions(op.product_id);
        break;
      case 'resolve':
        mp.retryResolve(op.recipe_key);
        break;
      default:
        mp.announce('This console cannot make that change yet.');
    }
  };

  const status = [
    mp.persist === 'ok' ? 'Saved in this browser only' : mp.persist === 'failed'
      ? 'Not saved: this browser refused; use Export' : 'Not saved in this browser; use Export',
    schedule.status === 'checking' ? 'checking…' : schedule.status === 'error' ? 'check failed'
      : schedule.current ? 'checked' : '',
  ].filter(Boolean).join(' · ');
  // A pin the schedule now refuses (its product held back or no longer sold in range) can be
  // taken off from here, so the plan is never stuck on it.
  const fix = schedule.status === 'error' ? pinFix(schedule.errorCode ?? null, schedule.errorDetail) : null;
  const placedAny = d.meals.some((m) => m.date !== null);
  const trayCount = d.meals.filter((m) => m.date === null).length;
  const statusLine = (
    <p className="mp-status" aria-live="off">
      <span>{summaryLine(state, answer)} · {dayLabel(d.start_date)} to {dayLabel(addDays(d.start_date, d.days - 1))}</span>
      <span className="muted"> · {status}</span>
      {schedule.status === 'error' && (
        <> <span className="cart-flag">{schedule.error}</span>{' '}
          {fix && <><button type="button" className="linkish" onClick={() => mp.dispatch(fix.edit)}>{fix.label}</button>{' '}</>}
          <button type="button" className="linkish" onClick={mp.recheck}>Retry</button></>
      )}
    </p>
  );

  // An earlier stage an edit has since undone: said at the top of this one too.
  const earlier = nextBlock(step, facts);
  const behind = earlier && earlier.state === 'blocked' && earlier.step < step ? earlier : null;

  const st = strategyOf(answer, strategy);
  const planTotal = st && st.trips.length
    ? againstBudget(st.trips.some(tripPriced) ? st.total_cost : null, st.total_is_floor, budgetOf(d.prefs)) : null;

  return (
    <div className="view mealplan" onKeyDown={onKeyDown}>
      {mp.loadProblem && (
        <div className="banner banner-error">
          {mp.loadProblem} It was kept in this browser as a backup, and a new plan was started.
        </div>
      )}

      <Stepper step={step} facts={facts} />

      <section className="panel mp-stage" aria-labelledby="mp-stage-head">
        <h2 id="mp-stage-head" ref={heading} tabIndex={-1}>{stepTitle(step)}</h2>
        {behind && (
          <p className="banner banner-update mp-behind">
            {stepName(behind.step)}: {behind.text}.{' '}
            <a href={stepHash(behind.step)}>Go to {stepName(behind.step)}</a>
          </p>
        )}

        {step === 1 && (
          <>
            <BasicsStage />
            <PlanFile />
          </>
        )}

        {step === 2 && <MealsStage quickText={quickText} setQuickText={setQuickText} />}

        {step === 3 && <IngredientsStage basket={basket} onMeals={() => go(2)} />}

        {step === 4 && (
          <>
            <div className="mp-toolbar">
              <button type="button" className="secondary mini" disabled={!mp.canUndo} onClick={mp.undo}>Undo</button>
              <button type="button" className="secondary mini" disabled={!mp.canRedo} onClick={mp.redo}>Redo</button>
              <button type="button" className="mini" disabled={!trayCount} onClick={fill}>Fill empty slots</button>
              <button type="button" className="secondary mini" disabled={!placedAny || mp.cookDays.status === 'checking'}
                      onClick={mp.proposeCookDays}>Suggest cook days</button>
              <label className="check mp-inline">
                <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
                hide empty rows
              </label>
            </div>
            {statusLine}
            <RecipeTray ctl={ctl} quickText={quickText} setQuickText={setQuickText} compact
                        emptyText="No meals yet: add some in Meals." />
            <PeriodBand period={answer?.period_nutrition} coverage={answer?.coverage.nutrition}
                        onTargets={() => setTargetsOpen(true)}
                        targetCount={Object.keys(d.nutrition_targets ?? {}).length} />
            <CookDaysDiff />
            {trayCount > 0 && !placedAny && (
              <div className="mp-empty mp-empty-place">
                <button type="button" onClick={fill}>Fill empty slots for me</button>
                <p className="muted">or drag a meal onto a day, or tap a meal then a slot</p>
              </div>
            )}
            <PlanBoard ctl={ctl} />
          </>
        )}

        {step === 5 && (
          <>
            {statusLine}
            {planTotal && (
              <p className={`mp-total ${planTotal.over ? 'cart-flag' : ''}`}>
                <strong>{STRATEGY_NAMES[strategy]}</strong> {planTotal.text}
              </p>
            )}
            {!answer ? (
              <p className="muted">
                {hasRecipes ? 'Trips appear once the plan has been checked.' : 'Trips appear once you pick some meals.'}
              </p>
            ) : (
              <>
                <CoverageChips coverage={answer.coverage} />
                <WarningsPanel schedule={answer} onAsk={onAsk} />
                <ShopPanel schedule={answer} onOpenTrip={setTripSheet} />
              </>
            )}
            <ShoppingSettings />
          </>
        )}

        {step === 6 && (
          <>
            <p className="muted">
              Your approved trips and placed meals as calendar events, with the times and reminders
              below. No account or sign-in is needed for the file or the links.
            </p>
            <TimingSettings form={timing.form} onChange={timing.setForm} zone={timing.zone} />
            <CalendarExport schedule={answer?.approved_schedule ?? null} current={schedule.current}
                            timing={timing.timing} />
            <PlanFile />
          </>
        )}
      </section>

      <StageNav step={step} facts={facts} go={go} onBlocked={mp.announce} />

      {step === 4 && (
        <>
          <ActionBar ctl={ctl} onCancel={cancelHeld} onTray={() => dropOn('tray')} />
          <DragGhost ctl={ctl} ghostRef={ghost} preview={preview} />
          <MoveSheet ctl={ctl} mealId={mealSheet} onClose={() => setMealSheet(null)} />
        </>
      )}
      <TripSheet date={tripSheet} optionsFor={tripOptions}
                 onClose={() => { setTripSheet(null); setTripOptions(null); }} />
      <TargetsEditor open={targetsOpen} onClose={() => setTargetsOpen(false)} targets={d.nutrition_targets}
                     onSave={(t) => mp.dispatch({ type: 'setTargets', targets: t }).refused} />
      <FirstRunSheet open={firstRun} onClose={() => setFirstRun(false)} onExample={() => {
        setQuickText(EXAMPLE_SENTENCE);
        if (step === 2) window.setTimeout(() => document.getElementById('mp-quick-text')?.focus(), 0);
        else go(2, '#mp-quick-text');
      }} />
    </div>
  );
}
