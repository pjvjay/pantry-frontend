// The wizard's Basics stage: how long the plan runs and from when, the budget for that period,
// the household, its diet and what it avoids, where its food may come from, and where and when
// it shops. Every answer is saved in the plan (prefs and settings) as it is given. Also here:
// the shopping settings the Shopping plan stage shows, and the plan's file actions.
//
// Where the household shops and the origin rules decide which products are in range, so a
// change clears the recipes' products and checks them again (a model call on a live
// deployment): a number is saved once the shopper is done with it, never per keystroke.
import { useEffect, useId, useRef, useState } from 'react';

import { addDays, dayLabel } from '../mealplan/dates';
import {
  AVOID_TAGS, DEFAULT_ALLIES, DIETS, DIET_LABELS, SETTING_RULES, SLOTS, SLOT_LABELS, avoidOf, budgetOf, dietOf,
  readNumber,
} from '../mealplan/model';
import type { NumberRule, Slot } from '../mealplan/model';
import { exportFileName } from '../mealplan/persist';
import { useMealPlan } from '../mealplan/store';
import { alliesText, alliesToAdd, moveCountry, originRules, originSettings } from '../mealplan/wizard';
import type { OriginRules } from '../mealplan/wizard';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // Monday is 0, as the engine counts

// Shopping points, as the Planner offers them. The catalog's stores sit around downtown Vancouver.
const PLACES: { label: string; lat: number | null; lon: number | null }[] = [
  { label: 'Server default (downtown Vancouver)', lat: null, lon: null },
  { label: 'Kitsilano', lat: 49.2684, lon: -123.1683 },
  { label: 'East Vancouver', lat: 49.2765, lon: -123.07 },
  { label: 'Richmond', lat: 49.1666, lon: -123.1336 },
];

const toggle = <T,>(list: readonly T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

// A settings number, saved on Enter or on leaving the field, and only when it is one the plan
// takes. A value it does not take stays in the field with the reason beside it, rather than
// snapping back and being announced on every keystroke.
export function NumberSetting({ label, value, rule, step, placeholder, onSave }: {
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

// ─── Origin rules ────────────────────────────────────────────

function OriginRulesField() {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const r = originRules(d.settings);
  const [adding, setAdding] = useState('');
  const missing = alliesToAdd(r.allies);
  const save = (next: OriginRules) => mp.dispatch({ type: 'setSettings', settings: originSettings(next) });
  const hasRecipes = Object.keys(d.recipes).length > 0;
  const add = adding && missing.includes(adding) ? adding : missing[0] ?? '';
  return (
    <fieldset className="mp-basics-group mp-origin">
      <legend>Where food comes from</legend>
      <label className="check">
        <input type="checkbox" checked={r.excludeUS} onChange={(e) => save({ ...r, excludeUS: e.target.checked })} />
        Leave out products from the United States
      </label>
      <label className="check">
        <input type="checkbox" checked={r.preferCanada} onChange={(e) => save({ ...r, preferCanada: e.target.checked })} />
        Prefer Canadian products
      </label>
      <details className="mp-allies">
        <summary>Then prefer, in this order: {alliesText(r.allies)}</summary>
        <ol>
          {r.allies.map((c, i) => (
            <li key={c}>
              <span className="mp-ally-name">{i + 1}. {c}</span>
              <span className="mp-ally-ctl">
                {/* aria-disabled, not disabled: at either end the button keeps focus after a move */}
                <button type="button" className="secondary mini" aria-label={`Move ${c} up`}
                        aria-disabled={i === 0 || undefined}
                        onClick={() => i > 0 && save({ ...r, allies: moveCountry(r.allies, c, -1) })}>↑</button>
                <button type="button" className="secondary mini" aria-label={`Move ${c} down`}
                        aria-disabled={i === r.allies.length - 1 || undefined}
                        onClick={() => i < r.allies.length - 1 && save({ ...r, allies: moveCountry(r.allies, c, 1) })}>↓</button>
                <button type="button" className="secondary mini" aria-label={`Take ${c} off the list`}
                        onClick={() => save({ ...r, allies: r.allies.filter((x) => x !== c) })}>×</button>
              </span>
            </li>
          ))}
        </ol>
        {missing.length > 0 && (
          <div className="mp-toolbar">
            <label className="mp-inline">
              add
              <select value={add} onChange={(e) => setAdding(e.target.value)}>
                {missing.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button type="button" className="secondary mini" disabled={!add}
                    onClick={() => { save({ ...r, allies: [...r.allies, add] }); setAdding(''); }}>Add to the end</button>
          </div>
        )}
        {r.allies.join('|') !== DEFAULT_ALLIES.join('|') && (
          <button type="button" className="linkish" onClick={() => save({ ...r, allies: [...DEFAULT_ALLIES] })}>
            Use the default list and order
          </button>
        )}
      </details>
      <p className="muted">
        A preference, never a rule: most products do not say where they are from, so only the
        United States box leaves anything out.
        {hasRecipes && ' Changing these checks your recipes’ products again.'}
      </p>
    </fieldset>
  );
}

// ─── The stage ───────────────────────────────────────────────

export function BasicsStage() {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const p = d.prefs;
  const set = (prefs: Partial<typeof p>) => mp.dispatch({ type: 'setPrefs', prefs });
  const place = PLACES.findIndex((x) => x.lat === (d.settings.lat ?? null) && x.lon === (d.settings.lon ?? null));
  const [windowAsk, setWindowAsk] = useState<{ start: string; days: number; reason: string } | null>(null);
  const diet = dietOf(p);
  const avoid = avoidOf(p);

  const setWindow = (start: string, days: number) => {
    const out = mp.dispatch({ type: 'setWindow', start_date: start, days });
    setWindowAsk(out.refused && /outside the new dates/.test(out.refused)
      ? { start, days, reason: out.refused } : null);
  };

  return (
    <div className="mp-basics">
      <fieldset className="mp-basics-group">
        <legend>When</legend>
        <div className="mp-toolbar">
          <label className="mp-inline">
            starting
            <input type="date" value={d.start_date} onChange={(e) => e.target.value && setWindow(e.target.value, d.days)} />
          </label>
          <span className="mp-seg" role="group" aria-label="Plan length">
            {[7, 14].map((n) => (
              <button key={n} type="button" className={d.days === n ? 'mini' : 'secondary mini'} aria-pressed={d.days === n}
                      onClick={() => setWindow(d.start_date, n)}>{n === 7 ? '1 week' : '2 weeks'}</button>
            ))}
          </span>
        </div>
        <p className="muted">{dayLabel(d.start_date)} to {dayLabel(addDays(d.start_date, d.days - 1))}</p>
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
      </fieldset>

      <fieldset className="mp-basics-group">
        <legend>Budget and household</legend>
        <div className="form-row compact">
          <NumberSetting label={`groceries for the ${d.days === 7 ? 'week' : `${d.days} days`} ($)`}
                         value={budgetOf(p)} rule={SETTING_RULES.budget} step={1} placeholder="no budget"
                         onSave={(v) => set({ budget: v })} />
          <NumberSetting label="people in the household" value={p.household_servings}
                         rule={SETTING_RULES.household_servings}
                         onSave={(v) => v !== null && set({ household_servings: v })} />
        </div>
        <p className="muted">
          Meals shows an estimate against the budget; Ingredients and the Shopping plan show what the
          trips cost, whole packs and all.
        </p>
      </fieldset>

      <fieldset className="mp-basics-group mp-checks">
        <legend>Diet</legend>
        {DIETS.map((x) => (
          <label key={x} className="check">
            <input type="radio" name="mp-diet" checked={diet === x} onChange={() => set({ diet: x })} />
            {DIET_LABELS[x]}
          </label>
        ))}
      </fieldset>

      <fieldset className="mp-basics-group mp-checks">
        <legend>Leave out recipes with</legend>
        {AVOID_TAGS.map((t) => (
          <label key={t} className="check">
            <input type="checkbox" checked={avoid.includes(t)} onChange={() => set({ avoid: toggle(avoid, t) })} />
            {t}
          </label>
        ))}
      </fieldset>

      <OriginRulesField />

      <fieldset className="mp-basics-group">
        <legend>Where you shop</legend>
        <div className="form-row compact">
          <label>
            shopping from
            <select value={Math.max(0, place)} onChange={(e) => {
              const x = PLACES[Number(e.target.value)];
              mp.dispatch({ type: 'setSettings', settings: { lat: x.lat, lon: x.lon } });
            }}>
              {PLACES.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}
            </select>
          </label>
          <NumberSetting label="within km" value={d.settings.max_km ?? null} rule={SETTING_RULES.max_km}
                         step={0.5} placeholder="any"
                         onSave={(v) => mp.dispatch({ type: 'setSettings', settings: { max_km: v } })} />
        </div>
      </fieldset>

      <fieldset className="mp-basics-group mp-checks">
        <legend>Shop on</legend>
        {WEEKDAYS.map((w, i) => (
          <label key={w} className="check">
            <input type="checkbox" checked={p.shop_weekdays.includes(i)}
                   onChange={() => set({ shop_weekdays: toggle(p.shop_weekdays, i) })} />
            {w}
          </label>
        ))}
      </fieldset>

      <fieldset className="mp-basics-group mp-checks">
        <legend>Meals to plan</legend>
        {SLOTS.map((sl) => (
          <label key={sl} className="check">
            <input type="checkbox" checked={p.slots_on.includes(sl)}
                   onChange={() => set({ slots_on: toggle(p.slots_on, sl) as Slot[] })} />
            {SLOT_LABELS[sl]}
          </label>
        ))}
      </fieldset>
    </div>
  );
}

// The freshness and storage settings, on the Shopping plan stage.
export function ShoppingSettings() {
  const mp = useMealPlan();
  const p = mp.state.draft.prefs;
  const set = (prefs: Partial<typeof p>) => mp.dispatch({ type: 'setPrefs', prefs });
  return (
    <details className="mp-settings">
      <summary>Freshness and freezer settings</summary>
      <div className="form-row">
        <NumberSetting label="buy at most this many days ahead when the storage time is unknown (your setting)"
                       value={p.buy_ahead_days} rule={SETTING_RULES.buy_ahead_days}
                       onSave={(v) => v !== null && set({ buy_ahead_days: v })} />
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

// Export, import and clear: the plan is saved in this browser only.
export function PlanFile() {
  const mp = useMealPlan();
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const exportPlan = () => {
    const blob = new Blob([mp.exportText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFileName(mp.state);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importPlan = async (file: File | undefined) => {
    if (!file) return;
    setProblem(mp.importText(await file.text()));
    if (input.current) input.current.value = '';
  };

  return (
    <div className="mp-toolbar mp-file">
      <button type="button" className="secondary mini" onClick={exportPlan}>Export plan (.json)</button>
      <button type="button" className="secondary mini" onClick={() => input.current?.click()}>Import plan</button>
      <input ref={input} type="file" accept="application/json,.json" hidden
             onChange={(e) => void importPlan(e.target.files?.[0])} />
      <button type="button" className="secondary mini" onClick={mp.clear}>Clear the plan</button>
      {problem && <span className="cart-flag" role="alert">{problem}</span>}
    </div>
  );
}
