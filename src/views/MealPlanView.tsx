// The meal plan (#/plan?step=1..6): six stages under a progress indicator, each headed by what
// the shopper does there with a quiet "Step 2 of 6" over it, and Back and Next in a bar along the
// bottom of the screen. The same view, in "shop" mode, is the shopping plan on its own (#/shop):
// stage 5 with no stepper, a way back to planning, and, while the plan cannot have a shopping
// plan yet, what it is waiting for and the stage that gives it.
//   1 Set up:            optional: the period, the budget, the diet and origin rules, where and
//                        when to shop (components/basics.tsx). Every plan is for one person for
//                        now. A plan with no recipes opens on Pick meals instead.
//   2 Pick meals:        the setup restated with a Change for each answer, "Build a week for me",
//                        then recipe cards by meal under a budget bar; Quick add, import and the
//                        shopper's own recipes (components/mealcards.tsx).
//   3 Check ingredients: how far the check has got, over a bar; the ingredients no store nearby
//                        sells, pinned as a task list with their answers; then each recipe's
//                        ingredients as the plan would buy them, how sure each match is, and
//                        "Your stores" beside them (components/ingredients.tsx).
//   4 Place on days:     the 7 or 14 day calendar beside the recipes to place (the tray, as a
//                        sprint board's backlog), only the rows the meals use unless "Show all
//                        slots", drag and drop, Fill empty slots (done once by itself when every
//                        meal waits in the tray), Suggest cook days, undo and the nutrition band
//                        (components/mealcal.tsx, mealtray.tsx).
//   5 Shop:              the goal first: "Check your plan" (the diet, the total against the
//                        budget, the days, the stores, how to shop, each with a Change), then
//                        "Your list" for the whole period with Copy and Print, then the trips:
//                        the two ways to shop as tiles, the warnings and their fixes, the week
//                        strip to move a trip on, and each trip to approve, dismiss or move, or,
//                        approved, to shop in the store (components/shoplist.tsx, mealtrips.tsx).
//   6 Calendar:          the events and the two ways to add them (the file, Google Calendar), the
//                        timing in one folded card, the events by day with their pictures; done
//                        once they have gone to a calendar, which the progress indicator and Home
//                        show (components/CalendarExport.tsx, useExported.ts).
// Where a stage opens and what stops Next are decided in mealplan/wizard.ts. The plan lives in
// MealPlanProvider (above every page, so it survives moving between them) and is saved in this
// browser only. Every change re-runs /mealplan/schedule, which is pure: no model call, and the
// same plan gives the same answer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { arrivalFor, arriveAt, arriving, clearArrival } from '../components/arrival';
import { BasicsStage, PlanFile, ShoppingSettings } from '../components/basics';
import { CalendarExport, useTiming } from '../components/CalendarExport';
import { IngredientsStage } from '../components/ingredients';
import { ActionBar, DragGhost, MoveSheet, PlanBoard, WeekStrip } from '../components/mealcal';
import type { BoardCtl } from '../components/mealcal';
import { MealsStage } from '../components/mealcards';
import { CookDaysDiff, CoverageList, ShopPanel, TripSheet, WarningsPanel } from '../components/mealtrips';
import { Icon } from '../components/icons';
import { EXAMPLE_SENTENCE, FirstRunSheet, RecipeTray } from '../components/mealtray';
import { PeriodBand, TargetsEditor } from '../components/nutrition';
import { CheckPlan, StrategyTiles, YourList, strategyInputId } from '../components/shoplist';
import { STORES_HEAD } from '../components/stores';
import { EmptyState, Notice, Skeleton } from '../components/ui';
import { usePointerDrag } from '../components/usePointerDrag';
import { withViewTransition } from '../components/viewTransition';
import { StageNav, Stepper } from '../components/wizard';
import { useExported } from '../components/useExported';
import { autofillCount, readAutofilled, rememberAutofilled, spreadText } from '../mealplan/autofill';
import type { SetupItem } from '../mealplan/basics';
import { summaryLine } from '../mealplan/board';
import { moveConsequence, tripMoveConsequence, warningsFor } from '../mealplan/consequences';
import { addDays, dayLabel } from '../mealplan/dates';
import { dropEdit, keyIntent, parseTarget } from '../mealplan/dnd';
import { exportState } from '../mealplan/exported';
import type { DragEffect, DragPayload } from '../mealplan/dnd';
import { planPictures } from '../mealplan/images';
import { recipeTitle } from '../mealplan/model';
import type { PlanEdit } from '../mealplan/model';
import { pinFix } from '../mealplan/options';
import type { CheckItem } from '../mealplan/shoplist';
import { useBasket, useMealPlan, usePlanFacts } from '../mealplan/store';
import {
  furthest, isPlanHash, nextBlock, routeStep, stepCaption, stepFromHash, stepHash, stepName,
} from '../mealplan/wizard';
import type { StepNo } from '../mealplan/wizard';
import type { RemedyOp } from '../types';

const inText = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

// A meal's chip, on the board or in the tray, and a day's trip chip (mealcal.tsx).
const mealChipSelector = (mealId: string) => `[data-meal="${CSS.escape(mealId)}"] .mp-chip-main`;
const tripChipSelector = (date: string) => `[data-trip="${CSS.escape(date)}"] .mp-trip-main`;
// A recipe's "one meal more" in the tray, where a meal taken out of the plan leaves focus.
const trayMoreSelector = (key: string) => `[data-tray-more="${CSS.escape(key)}"]`;

// What a Change in Pick meals' setup strip focuses in Set up: the answer's own control (the chosen
// one of a group), so the keyboard is where the change is made.
const CHANGE_FOCUS: Record<SetupItem['key'], string[]> = {
  when: ['#su-when input:checked'],
  budget: ['#su-budget input'],
  diet: ['#su-diet input:checked'],
  avoid: ['#su-avoid input'],
  where: ['#su-where input', '#su-where button'],
  days: ['#su-days input'],
};

// Where a Change in Shop's "Check your plan" goes: Set up at the answer, or Check ingredients at
// its stores (which to use and how far to go). How to shop is on Shop itself (its tiles).
const CHECK_TO: Record<Exclude<CheckItem['key'], 'strategy'>, { step: StepNo; focus: string[] }> = {
  diet: { step: 1, focus: CHANGE_FOCUS.diet },
  budget: { step: 1, focus: CHANGE_FOCUS.budget },
  days: { step: 1, focus: CHANGE_FOCUS.when },
  stores: { step: 3, focus: ['.fc-stores input[name="mp-km"]:checked', `#${STORES_HEAD}`] },
};

// The stage the shopper was on when they last left the plan, for opening it again in this page.
let lastStep: StepNo | null = null;

// Plans Place on days has filled by itself in this page, beside the ones remembered in the
// browser (mealplan/autofill.ts): a browser that will not store the list still fills a plan once.
const filledHere = new Set<string>();

// localStorage, or null where the browser will not hand it over.
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// plan: the six stages at #/plan. shop: the shopping plan on its own at #/shop, which is stage 5
// with no stepper and no Back or Next, and never moves the address or the plan's stage.
export type MealPlanMode = 'plan' | 'shop';

// The stage the shopping plan is, and what it is called on its own.
const SHOP_STEP: StepNo = 5;
const SHOP_TITLE = 'Shopping plan';

export default function MealPlanView({ mode = 'plan' }: { mode?: MealPlanMode }) {
  const shop = mode === 'shop';
  const mp = useMealPlan();
  const { state, schedule } = mp;
  const d = state.draft;
  const strategy = d.prefs.strategy;
  const answer = schedule.answer;
  const hasRecipes = Object.keys(d.recipes).length > 0;

  // What the page that opened this one asked of it, if anything (components/arrival.ts): focus on
  // an answer (a Change in the shopping plan on its own), back on a trip (Done shopping), or the
  // example in Quick add (Home's "Try the example").
  const [arrival] = useState(() => arrivalFor(window.location.hash));

  // ─── Stages ──────────────────────────────────────────────
  const basket = useBasket(true);
  const facts = usePlanFacts(basket);
  const factsRef = useRef(facts);
  factsRef.current = facts;
  const [planStep, setStep] = useState<StepNo>(() =>
    routeStep(stepFromHash(window.location.hash), facts, lastStep, hasRecipes));
  const step: StepNo = shop ? SHOP_STEP : planStep;
  const stepRef = useRef(step);
  stepRef.current = step;
  // Where focus goes once the next stage is drawn, instead of its heading: the first of these
  // selectors that finds something.
  const focusNext = useRef<string[] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef<StepNo | null>(null);

  // A stage asked for by the address (a stepper link, Back and Next, the browser's own Back): no
  // further than the plan allows. '#/plan' alone (Plan in the navigation) keeps the stage shown,
  // and says so. The plan's old address, '#/mealplan', is read the same way, in case it arrives
  // before the shell has rewritten it. The shopping plan on its own has no stage to follow.
  // The stage changes with a short cross-fade of the stage alone (.vt-stage, below): the
  // stepper, the bars and the page around it stay still (components/viewTransition.ts).
  useEffect(() => {
    if (shop) return undefined;
    const onHash = () => {
      const asked = stepFromHash(window.location.hash);
      if (asked !== null) {
        const to = routeStep(asked, factsRef.current, null, true);
        // held back to the stage shown already: the effect below would not run, so say it here
        if (to !== asked) window.history.replaceState(null, '', stepHash(to));
        if (to !== stepRef.current) withViewTransition(() => setStep(to));
      } else if (isPlanHash(window.location.hash)) {
        window.history.replaceState(null, '', stepHash(stepRef.current));
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [shop]);

  // The address always names the stage shown, so a reload or a bookmark comes back to it. This
  // runs after the Calendar stage has read and cleared Google's ?calendar= return.
  useEffect(() => {
    if (shop) return;
    lastStep = step;
    if (isPlanHash(window.location.hash) && stepFromHash(window.location.hash) !== step) {
      window.history.replaceState(null, '', stepHash(step));
    }
  }, [step, shop]);

  // A new stage: focus its heading (or what was asked for), so the keyboard and a screen reader
  // start there. Not on the first one: opening the plan leaves focus where it was.
  useEffect(() => {
    if (shown.current === null || shown.current === step) {
      shown.current = step;
      return;
    }
    shown.current = step;
    const target = (focusNext.current ?? []).map((sel) => document.querySelector<HTMLElement>(sel))
      .find((el) => el !== null) ?? null;
    focusNext.current = null;
    (target ?? heading.current)?.focus();
  }, [step]);

  const go = useCallback((n: StepNo, focus: string | string[] | null = null) => {
    focusNext.current = focus === null ? null : typeof focus === 'string' ? [focus] : focus;
    window.location.hash = stepHash(n);
  }, []);

  // A Change in Pick meals' setup strip: Set up, at that answer.
  const changeSetup = useCallback((key: SetupItem['key']) => go(1, CHANGE_FOCUS[key]), [go]);

  // A Change in Shop's "Check your plan": the stage where it is set, at the answer. From the
  // shopping plan on its own that is another page (the plan's own view opens), which takes the
  // request as it opens. How to shop is the tiles further down this page.
  const checkHref = (key: CheckItem['key']) => (key === 'strategy' ? null : stepHash(CHECK_TO[key].step));
  const changeCheck = (key: CheckItem['key']) => {
    if (key === 'strategy') {
      document.getElementById(strategyInputId(strategy))?.focus();
      return;
    }
    const to = CHECK_TO[key];
    if (!shop) {
      go(to.step, to.focus);
      return;
    }
    arriveAt(stepHash(to.step), { focus: to.focus });
    window.location.hash = stepHash(to.step);
  };

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
  // Place on days draws only the rows its meals use, unless the shopper asks for every slot.
  const [showAll, setShowAll] = useState(false);
  const [quickText, setQuickText] = useState(() => (arrival?.example ? EXAMPLE_SENTENCE : ''));
  // The first-run sheet belongs to the plan; the shopping plan says what it waits for instead. A
  // shopper sent here from Home has chosen already (Start planning, Try the example).
  const [firstRun, setFirstRun] = useState(() => !shop && !arrival && d.rev === 0
    && Object.keys(d.recipes).length === 0);
  // Where focus goes once the render that moved or put something down is on screen: the first of
  // these selectors that takes it, else the stage's heading, never the page. It is state, not a
  // ref, so it is used by the render it was asked for and by no later one: a leftover request
  // would pull focus out of whatever the shopper is typing in next.
  const [focusTo, setFocusTo] = useState<{ selectors: string[] } | null>(null);
  const timing = useTiming(d.prefs.slots_on);
  // Whether the plan's events have gone to a calendar, and are still the plan's: the last stage's
  // work done, which the progress indicator shows (mealplan/exported.ts).
  const exported = useExported(d.id);
  const finished = exportState(exported.mark, answer?.approved_schedule, timing.timing) === 'current';

  // Nothing stays held on another stage.
  useEffect(() => setHeld(null), [step]);

  const label = useCallback((p: DragPayload) => {
    if (p.kind === 'trip') return `the trip on ${dayLabel(p.date)}`;
    const m = d.meals.find((x) => x.id === p.mealId);
    return m ? recipeTitle(state, m.recipe_key) : 'that meal';
  }, [d.meals, state]);

  // A meal moved, to a slot or back to the tray: focus it where it landed, so the keyboard
  // carries on from there instead of from the page. A meal taken out of the plan (its Move
  // sheet's Remove) leaves focus on its recipe's "one meal more" in the tray.
  const apply = useCallback((edit: PlanEdit | null) => {
    if (!edit) return;
    const before = edit.type === 'remove' ? mp.state.draft.meals.find((m) => m.id === edit.mealId) : undefined;
    const out = mp.dispatch(edit);
    if (out.refused) return;
    if (edit.type === 'place' || edit.type === 'unplace') {
      setFocusTo({ selectors: [mealChipSelector(edit.mealId)] });
    } else if (edit.type === 'remove' && before) {
      setFocusTo({ selectors: [trayMoreSelector(before.recipe_key)] });
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

  // Recipes saved or sent from recipe import in this same page since the plan was last open.
  const { syncSaved } = mp;
  useEffect(() => { syncSaved(); }, [syncSaved]);

  useEffect(() => {
    if (!focusTo) return;
    for (const sel of focusTo.selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      el?.focus();
      if (el && document.activeElement === el) return;
    }
    // folded away or gone: the stage's heading, so the keyboard carries on from the stage
    heading.current?.focus();
  }, [focusTo]);

  // Opened with a request: focus where it asked (the example's Quick add, an answer in Set up, a
  // trip's Shop this trip), else the heading, so the keyboard starts there and not at the top. A
  // moment later, after the shell has brought a new page to its top (App.tsx), so the browser
  // then scrolls what is focused into view.
  useEffect(() => {
    if (!arrival) return undefined;
    clearArrival();
    const targets = arrival.example ? ['#mp-quick-text'] : arrival.focus ?? [];
    const id = window.setTimeout(() => {
      const el = targets.map((sel) => document.querySelector<HTMLElement>(sel)).find((x) => x !== null);
      (el ?? heading.current)?.focus();
    }, 0);
    return () => window.clearTimeout(id);
    // once, as the view opens
  }, []);

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
    setFocusTo({ selectors: [held.kind === 'meal' ? mealChipSelector(held.mealId) : tripChipSelector(held.date)] });
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

  // Each recipe's picture for its cards: the basket names them, the shopper's own docs carry theirs.
  const pictures = useMemo(() => planPictures(d, basket.answer?.recipes ?? []), [d.recipes, basket.answer]);

  const ctl: BoardCtl = {
    state, schedule: answer, strategy, held, drag, grip, pick, dropOn, dispatch: apply,
    openMeal: (id) => { setHeld(null); setMealSheet(id); },
    openTrip: (t) => setTripSheet(t.date),
    atRisk, hideEmpty: !showAll, pictures,
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

  // Place on days fills itself once: opened on a plan whose meals all wait in the tray, it spreads
  // them over the empty slots (the same edit as Fill empty slots), says so in a toast with an
  // Undo, and remembers the plan so it never does it again; an Undo stays undone, and coming back
  // does not fill it a second time. The plan as it is now is read from a ref: the effect runs on
  // entering the stage (or another plan arriving on it), not on every edit.
  const planNow = useRef(state);
  planNow.current = state;
  useEffect(() => {
    if (shop || step !== 4) return;
    const storage = browserStorage();
    const plan = planNow.current;
    const n = autofillCount(plan, [...readAutofilled(storage), ...filledHere]);
    if (!n) return;
    filledHere.add(plan.draft.id);
    rememberAutofilled(storage, plan.draft.id);
    const out = mp.dispatch({ type: 'fillEmpty' }, { quiet: true });
    if (out.refused) return;
    mp.toastUndo(spreadText(n, plan.draft.days));
    // the stage and the plan are what it runs on; mp's toastUndo is the same throughout
  }, [step, d.id, shop]);

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
  // Meals held in the tray, which Fill empty slots would spread. Once it has run they wait unpinned
  // for the schedule to place them, and filling again would do nothing.
  const trayCount = d.meals.filter((m) => m.date === null && m.pinned).length;
  const statusLine = (
    <>
      <p className="mp-status" aria-live="off">
        <span>{summaryLine(state, answer)} · {dayLabel(d.start_date)} to {dayLabel(addDays(d.start_date, d.days - 1))}</span>
        <span className="muted"> · {status}</span>
      </p>
      {schedule.status === 'error' && (
        <Notice tone="danger" title="The trips could not be worked out" className="mp-status-problem"
                actions={[...(fix ? [{ label: fix.label, onClick: () => { mp.dispatch(fix.edit); } }] : []),
                  { label: 'Try again', icon: 'refresh' as const, onClick: mp.recheck }]}>
          {schedule.error}
        </Notice>
      )}
    </>
  );

  // An earlier stage an edit has since undone: said at the top of this one too.
  const earlier = nextBlock(step, facts);
  // (The shopping plan on its own says it with its EmptyState below instead.)
  const behind = !shop && earlier && earlier.state === 'blocked' && earlier.step < step ? earlier : null;

  // The shopping plan on its own, while a stage before it is blocked: what it waits for (the first
  // gate not passed) and the stage that gives it. "Back to planning" goes to the furthest stage
  // the plan can be on.
  const reach = furthest(facts);
  const shopWaits = shop && reach < SHOP_STEP ? nextBlock((SHOP_STEP - 1) as StepNo, facts) : null;

  return (
    <div className={`view mealplan${shop ? ' mealplan-shop' : ''}`} onKeyDown={onKeyDown}>
      {mp.loadProblem && (
        <Notice tone="danger" title="Your saved plan could not be read">
          {mp.loadProblem} It was kept in this browser as a backup, and a new plan was started.
        </Notice>
      )}

      {!shop && <Stepper step={step} facts={facts} finished={finished} />}

      {/* every stage is cards, drawn on the page itself; the stage is what cross-fades when it
          changes (vt-stage), and only it */}
      <section className="mp-stage vt-stage" aria-labelledby="mp-stage-head">
        {shop ? (
          <div className="mp-shop-head">
            <h2 id="mp-stage-head" ref={heading} tabIndex={-1}>{SHOP_TITLE}</h2>
            <a className="mp-shop-back" href={stepHash(reach)} onClick={arriving(stepHash(reach))}>
              <Icon name="arrow-left" size={16} />Back to planning
            </a>
          </div>
        ) : (
          // the stage's name is the heading, in the display face; the quiet line over it is part
          // of it, so a screen reader arriving on a stage hears "Step 2 of 6, Pick meals"
          <h2 id="mp-stage-head" className="mp-stage-title" ref={heading} tabIndex={-1}>
            <span className="mp-stage-step">{stepCaption(step)}<span className="sr-only">,</span></span>
            {stepName(step)}
          </h2>
        )}
        {behind && (
          <Notice tone="warn" className="mp-behind"
                  actions={[{ label: `Go to ${stepName(behind.step)}`, href: stepHash(behind.step) }]}>
            {stepName(behind.step)}: {behind.text}.
          </Notice>
        )}

        {step === 1 && (
          <>
            <BasicsStage />
            <PlanFile />
          </>
        )}

        {step === 2 && <MealsStage quickText={quickText} setQuickText={setQuickText} onChange={changeSetup} />}

        {step === 3 && <IngredientsStage basket={basket} facts={facts} onMeals={() => go(2)} />}

        {step === 4 && (
          <>
            <div className="mp-tools" role="group" aria-label="Arrange the days">
              <button type="button" className="btn btn-secondary btn-sm" disabled={!mp.canUndo} onClick={mp.undo}>
                <Icon name="undo" size={16} />Undo
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!mp.canRedo} onClick={mp.redo}>
                <Icon name="redo" size={16} />Redo
              </button>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!trayCount} onClick={fill}>
                Fill empty slots
              </button>
              <button type="button" className="btn btn-secondary btn-sm"
                      disabled={!placedAny || mp.cookDays.status === 'checking'} onClick={mp.proposeCookDays}>
                Suggest cook days
              </button>
              {/* a toggle: pressed, every slot switched on in Set up draws its row */}
              <button type="button" className="btn btn-ghost btn-sm mp-tools-toggle" aria-pressed={showAll}
                      onClick={() => setShowAll(!showAll)}>
                <Icon name={showAll ? 'check' : 'list'} size={16} />Show all slots
              </button>
            </div>
            {statusLine}
            {/* a sprint board: the recipes to place beside the calendar, both in view */}
            <div className="sched">
              <RecipeTray ctl={ctl} emptyText="No meals yet: add some in Pick meals." />
              <section className="card sched-board" aria-label="Calendar">
                <PeriodBand period={answer?.period_nutrition} coverage={answer?.coverage.nutrition}
                            onTargets={() => setTargetsOpen(true)}
                            targetCount={Object.keys(d.nutrition_targets ?? {}).length} />
                <CookDaysDiff />
                {trayCount > 0 && !placedAny && (
                  <div className="mp-empty mp-empty-place">
                    <button type="button" className="btn btn-primary" onClick={fill}>Fill empty slots for me</button>
                    <p className="muted">or drag a meal onto a day, or tap a meal then a slot</p>
                  </div>
                )}
                <PlanBoard ctl={ctl} />
              </section>
            </div>
          </>
        )}

        {shopWaits && (
          <EmptyState icon="bag" className="mp-shop-waits"
                      status={`Not yet: ${shopWaits.text}.`}
                      cue="The shopping plan is made from the meals you pick and place on days: its trips, what to buy on each, and the total."
                      action={{ label: `Go to ${stepName(shopWaits.step)}`, href: stepHash(shopWaits.step),
                        onClick: () => arriveAt(stepHash(shopWaits.step), {}) }} />
        )}

        {step === 5 && !shopWaits && (
          <>
            {statusLine}
            <CheckPlan hrefOf={checkHref} onChange={changeCheck} />
            {!answer ? (
              <>
                {hasRecipes && schedule.status !== 'error' && <Skeleton kind="row" count={5} label="Working out your trips" />}
                <p className="muted">
                  {hasRecipes ? 'Trips appear once the plan has been checked.' : 'Trips appear once you pick some meals.'}
                </p>
              </>
            ) : (
              <>
                <YourList schedule={answer} />
                <section className="card shop-card shop-trips" aria-labelledby="mp-trips-head">
                  <h3 id="mp-trips-head" className="shop-card-title">Trips</h3>
                  <StrategyTiles schedule={answer} />
                  <WarningsPanel schedule={answer} onAsk={onAsk} />
                  <WeekStrip ctl={ctl} />
                  <ShopPanel schedule={answer} onOpenTrip={setTripSheet} />
                </section>
                {/* what the figures rest on, for whoever wants it, out of the way of shopping */}
                <details className="mp-covers">
                  <summary>What the data covers</summary>
                  <CoverageList coverage={answer.coverage} />
                </details>
              </>
            )}
            <ShoppingSettings />
          </>
        )}

        {step === 6 && (
          <>
            <CalendarExport schedule={answer?.approved_schedule ?? null} current={schedule.current}
                            timing={timing} slots={d.prefs.slots_on} pictures={pictures}
                            exported={exported.mark} onExported={exported.done} />
            <PlanFile />
          </>
        )}
      </section>

      {!shop && <StageNav step={step} facts={facts} go={go} say={mp.announce} hidden={held !== null} />}

      {(step === 4 || (step === 5 && !shopWaits)) && (
        <>
          <ActionBar ctl={ctl} onCancel={cancelHeld} onTray={() => dropOn('tray')} />
          <DragGhost ctl={ctl} ghostRef={ghost} preview={preview} />
        </>
      )}
      {step === 4 && <MoveSheet ctl={ctl} mealId={mealSheet} onClose={() => setMealSheet(null)} />}
      <TripSheet date={tripSheet} optionsFor={tripOptions}
                 onClose={() => { setTripSheet(null); setTripOptions(null); }} />
      <TargetsEditor open={targetsOpen} onClose={() => setTargetsOpen(false)} targets={d.nutrition_targets}
                     onSave={(t) => mp.dispatch({ type: 'setTargets', targets: t }).refused} />
      {/* opened on arrival, it has no opener to give focus back to: the stage's heading takes it */}
      <FirstRunSheet open={firstRun} returnFocus={heading} onClose={() => setFirstRun(false)} onExample={() => {
        setQuickText(EXAMPLE_SENTENCE);
        if (step === 2) window.setTimeout(() => document.getElementById('mp-quick-text')?.focus(), 0);
        else go(2, '#mp-quick-text');
      }} />
    </div>
  );
}
