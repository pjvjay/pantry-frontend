// The wizard's Basics stage: how long the plan runs and from when, the budget for that period,
// the diet and what it avoids (every plan is for one person for now), where its food may come
// from, where the shopper is, and when they shop. Every answer is saved in the plan (prefs and settings) as
// it is given. A form card for each, and beside them on a wide screen a "Your plan" card that
// sums the answers up and stays in view. Also here: the shopping settings the Shopping plan
// stage shows, and the plan's file actions.
//
// Where the household shops and the origin rules decide which products are in range, so a
// change clears the recipes' products and checks them again (a model call on a live
// deployment): a number is saved once the shopper is done with it, never per keystroke. An
// address is searched through the demo hub (OpenStreetMap) only when the shopper asks, never as
// they type, and is kept in this browser only. Which stores, and how far, is chosen in
// Ingredients. The decisions are in mealplan/basics.ts.
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { HubError, geocode, getStatus } from '../hub';
import {
  AREAS, BUDGET_PICKS, CURRENT_LOCATION, PRIVACY_NOTE, areaOf, areaSettings, geocodeErrorText, locationErrorText,
  locationSettings, perDayText, placeText, planSummary, refusalCode, searchProblem,
} from '../mealplan/basics';
import { addDays, dayLabel } from '../mealplan/dates';
import {
  AVOID_TAGS, DEFAULT_ALLIES, DIETS, DIET_LABELS, SETTING_RULES, SLOTS, SLOT_LABELS, avoidOf, budgetOf, dietOf,
  readNumber,
} from '../mealplan/model';
import type { NumberRule, Slot } from '../mealplan/model';
import { exportFileName } from '../mealplan/persist';
import { useMealPlan } from '../mealplan/store';
import { alliesToAdd, moveCountry, originRules, originSettings } from '../mealplan/wizard';
import type { OriginRules } from '../mealplan/wizard';
import type { Diet, GeocodeResult } from '../types';
import { FormCard, Segmented, Switch, Tile, ToggleChip } from './fields';
import { Icon } from './icons';
import type { IconName } from './icons';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];   // Monday is 0, as the engine counts

const DIET_TILES: Record<Diet, { icon: IconName; hint: string }> = {
  any: { icon: 'plate', hint: 'Everything' },
  pescatarian: { icon: 'fish', hint: 'Fish, no meat' },
  vegetarian: { icon: 'sprout', hint: 'No meat or fish' },
  vegan: { icon: 'leaf', hint: 'Nothing from animals' },
};

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

// ─── When ────────────────────────────────────────────────────

function WhenCard() {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const head = useId();
  const [ask, setAsk] = useState<{ start: string; days: number; reason: string } | null>(null);
  const setWindow = (start: string, days: number) => {
    const out = mp.dispatch({ type: 'setWindow', start_date: start, days });
    setAsk(out.refused && /outside the new dates/.test(out.refused) ? { start, days, reason: out.refused } : null);
  };
  return (
    <FormCard icon="calendar" title="When" help="One or two weeks, from the day you choose." headId={head}>
      <div className="fc-row">
        <Segmented name="mp-period" labelledBy={head} value={d.days}
                   options={[{ value: 7, label: '1 week' }, { value: 14, label: '2 weeks' }]}
                   onChange={(n) => setWindow(d.start_date, n)} />
        <label className="fc-field">
          <span className="fc-label">Starting</span>
          <input className="fc-input" type="date" value={d.start_date}
                 onChange={(e) => e.target.value && setWindow(e.target.value, d.days)} />
        </label>
      </div>
      <p className="fc-range">
        {dayLabel(d.start_date)} <span aria-hidden="true">→</span><span className="sr-only">to</span> {dayLabel(addDays(d.start_date, d.days - 1))}
        <span className="muted"> · {d.days} days</span>
      </p>
      {ask && (
        <div className="banner banner-update">
          Not changed: {ask.reason}.{' '}
          <button type="button" className="mini" onClick={() => {
            mp.dispatch({ type: 'setWindow', start_date: ask.start, days: ask.days, unplaceOutside: true });
            setAsk(null);
          }}>Change it and send them back to the tray</button>{' '}
          <button type="button" className="secondary mini" onClick={() => setAsk(null)}>Keep the dates</button>
        </div>
      )}
    </FormCard>
  );
}

// ─── Budget ──────────────────────────────────────────────────

function BudgetCard() {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const head = useId();
  const why = useId();
  const budget = budgetOf(d.prefs);
  const shown = budget === null ? '' : String(budget);
  const [text, setText] = useState(shown);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setText(shown);
    setProblem(null);
  }, [shown]);
  const save = (raw: string) => {
    const r = readNumber(raw, SETTING_RULES.budget);
    if ('problem' in r) {
      setProblem(r.problem);
      return;
    }
    setProblem(null);
    if (r.value !== budget) mp.dispatch({ type: 'setPrefs', prefs: { budget: r.value } });
  };
  return (
    <FormCard icon="wallet" title="Budget" headId={head}
              help={`Groceries for the whole ${d.days === 7 ? 'week' : `${d.days} days`}; leave it empty for none.`}>
      <div className="fc-row">
        <label className="money">
          <span className="money-sym" aria-hidden="true">$</span>
          <input inputMode="decimal" value={text} placeholder="no budget" aria-labelledby={head}
                 aria-invalid={problem ? true : undefined} aria-describedby={problem ? why : undefined}
                 onChange={(e) => setText(e.target.value.replace(/^\$/, ''))} onBlur={() => save(text)}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') {
                     e.preventDefault();
                     save(text);
                   }
                 }} />
        </label>
        <div className="qpicks" role="group" aria-label="Quick budgets">
          {BUDGET_PICKS.map((v) => (
            <button key={v} type="button" className="qpick" aria-pressed={budget === v}
                    onClick={() => { setText(String(v)); save(String(v)); }}>${v}</button>
          ))}
          <button type="button" className="qpick" aria-pressed={budget === null}
                  onClick={() => { setText(''); save(''); }}>None</button>
        </div>
      </div>
      {problem ? <p id={why} className="cart-flag fc-note">Not saved: {problem}.</p>
        : budget !== null && <p className="fc-note"><strong>{perDayText(budget, d.days)}</strong>
          <span className="muted"> · Meals stops an Add that would pass it</span></p>}
    </FormCard>
  );
}

// ─── Diet, and what to leave out ─────────────────────────────

function DietCard() {
  const mp = useMealPlan();
  const head = useId();
  const diet = dietOf(mp.state.draft.prefs);
  return (
    <FormCard icon="sprout" title="Diet" help="Recipes that do not fit are hidden in Meals." headId={head}
              className="fc-wide">
      <div className="tiles" role="radiogroup" aria-labelledby={head}>
        {DIETS.map((x) => (
          <Tile key={x} name="mp-diet" checked={diet === x} icon={DIET_TILES[x].icon} label={DIET_LABELS[x]}
                hint={DIET_TILES[x].hint} onChange={() => mp.dispatch({ type: 'setPrefs', prefs: { diet: x } })} />
        ))}
      </div>
    </FormCard>
  );
}

function AvoidCard() {
  const mp = useMealPlan();
  const head = useId();
  const avoid = avoidOf(mp.state.draft.prefs);
  return (
    <FormCard icon="ban" title="Leave out" help="Recipes with any of these are hidden too." headId={head}>
      <div className="chips" role="group" aria-labelledby={head}>
        {AVOID_TAGS.map((t) => (
          <ToggleChip key={t} checked={avoid.includes(t)}
                      onChange={() => mp.dispatch({ type: 'setPrefs', prefs: { avoid: toggle(avoid, t) } })}>
            {t}
          </ToggleChip>
        ))}
      </div>
    </FormCard>
  );
}

// ─── Origin rules ────────────────────────────────────────────

function OriginCard() {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const head = useId();
  const r = originRules(d.settings);
  const [adding, setAdding] = useState('');
  const missing = alliesToAdd(r.allies);
  const save = (next: OriginRules) => mp.dispatch({ type: 'setSettings', settings: originSettings(next) });
  const add = adding && missing.includes(adding) ? adding : missing[0] ?? '';
  return (
    <FormCard icon="globe" title="Where food comes from" headId={head} className="fc-wide"
              help={`A preference, never a rule: most products do not say where they are from, so only the first switch leaves anything out.${Object.keys(d.recipes).length ? ' Changing these checks your recipes’ products again.' : ''}`}>
      <div className="switches" role="group" aria-labelledby={head}>
        <Switch checked={r.excludeUS} onChange={(on) => save({ ...r, excludeUS: on })}
                hint="Products evidenced as from the United States are held back">
          Leave out US products
        </Switch>
        <Switch checked={r.preferCanada} onChange={(on) => save({ ...r, preferCanada: on })}
                hint="Canadian products first, when a choice is close">
          Prefer Canadian products
        </Switch>
      </div>
      <p className="fc-sub">Then prefer, in this order</p>
      <ol className="cchips">
        {r.allies.map((c, i) => (
          <li key={c} className="cchip">
            <span className="cchip-n" aria-hidden="true">{i + 1}</span>
            <span className="cchip-name">{c}</span>
            {/* aria-disabled, not disabled: at either end the button keeps focus after a move */}
            <button type="button" className="cchip-btn" aria-label={`Move ${c} earlier`}
                    aria-disabled={i === 0 || undefined}
                    onClick={() => i > 0 && save({ ...r, allies: moveCountry(r.allies, c, -1) })}>‹</button>
            <button type="button" className="cchip-btn" aria-label={`Move ${c} later`}
                    aria-disabled={i === r.allies.length - 1 || undefined}
                    onClick={() => i < r.allies.length - 1 && save({ ...r, allies: moveCountry(r.allies, c, 1) })}>›</button>
            <button type="button" className="cchip-btn" aria-label={`Take ${c} off the list`}
                    onClick={() => save({ ...r, allies: r.allies.filter((x) => x !== c) })}>×</button>
          </li>
        ))}
        {!r.allies.length && <li className="muted">No other countries.</li>}
      </ol>
      <div className="fc-row">
        {missing.length > 0 && (
          <>
            <label className="fc-field fc-inline">
              <span className="fc-label">Add</span>
              <select className="fc-input" value={add} onChange={(e) => setAdding(e.target.value)}>
                {missing.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <button type="button" className="secondary mini" disabled={!add}
                    onClick={() => { save({ ...r, allies: [...r.allies, add] }); setAdding(''); }}>Add to the end</button>
          </>
        )}
        {r.allies.join('|') !== DEFAULT_ALLIES.join('|') && (
          <button type="button" className="linkish" onClick={() => save({ ...r, allies: [...DEFAULT_ALLIES] })}>
            Use the default list and order
          </button>
        )}
      </div>
    </FormCard>
  );
}

// ─── Where you are ───────────────────────────────────────────

type Search =
  | { status: 'idle' | 'busy' }
  | { status: 'ok'; results: GeocodeResult[]; attribution: string }
  | { status: 'error'; error: string };

function WhereCard() {
  const mp = useMealPlan();
  const st = mp.state.draft.settings;
  const head = useId();
  const [geocoder, setGeocoder] = useState(false);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState<Search>({ status: 'idle' });
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const ctl = useRef<AbortController | null>(null);

  // Address search needs the demo hub's geocoder; without it the rest still works.
  useEffect(() => {
    getStatus().then((s) => setGeocoder(Boolean(s.geocoder))).catch(() => setGeocoder(false));
    return () => ctl.current?.abort();
  }, []);

  const set = (patch: typeof st) => mp.dispatch({ type: 'setSettings', settings: patch });

  // Only on Search or Enter: OpenStreetMap's policy forbids searching as one types.
  const find = (e: FormEvent) => {
    e.preventDefault();
    const problem = searchProblem(q);
    if (problem) {
      setSearch({ status: 'error', error: problem });
      return;
    }
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    setSearch({ status: 'busy' });
    geocode(q.trim(), c.signal).then((a) => {
      setSearch({ status: 'ok', results: a.results.slice(0, 5), attribution: a.attribution });
    }).catch((err: unknown) => {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const status = err instanceof HubError ? err.status : 0;
      setSearch({ status: 'error', error: geocodeErrorText(status, err instanceof HubError ? refusalCode(err.detail) : null) });
    });
  };

  const pick = (r: GeocodeResult) => {
    set({ lat: r.lat, lon: r.lon, address: r.label.slice(0, 200) });
    setSearch({ status: 'idle' });
    setQ('');
    box.current?.focus();
  };

  const locate = () => {
    setLocError(null);
    if (!('geolocation' in navigator)) {
      setLocError(locationErrorText('unsupported'));
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition((pos) => {
      setLocating(false);
      const where = locationSettings(pos.coords.latitude, pos.coords.longitude);
      if (where) set(where);
      else setLocError(locationErrorText(2));
    }, (err) => {
      setLocating(false);
      setLocError(locationErrorText(err.code));
    }, { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
  };

  const area = st.address && st.address !== areaOf(st)?.label ? null : areaOf(st);
  const results = search.status === 'ok' ? search.results : [];

  return (
    <FormCard icon="pin" title="Where you are" headId={head} className="fc-wide"
              help="Only roughly: it finds the stores near you, which you choose in Ingredients.">
      <p className="fc-place"><Icon name="pin" size={16} /> <strong>{placeText(st)}</strong></p>
      {geocoder && (
        <form className="search" role="search" aria-label="Search an address" onSubmit={find}>
          <span className="search-ico"><Icon name="search" size={18} /></span>
          <input ref={box} className="search-input" value={q} maxLength={200} autoComplete="street-address"
                 placeholder="Street, place or postcode" aria-label="Address"
                 onChange={(e) => setQ(e.target.value)} />
          <button type="submit" className="mini" disabled={search.status === 'busy'}>
            {search.status === 'busy' ? 'Searching…' : 'Search'}
          </button>
        </form>
      )}
      {search.status === 'error' && <p className="cart-flag fc-note" role="alert">{search.error}</p>}
      {search.status === 'ok' && (
        <div className="geo">
          {results.length ? (
            <ul className="geo-list" aria-label="Places found">
              {results.map((r) => (
                <li key={`${r.lat},${r.lon},${r.label}`}>
                  <button type="button" className="geo-pick" onClick={() => pick(r)}>
                    <Icon name="pin" size={16} /><span>{r.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="muted fc-note" role="status">No place found: try a street with its city, or a postcode.</p>}
          {search.attribution && <p className="geo-attr">{search.attribution}</p>}
        </div>
      )}
      <div className="fc-row">
        <button type="button" className="secondary mini btn-ico" onClick={locate} disabled={locating}>
          <Icon name="locate" size={16} />{locating ? 'Finding you…' : 'Use my current location'}
        </button>
        {st.address === CURRENT_LOCATION && <span className="muted">to four decimals, about 10 m</span>}
      </div>
      {locError && <p className="cart-flag fc-note" role="alert">{locError}</p>}
      <p className="fc-sub">Or a demo area in Vancouver</p>
      <div className="chips" role="radiogroup" aria-label="Demo areas">
        {AREAS.map((a) => (
          <label key={a.id} className="tchip tchip-plain">
            <input type="radio" name="mp-area" checked={area?.id === a.id} onChange={() => set(areaSettings(a))} />
            <span>{a.label}</span>
          </label>
        ))}
      </div>
      <p className="fc-privacy">{PRIVACY_NOTE}</p>
    </FormCard>
  );
}

// ─── When to shop, and what to plan ──────────────────────────

function DaysCard() {
  const mp = useMealPlan();
  const p = mp.state.draft.prefs;
  const head = useId();
  return (
    <FormCard icon="cart" title="Shop on" help="Trips are suggested only on these days." headId={head}
              className="fc-wide">
      <div className="chips" role="group" aria-labelledby={head}>
        {WEEKDAYS.map((w, i) => (
          <ToggleChip key={w} plain checked={p.shop_weekdays.includes(i)}
                      onChange={() => mp.dispatch({ type: 'setPrefs', prefs: { shop_weekdays: toggle(p.shop_weekdays, i) } })}>
            {w}
          </ToggleChip>
        ))}
      </div>
    </FormCard>
  );
}

function SlotsCard() {
  const mp = useMealPlan();
  const p = mp.state.draft.prefs;
  const head = useId();
  return (
    <FormCard icon="utensils" title="Meals to plan" help="The calendar has a row for each." headId={head}>
      <div className="chips" role="group" aria-labelledby={head}>
        {SLOTS.map((sl) => (
          <ToggleChip key={sl} plain checked={p.slots_on.includes(sl)}
                      onChange={() => mp.dispatch({ type: 'setPrefs', prefs: { slots_on: toggle(p.slots_on, sl) as Slot[] } })}>
            {SLOT_LABELS[sl]}
          </ToggleChip>
        ))}
      </div>
    </FormCard>
  );
}

// ─── Your plan ───────────────────────────────────────────────

const SUMMARY_ICONS: Record<string, IconName> = {
  when: 'calendar', budget: 'wallet', diet: 'sprout', avoid: 'ban', origin: 'globe', where: 'pin', days: 'cart',
  meals: 'utensils',
};

function Summary() {
  const mp = useMealPlan();
  const rows = planSummary(mp.state.draft);
  return (
    <aside className="sum" aria-labelledby="mp-sum-head">
      <h3 id="mp-sum-head" className="sum-title"><Icon name="sparkle" size={18} /> Your plan</h3>
      <dl className="sum-list">
        {rows.map((r) => (
          <div key={r.key} className="sum-row">
            <dt><Icon name={SUMMARY_ICONS[r.key]} size={16} />{r.label}</dt>
            <dd>{r.value}{r.note && <span className="sum-note">{r.note}</span>}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

// ─── The stage ───────────────────────────────────────────────

export function BasicsStage() {
  return (
    <div className="bx">
      <div className="bx-forms">
        <WhenCard />
        <BudgetCard />
        <DietCard />
        <AvoidCard />
        <SlotsCard />
        <WhereCard />
        <OriginCard />
        <DaysCard />
      </div>
      <Summary />
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
