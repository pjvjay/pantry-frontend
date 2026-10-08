// The Meal plan tab (#/mealplan): three bands on one page.
//   Pick:  what to cook and how many times (the tray, Quick add).
//   Place: a 7 or 14 day calendar of Breakfast, Lunch, Dinner and Snack, with the nutrition
//          band above it and Suggest cook days.
//   Shop:  the trips code suggests, the warnings and their fixes, and what the data covers.
// The plan lives in MealPlanProvider (above the tab switch, so it survives changing tabs) and is
// saved in this browser only. Every change re-runs /mealplan/schedule, which is pure: no model
// call, and the same plan gives the same answer.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { ActionBar, DragGhost, MoveSheet, PlanBoard } from '../components/mealcal';
import type { BoardCtl } from '../components/mealcal';
import { CookDaysDiff, CoverageChips, ShopPanel, TripSheet, WarningsPanel } from '../components/mealtrips';
import { EXAMPLE_SENTENCE, FirstRunSheet, RecipeTray } from '../components/mealtray';
import { PeriodBand, TargetsEditor } from '../components/nutrition';
import { usePointerDrag } from '../components/usePointerDrag';
import { summaryLine } from '../mealplan/board';
import { moveConsequence, tripMoveConsequence, warningsFor } from '../mealplan/consequences';
import { addDays, dayLabel } from '../mealplan/dates';
import { dropEdit, keyIntent, parseTarget } from '../mealplan/dnd';
import type { DragEffect, DragPayload } from '../mealplan/dnd';
import { MAX_DAYS, MAX_SERVINGS, SLOTS, SLOT_LABELS, recipeTitle } from '../mealplan/model';
import type { PlanEdit, Slot } from '../mealplan/model';
import { exportFileName } from '../mealplan/persist';
import { useMealPlan } from '../mealplan/store';
import type { RemedyOp } from '../types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // Monday is 0, as the engine counts

// Shopping points, as the Planner offers them. The catalog's stores sit around downtown Vancouver.
const PLACES: { label: string; lat: number | null; lon: number | null }[] = [
  { label: 'Server default (downtown Vancouver)', lat: null, lon: null },
  { label: 'Kitsilano', lat: 49.2684, lon: -123.1683 },
  { label: 'East Vancouver', lat: 49.2765, lon: -123.07 },
  { label: 'Richmond', lat: 49.1666, lon: -123.1336 },
];

const inText = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function Settings() {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const p = d.prefs;
  const set = (prefs: Partial<typeof p>) => mp.dispatch({ type: 'setPrefs', prefs });
  const place = PLACES.findIndex((x) => x.lat === (d.settings.lat ?? null) && x.lon === (d.settings.lon ?? null));
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  return (
    <details className="mp-settings">
      <summary>Household and shopping settings</summary>
      <div className="form-row">
        <label>
          people in the household
          <input type="number" min={1} max={MAX_SERVINGS} value={p.household_servings}
                 onChange={(e) => set({ household_servings: Number(e.target.value) })} />
        </label>
        <label>
          buy at most this many days ahead when the storage time is unknown (your setting)
          <input type="number" min={0} max={MAX_DAYS} value={p.buy_ahead_days}
                 onChange={(e) => set({ buy_ahead_days: Number(e.target.value) })} />
        </label>
        <label>
          shopping from
          <select value={Math.max(0, place)} onChange={(e) => {
            const x = PLACES[Number(e.target.value)];
            mp.dispatch({ type: 'setSettings', settings: { lat: x.lat, lon: x.lon } });
          }}>
            {PLACES.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}
          </select>
        </label>
        <label>
          within km
          <input type="number" min={0.5} max={100} step={0.5} value={d.settings.max_km ?? ''} placeholder="any"
                 onChange={(e) => mp.dispatch({ type: 'setSettings',
                   settings: { max_km: e.target.value === '' ? null : Number(e.target.value) } })} />
        </label>
      </div>
      <fieldset className="mp-checks">
        <legend>Shop on</legend>
        {WEEKDAYS.map((w, i) => (
          <label key={w} className="check">
            <input type="checkbox" checked={p.shop_weekdays.includes(i)}
                   onChange={() => set({ shop_weekdays: toggle(p.shop_weekdays, i) })} />
            {w}
          </label>
        ))}
      </fieldset>
      <fieldset className="mp-checks">
        <legend>Meals on the calendar</legend>
        {SLOTS.map((sl) => (
          <label key={sl} className="check">
            <input type="checkbox" checked={p.slots_on.includes(sl)}
                   onChange={() => set({ slots_on: toggle(p.slots_on, sl) as Slot[] })} />
            {SLOT_LABELS[sl]}
          </label>
        ))}
      </fieldset>
      <div className="form-row">
        <label className="check">
          <input type="checkbox" checked={p.allow_freezer} onChange={(e) => set({ allow_freezer: e.target.checked })} />
          the fewest-trips plan may freeze food on arrival
        </label>
        <label>
          thaw reminders
          <select value={p.thaw_reminder} onChange={(e) => set({ thaw_reminder: e.target.value as typeof p.thaw_reminder })}>
            <option value="evening_before">the evening before</option>
            <option value="morning_of">the morning of</option>
          </select>
        </label>
      </div>
    </details>
  );
}

export default function MealPlanView() {
  const mp = useMealPlan();
  const { state, schedule } = mp;
  const d = state.draft;
  const strategy = d.prefs.strategy;
  const answer = schedule.answer;

  const [held, setHeld] = useState<DragPayload | null>(null);
  const heldRef = useRef(held);
  heldRef.current = held;
  // The drag hook's tap lands here; pick is defined further down.
  const pickRef = useRef<(p: DragPayload) => void>(() => undefined);
  const [mealSheet, setMealSheet] = useState<string | null>(null);
  const [tripSheet, setTripSheet] = useState<string | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [firstRun, setFirstRun] = useState(() => d.rev === 0 && Object.keys(d.recipes).length === 0);
  const [windowAsk, setWindowAsk] = useState<{ start: string; days: number; reason: string } | null>(null);
  const [importProblem, setImportProblem] = useState<string | null>(null);
  const focusAfter = useRef<{ meal?: string; source?: string } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  const label = useCallback((p: DragPayload) => {
    if (p.kind === 'trip') return `the trip on ${dayLabel(p.date)}`;
    const m = d.meals.find((x) => x.id === p.mealId);
    return m ? recipeTitle(state, m.recipe_key) : 'that meal';
  }, [d.meals, state]);

  // A meal moved: focus it where it landed, so the keyboard carries on from there.
  const apply = useCallback((edit: PlanEdit | null) => {
    if (!edit) return;
    const out = mp.dispatch(edit);
    if (!out.refused && edit.type === 'place') focusAfter.current = { meal: edit.mealId };
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

  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    const sel = f.meal ? `[data-meal="${CSS.escape(f.meal)}"] .mp-chip-main` : null;
    if (sel) document.querySelector<HTMLElement>(sel)?.focus();
  }, [state]);

  // Tapping what is held puts it down; anything else is picked up instead.
  const pick = useCallback((p: DragPayload) => {
    const h = heldRef.current;
    const same = h !== null && JSON.stringify(h) === JSON.stringify(p);
    setHeld(same ? null : p);
    mp.announce(same ? 'Put down.'
      : `Picked up ${label(p)}. Choose where it goes: Tab to a slot and press Enter, or Escape to cancel.`);
  }, [mp, label]);
  pickRef.current = pick;

  const cancelHeld = useCallback(() => {
    if (!held) return;
    const source = held.kind === 'meal' ? held.mealId : null;
    setHeld(null);
    mp.announce('Move cancelled.');
    if (source) focusAfter.current = { meal: source };
    else document.querySelector<HTMLElement>('.mp-trip-main')?.focus();
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

  const setWindow = (start: string, days: number) => {
    const out = mp.dispatch({ type: 'setWindow', start_date: start, days });
    setWindowAsk(out.refused && /outside the new dates/.test(out.refused)
      ? { start, days, reason: out.refused } : null);
  };

  const exportPlan = () => {
    const blob = new Blob([mp.exportText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(state);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importPlan = async (file: File | undefined) => {
    if (!file) return;
    const problem = mp.importText(await file.text());
    setImportProblem(problem);
    if (importInput.current) importInput.current.value = '';
  };

  const onAsk = (op: RemedyOp) => {
    if (op.op === 'set_servings') {
      const input = document.getElementById(`mp-servings-${op.recipe_key}`);
      input?.scrollIntoView({ block: 'center' });
      input?.focus();
      if (!input) mp.announce('Say how many the recipe serves in the Pick band.');
    } else if ('date' in op && (op.op === 'set_packs' || op.op === 'approve_trip' || op.op === 'open_options')) {
      setTripSheet(op.date);
    } else if (op.op === 'resolve') {
      mp.retryResolve();
    }
  };

  const status = [
    mp.persist === 'ok' ? 'Saved in this browser only' : mp.persist === 'failed'
      ? 'Not saved: this browser refused; use Export' : 'Not saved in this browser; use Export',
    schedule.status === 'checking' ? 'checking…' : schedule.status === 'error' ? 'check failed'
      : schedule.current ? 'checked' : '',
  ].filter(Boolean).join(' · ');
  const placedAny = d.meals.some((m) => m.date !== null);
  const trayCount = d.meals.filter((m) => m.date === null).length;

  return (
    <div className="view mealplan" onKeyDown={onKeyDown}>
      {mp.loadProblem && (
        <div className="banner banner-error">
          {mp.loadProblem} It was kept in this browser as a backup, and a new plan was started.
        </div>
      )}

      <section className="panel mp-band" aria-labelledby="mp-pick">
        <h2 id="mp-pick">Pick</h2>
        <RecipeTray ctl={ctl} quickText={quickText} setQuickText={setQuickText} />
      </section>

      <section className="panel mp-band" aria-labelledby="mp-place">
        <div className="mp-band-head">
          <h2 id="mp-place">Place</h2>
          <div className="mp-toolbar">
            <label className="mp-inline">
              from
              <input type="date" value={d.start_date} onChange={(e) => e.target.value && setWindow(e.target.value, d.days)} />
            </label>
            <span className="mp-seg" role="group" aria-label="Plan length">
              {[7, 14].map((n) => (
                <button key={n} type="button" className={d.days === n ? 'mini' : 'secondary mini'} aria-pressed={d.days === n}
                        onClick={() => setWindow(d.start_date, n)}>{n === 7 ? '1 week' : '2 weeks'}</button>
              ))}
            </span>
            <button type="button" className="secondary mini" disabled={!mp.canUndo} onClick={mp.undo}>Undo</button>
            <button type="button" className="secondary mini" disabled={!mp.canRedo} onClick={mp.redo}>Redo</button>
            <button type="button" className="mini" disabled={!trayCount}
                    onClick={() => mp.dispatch({ type: 'fillEmpty' })}>Fill empty slots</button>
            <button type="button" className="secondary mini" disabled={!placedAny || mp.cookDays.status === 'checking'}
                    onClick={mp.proposeCookDays}>Suggest cook days</button>
            <label className="check mp-inline">
              <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
              hide empty rows
            </label>
          </div>
        </div>
        {windowAsk && (
          <div className="banner banner-update">
            Not changed: {windowAsk.reason}.{' '}
            <button type="button" className="mini" onClick={() => {
              mp.dispatch({ type: 'setWindow', start_date: windowAsk.start, days: windowAsk.days, unplaceOutside: true });
              setWindowAsk(null);
            }}>Change it and send them back to the tray</button>{' '}
            <button type="button" className="secondary mini" onClick={() => setWindowAsk(null)}>Keep the dates</button>
          </div>
        )}
        <p className="mp-status" aria-live="off">
          <span>{summaryLine(state, answer)} · {dayLabel(d.start_date)} to {dayLabel(addDays(d.start_date, d.days - 1))}</span>
          <span className="muted"> · {status}</span>
          {schedule.status === 'error' && (
            <> <span className="cart-flag">{schedule.error}</span>{' '}
              <button type="button" className="linkish" onClick={mp.recheck}>Retry</button></>
          )}
        </p>
        <PeriodBand period={answer?.period_nutrition} coverage={answer?.coverage.nutrition}
                    onTargets={() => setTargetsOpen(true)}
                    targetCount={Object.keys(d.nutrition_targets ?? {}).length} />
        <CookDaysDiff />
        {trayCount > 0 && !placedAny && (
          <div className="mp-empty mp-empty-place">
            <button type="button" onClick={() => mp.dispatch({ type: 'fillEmpty' })}>Fill empty slots for me</button>
            <p className="muted">or drag a meal onto a day, or tap a meal then a slot</p>
          </div>
        )}
        <PlanBoard ctl={ctl} />
      </section>

      <section className="panel mp-band" aria-labelledby="mp-shop">
        <h2 id="mp-shop">Shop</h2>
        {!answer ? (
          <p className="muted">
            {Object.keys(d.recipes).length ? 'Trips appear once the plan has been checked.' : 'Trips appear once you pick some meals.'}
          </p>
        ) : (
          <>
            <CoverageChips coverage={answer.coverage} />
            <WarningsPanel schedule={answer} onAsk={onAsk} />
            <ShopPanel schedule={answer} onOpenTrip={setTripSheet} />
          </>
        )}
        <Settings />
        <div className="mp-toolbar mp-file">
          <button type="button" className="secondary mini" onClick={exportPlan}>Export plan (.json)</button>
          <button type="button" className="secondary mini" onClick={() => importInput.current?.click()}>Import plan</button>
          <input ref={importInput} type="file" accept="application/json,.json" hidden
                 onChange={(e) => void importPlan(e.target.files?.[0])} />
          <button type="button" className="secondary mini" onClick={() => { setHeld(null); mp.clear(); }}>Clear the plan</button>
          {importProblem && <span className="cart-flag" role="alert">{importProblem}</span>}
        </div>
      </section>

      <ActionBar ctl={ctl} onCancel={cancelHeld} onTray={() => dropOn('tray')} />
      <DragGhost ctl={ctl} ghostRef={ghost} preview={preview} />
      <MoveSheet ctl={ctl} mealId={mealSheet} onClose={() => setMealSheet(null)} />
      <TripSheet date={tripSheet} onClose={() => setTripSheet(null)} />
      <TargetsEditor open={targetsOpen} onClose={() => setTargetsOpen(false)} targets={d.nutrition_targets}
                     onSave={(t) => mp.dispatch({ type: 'setTargets', targets: t }).refused} />
      <FirstRunSheet open={firstRun} onClose={() => setFirstRun(false)} onExample={() => {
        setQuickText(EXAMPLE_SENTENCE);
        window.setTimeout(() => document.getElementById('mp-quick-text')?.focus(), 0);
      }} />
    </div>
  );
}
