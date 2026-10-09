// The Meal plan tab (#/mealplan): three bands on one page.
//   Pick:  what to cook and how many times (the tray, Quick add).
//   Place: a 7 or 14 day calendar of Breakfast, Lunch, Dinner and Snack, with the nutrition
//          band above it and Suggest cook days.
//   Shop:  the trips code suggests, the warnings and their fixes, and what the data covers.
// The plan lives in MealPlanProvider (above the tab switch, so it survives changing tabs) and is
// saved in this browser only. Every change re-runs /mealplan/schedule, which is pure: no model
// call, and the same plan gives the same answer.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { CalendarExportDialog } from '../components/CalendarExportDialog';
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
import { SETTING_RULES, SLOTS, SLOT_LABELS, readNumber, recipeTitle } from '../mealplan/model';
import type { NumberRule, PlanEdit, Slot } from '../mealplan/model';
import { pinFix } from '../mealplan/options';
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

// A meal's chip, on the board or in the tray, and a day's trip chip (mealcal.tsx).
const mealChipSelector = (mealId: string) => `[data-meal="${CSS.escape(mealId)}"] .mp-chip-main`;
const tripChipSelector = (date: string) => `[data-trip="${CSS.escape(date)}"] .mp-trip-main`;

// A settings number, saved on Enter or on leaving the field, and only when it is one the plan
// takes. A value it does not take stays in the field with the reason beside it, rather than
// snapping back and being announced on every keystroke.
function NumberSetting({ label, value, rule, step, placeholder, onSave }: {
  label: string;
  value: number | null;
  rule: NumberRule;
  step?: number;
  placeholder?: string;
  onSave: (value: number | null) => void;
}) {
  const why = useId();
  const shown = value === null ? '' : String(value);
  const [text, setText] = useState(shown);
  const [problem, setProblem] = useState<string | null>(null);
  // A change from elsewhere (undo, an imported plan) shows here.
  useEffect(() => {
    setText(shown);
    setProblem(null);
  }, [shown]);
  const save = () => {
    const r = readNumber(text, rule);
    if ('problem' in r) {
      setProblem(r.problem);
      return;
    }
    setProblem(null);
    if (r.value !== value) onSave(r.value);
  };
  return (
    <span className="mp-field">
      <label>
        {label}
        <input type="number" min={rule.min} max={rule.max} step={step} value={text} placeholder={placeholder}
               aria-invalid={problem ? true : undefined} aria-describedby={problem ? why : undefined}
               onChange={(e) => setText(e.target.value)} onBlur={save}
               onKeyDown={(e) => {
                 if (e.key === 'Enter') {
                   e.preventDefault();
                   save();
                 }
               }} />
      </label>
      {problem && <span id={why} className="cart-flag mp-field-why">Not saved: {problem}.</span>}
    </span>
  );
}

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
        <NumberSetting label="people in the household" value={p.household_servings}
                       rule={SETTING_RULES.household_servings}
                       onSave={(v) => v !== null && set({ household_servings: v })} />
        <NumberSetting label="buy at most this many days ahead when the storage time is unknown (your setting)"
                       value={p.buy_ahead_days} rule={SETTING_RULES.buy_ahead_days}
                       onSave={(v) => v !== null && set({ buy_ahead_days: v })} />
        <label>
          shopping from
          <select value={Math.max(0, place)} onChange={(e) => {
            const x = PLACES[Number(e.target.value)];
            mp.dispatch({ type: 'setSettings', settings: { lat: x.lat, lon: x.lon } });
          }}>
            {PLACES.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}
          </select>
        </label>
        {/* Each saved distance clears the recipes' products and resolves them again (a model
            call on a live deployment), so it is saved once, not per keystroke. */}
        <NumberSetting label="within km" value={d.settings.max_km ?? null} rule={SETTING_RULES.max_km}
                       step={0.5} placeholder="any"
                       onSave={(v) => mp.dispatch({ type: 'setSettings', settings: { max_km: v } })} />
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
  // a product whose Options open with the trip sheet (a warning's open_options remedy)
  const [tripOptions, setTripOptions] = useState<number | null>(null);
  const [targetsOpen, setTargetsOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [hideEmpty, setHideEmpty] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [firstRun, setFirstRun] = useState(() => d.rev === 0 && Object.keys(d.recipes).length === 0);
  const [windowAsk, setWindowAsk] = useState<{ start: string; days: number; reason: string } | null>(null);
  const [importProblem, setImportProblem] = useState<string | null>(null);
  // Where focus goes once the render that moved or put something down is on screen. It is
  // state, not a ref, so it is used by the render it was asked for and by no later one: a
  // leftover request would pull focus out of whatever the shopper is typing in next.
  const [focusTo, setFocusTo] = useState<{ selector: string } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

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

  const setWindow = (start: string, days: number) => {
    const out = mp.dispatch({ type: 'setWindow', start_date: start, days });
    setWindowAsk(out.refused && /outside the new dates/.test(out.refused)
      ? { start, days, reason: out.refused } : null);
  };

  // Filling empties the tray, which disables or removes the button pressed, so focus goes to the
  // band's heading rather than being dropped on the page; the live region says what moved.
  const fill = () => {
    const out = mp.dispatch({ type: 'fillEmpty' });
    if (!out.refused) document.getElementById('mp-place')?.focus();
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

  // Every remedy that is not an edit lands here (consequences.remedyStep), so none is a button
  // that does nothing.
  const onAsk = (op: RemedyOp) => {
    switch (op.op) {
      case 'set_servings': {
        const input = document.getElementById(`mp-servings-${op.recipe_key}`);
        input?.scrollIntoView({ block: 'center' });
        input?.focus();
        if (!input) mp.announce('Say how many the recipe serves in the Pick band.');
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
          <h2 id="mp-place" tabIndex={-1}>Place</h2>
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
            <button type="button" className="mini" disabled={!trayCount} onClick={fill}>Fill empty slots</button>
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
              {fix && <><button type="button" className="linkish" onClick={() => mp.dispatch(fix.edit)}>{fix.label}</button>{' '}</>}
              <button type="button" className="linkish" onClick={mp.recheck}>Retry</button></>
          )}
        </p>
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
          <button type="button" className="secondary mini" disabled={!answer} onClick={() => setCalendarOpen(true)}>
            Add to calendar
          </button>
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
      <TripSheet date={tripSheet} optionsFor={tripOptions}
                 onClose={() => { setTripSheet(null); setTripOptions(null); }} />
      <CalendarExportDialog open={calendarOpen} onClose={() => setCalendarOpen(false)}
                            schedule={answer?.approved_schedule ?? null} current={schedule.current} />
      <TargetsEditor open={targetsOpen} onClose={() => setTargetsOpen(false)} targets={d.nutrition_targets}
                     onSave={(t) => mp.dispatch({ type: 'setTargets', targets: t }).refused} />
      <FirstRunSheet open={firstRun} onClose={() => setFirstRun(false)} onExample={() => {
        setQuickText(EXAMPLE_SENTENCE);
        window.setTimeout(() => document.getElementById('mp-quick-text')?.focus(), 0);
      }} />
    </div>
  );
}
