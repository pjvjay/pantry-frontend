// The meal plan's Shop band and what hangs off it: each trip as a sheet with its cart per store
// and its list to copy or print, the warnings with their fixes, what the data covers, the
// day-by-day actions, and the Suggest cook days proposal as a diff to apply or dismiss.
//
// Code suggests trips; only the shopper approves, moves or dismisses them. An approved trip is
// never rewritten: when edits change what it should carry it reads "Changed since approved"
// with the diff, and a price change shows as a delta (demo prices) without changing its state.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  costText, forMealsText, needText, packsText, priceDeltaText, shelfText, strategyOf, tripChipText, tripLook,
  tripPriced, tripToCartSummary,
} from '../mealplan/board';
import { productNames, remedyLabel, remedyStep, tripMoveConsequence, warningsFor } from '../mealplan/consequences';
import { dayLabel } from '../mealplan/dates';
import { MAX_PACKS, STRATEGY_NAMES, approvedElsewhere, inWindow, windowDates, windowOf } from '../mealplan/model';
import { useMealPlan } from '../mealplan/store';
import type {
  MealSchedule, PlanAction, PlanCoverage, PlanWarning, RemedyOp, Trip, TripLine, WarningCounts,
} from '../types';
import { CartCard } from './cart';
import { SourceCredits } from './nutrition';
import { Sheet } from './Sheet';

const counts = (c: WarningCounts) =>
  [c.must_fix && `${c.must_fix} must fix`, c.decide && `${c.decide} to decide`,
    c.note && `${c.note} ${c.note === 1 ? 'note' : 'notes'}`].filter(Boolean).join(', ') || 'no warnings';

// ─── Trip sheet ──────────────────────────────────────────────

// Copy and Print use the list pantry-api builds: grouped by store, then aisle, with the demo
// footer. Printing shows only that list (the @media print rules in index.css).
function useListActions(text: string) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('copied');
    } catch {
      // No clipboard API here (a plain-http host, or a browser that refuses it): the older
      // copy command still works from a selected text box in most browsers. The box goes inside
      // the open sheet: a modal dialog makes the rest of the page inert, and an inert box cannot
      // be selected.
      const box = document.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.className = 'sr-only';
      (document.querySelector('dialog[open]') ?? document.body).appendChild(box);
      box.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      box.remove();
      setCopied(ok ? 'copied' : 'failed');
    }
    window.setTimeout(() => setCopied('idle'), 2000);
  };
  const print = () => {
    document.body.classList.add('mp-printing');
    const done = () => {
      document.body.classList.remove('mp-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
    // Some browsers return from print() without an afterprint event.
    window.setTimeout(done, 1000);
  };
  return { copied, copy, print };
}

function LineRow({ ln, trip, allowFreezer }: { ln: TripLine; trip: Trip; allowFreezer: boolean }) {
  const { dispatch, state } = useMealPlan();
  const overrides = state.draft.storage_overrides;
  const shelf = shelfText(ln);
  const need = needText(ln);
  const setPacks = (packs: number | null) =>
    dispatch({ type: 'setPacks', date: trip.date, productId: ln.product.id, packs });
  const yours = ln.packs_basis === 'your_setting';
  return (
    <li className="mp-line">
      <div className="mp-line-head">
        <strong>{ln.product.name}</strong>
        {ln.product.demo_product && <span className="chip chip-warn" title="A synthetic product added for the demo starters">demo</span>}
        <span className="muted">{ln.product.unit_size}</span>
        <span className="mp-line-price">
          {ln.price === null ? <span className="cart-flag">price unknown</span> : `$${ln.price.toFixed(2)}`}
          {ln.store && <span className="muted"> at {ln.store}</span>}
        </span>
      </div>
      <div className="muted">{forMealsText(ln)}</div>
      <div className="mp-line-ctl">
        <span className="mp-stepper">
          <button type="button" className="secondary mini" aria-label={`One pack fewer of ${ln.product.name}`}
                  disabled={ln.packs === null || ln.packs <= 1}
                  onClick={() => setPacks(Math.max(1, (ln.packs ?? 1) - 1))}>−</button>
          <span className={ln.packs === null ? 'cart-flag' : undefined}>{packsText(ln)}</span>
          <button type="button" className="secondary mini" aria-label={`One pack more of ${ln.product.name}`}
                  disabled={(ln.packs ?? 0) >= MAX_PACKS}
                  onClick={() => setPacks(Math.min(MAX_PACKS, (ln.packs ?? 0) + 1))}>+</button>
          {yours && <button type="button" className="linkish" onClick={() => setPacks(null)}>use the computed count</button>}
        </span>
        {need && <span className="muted">{need}</span>}
        {ln.leftover_qty !== null && ln.need_uom && (
          <span className="muted">
            {Math.round(ln.leftover_qty)} {ln.need_uom} left over{ln.leftover_until && ` (keeps until ${dayLabel(ln.leftover_until)})`}
          </span>
        )}
        <button type="button" className="linkish" onClick={() => setPacks(0)}>leave off this trip</button>
      </div>
      <div className={shelf.level === 'cited' ? 'muted' : 'cart-flag'}>
        {shelf.text}
        {ln.shelf_life.url && <> · <a href={ln.shelf_life.url} target="_blank" rel="noreferrer">source</a></>}
        {ln.shelf_life.note && shelf.level !== 'cited' && <span className="muted" title={ln.shelf_life.note}> (why)</span>}
      </div>
      {ln.storage !== 'pantry' && allowFreezer && (
        <label className="check">
          <input type="checkbox" checked={ln.freeze_on_arrival || ln.storage === 'freezer'}
                 onChange={(e) => dispatch({ type: 'setStorage', productId: ln.product.id,
                   storage: e.target.checked ? 'freezer' : 'fridge' })} />
          Freeze on arrival
          {String(ln.product.id) in overrides && (
            <button type="button" className="linkish"
                    onClick={() => dispatch({ type: 'setStorage', productId: ln.product.id, storage: null })}>
              let the plan choose
            </button>
          )}
        </label>
      )}
      {!ln.stocked && <div className="cart-flag">No store in range stocks it now.</div>}
      {priceDeltaText(ln.price_delta) && <div className="cart-flag">Price changed: {priceDeltaText(ln.price_delta)}</div>}
    </li>
  );
}

export function TripSheet({ date, onClose }: { date: string | null; onClose: () => void }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const strategy = d.prefs.strategy;
  const trip = date ? strategyOf(mp.schedule.answer, strategy)?.trips.find((t) => t.date === date) : undefined;
  const [moveTo, setMoveTo] = useState('');
  const list = useListActions(trip?.list_text ?? '');
  useEffect(() => setMoveTo(''), [date]);
  const others = useMemo(() => windowDates(windowOf(d)).filter((x) => x !== date
    && !d.trips.some((t) => t.date === x)), [d, date]);
  if (!date) return null;
  if (!trip) {
    return (
      <Sheet open onClose={onClose} title={`Shopping trip ${dayLabel(date)}`}>
        <p className="muted">This trip is not in the latest answer: the plan changed. Close and open it again from its Shop row.</p>
      </Sheet>
    );
  }
  const elsewhere = approvedElsewhere(d, trip.date, strategy);
  const look = tripLook(trip, elsewhere);
  const approvedOne = look.kind !== 'suggested';
  const preview = moveTo ? tripMoveConsequence(mp.schedule.answer, strategy, trip.id, moveTo) : null;
  const act = (e: Parameters<typeof mp.dispatch>[0], close = false) => {
    const out = mp.dispatch(e);
    if (close && !out.refused) onClose();
  };
  const delta = priceDeltaText(trip.price_delta);
  return (
    <Sheet open onClose={onClose} title={`Shopping trip ${dayLabel(trip.date)}`}
           description={`${STRATEGY_NAMES[strategy]} · ${tripChipText(trip, elsewhere)}`}
           footer={<>
             <button type="button" className="secondary" onClick={() => void list.copy()}>
               {list.copied === 'copied' ? 'Copied' : list.copied === 'failed' ? 'Copy failed' : 'Copy list'}
             </button>
             <button type="button" className="secondary" onClick={list.print}>Print list</button>
             {look.kind === 'suggested' && (
               <>
                 <button type="button" className="secondary" onClick={() => act({ type: 'dismissTrip', date: trip.date }, true)}>Dismiss</button>
                 <button type="button" disabled={!mp.schedule.current} onClick={() => {
                   const out = mp.approveTrip(trip, strategy);
                   if (!out.refused) onClose();
                 }}>{mp.schedule.current ? 'Approve' : 'Checking…'}</button>
               </>
             )}
             {elsewhere && (
               <button type="button" disabled={!mp.schedule.current} onClick={() => {
                 const out = mp.approveTrip(trip, strategy, true);
                 if (!out.refused) onClose();
               }}>{mp.schedule.current ? 'Approve this list instead' : 'Checking…'}</button>
             )}
             {approvedOne && (
               <button type="button" className="secondary" onClick={() => act({ type: 'unapproveTrip', date: trip.date })}>
                 Take the approval back
               </button>
             )}
           </>}>
      <p className={`mp-trip-status mp-trip-${look.kind}`}>
        {look.mark && <span aria-hidden="true">{look.mark} </span>}{look.word}
        {look.kind === 'approved' && <span className="muted"> · code will not rewrite this list</span>}
      </p>
      {elsewhere && (
        <p>
          You approved this day's {STRATEGY_NAMES[elsewhere]} list. Below is the {STRATEGY_NAMES[strategy]}
          {' '}list for the same day; approving it replaces that approval.
        </p>
      )}
      <p>{trip.reason}</p>
      {trip.diff && trip.diff.text.length > 0 && (
        <div className="mp-diff" role="group" aria-label="Changed since approved">
          <strong>Changed since you approved it:</strong>
          <ul>{trip.diff.text.map((t) => <li key={t}><code>{t}</code></li>)}</ul>
          <button type="button" className="mini" disabled={!mp.schedule.current}
                  onClick={() => mp.approveTrip(trip, strategy)}>
            {mp.schedule.current ? 'Approve with these changes' : 'Checking…'}
          </button>
        </div>
      )}
      {delta && <p className="cart-flag">Trip total: {delta}</p>}
      {trip.not_stocked.length > 0 && (
        <p className="cart-flag">Not stocked within range: {trip.not_stocked.join(', ')}</p>
      )}
      <CartCard summary={tripToCartSummary(trip)} listText={trip.list_text} />
      <h4>Each item</h4>
      <ul className="mp-lines">
        {trip.lines.map((ln) => <LineRow key={ln.product.id} ln={ln} trip={trip} allowFreezer={d.prefs.allow_freezer} />)}
      </ul>
      {trip.dismissed.length > 0 && (
        <>
          <h4>Left off this trip by you</h4>
          <ul className="mp-lines">
            {trip.dismissed.map((p) => (
              <li key={p.id}>
                {p.name}{' '}
                <button type="button" className="linkish"
                        onClick={() => mp.dispatch({ type: 'setPacks', date: trip.date, productId: p.id, packs: null })}>
                  put it back
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {look.kind === 'suggested' && (
        <div className="form-row">
          <label>
            Move this trip to
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
              <option value="">choose a day</option>
              {others.map((x) => <option key={x} value={x}>{dayLabel(x)}</option>)}
            </select>
          </label>
          <button type="button" className="secondary" disabled={!moveTo}
                  onClick={() => act({ type: 'moveTrip', from: trip.date, to: moveTo }, true)}>Move</button>
          {preview && (
            <p className={preview.level === 'warn' ? 'cart-flag' : 'muted'}>
              Preview: {preview.lines.join(' ')}
            </p>
          )}
        </div>
      )}
      <p className="muted">Store hours not checked. {mp.schedule.answer?.synthetic_notice}</p>
      {createPortal(<pre className="mp-print">{trip.list_text}</pre>, document.body)}
    </Sheet>
  );
}

// ─── Warnings ────────────────────────────────────────────────

const LEVEL_NAMES = { must_fix: 'Must fix', decide: 'To decide', note: 'Notes' } as const;

// Other products for a line come with the alternatives dialog, which this console does not have
// yet, so that remedy is not offered rather than offered and not kept.
const shown = (op: RemedyOp) => op.op !== 'open_options';

export function WarningsPanel({ schedule, onAsk }: {
  schedule: MealSchedule;
  // a remedy that needs the shopper first: a number, a trip to look at, a slow call
  onAsk: (op: RemedyOp) => void;
}) {
  const mp = useMealPlan();
  const strategy = mp.state.draft.prefs.strategy;
  const list = warningsFor(schedule, strategy);
  const names = productNames(schedule);
  if (!list.length) return <p className="muted">No warnings for this plan.</p>;
  const groups = (['must_fix', 'decide', 'note'] as const)
    .map((level) => [level, list.filter((w) => w.level === level)] as const)
    .filter(([, ws]) => ws.length);
  const run = (op: RemedyOp) => {
    const r = remedyStep(op, mp.state);
    if ('edit' in r) mp.dispatch(r.edit);
    else onAsk(op);
  };
  return (
    <div className="mp-warnings">
      {groups.map(([level, ws]) => (
        <details key={level} open={level !== 'note'} className={`mp-warn-group mp-warn-${level}`}>
          <summary>{level === 'must_fix' ? '⚠ ' : ''}{LEVEL_NAMES[level]} ({ws.length})</summary>
          <ul>
            {ws.map((w: PlanWarning, i) => (
              <li key={`${w.code}-${i}`}>
                <span>{w.message}</span>
                {w.remedies.some(shown) && (
                  <span className="mp-remedies">
                    {w.remedies.filter(shown).map((op, j) => (
                      <button key={j} type="button" className="secondary mini" onClick={() => run(op)}>
                        {remedyLabel(op, mp.state, names)}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

// ─── Coverage ────────────────────────────────────────────────

export function CoverageChips({ coverage }: { coverage: PlanCoverage }) {
  const c = coverage;
  return (
    <div className="mp-coverage" aria-label="What the data covers">
      <span className="chip" title="Storage times quoted from a cited source">
        storage time cited for {c.freshness_cited} of {c.products} products
      </span>
      {c.freshness_your_setting > 0 && (
        <span className="chip chip-warn" title="No cited time: your buy-ahead setting limits them">
          {c.freshness_your_setting} follow your buy-ahead setting
        </span>
      )}
      {c.freshness_unknown > 0 && (
        <span className="chip chip-warn" title="Shelf-stable or frozen with no cited time: no limit is claimed">
          {c.freshness_unknown} with no storage time
        </span>
      )}
      <span className={`chip ${c.amounts_known < c.needs ? 'chip-warn' : ''}`}>
        amounts known for {c.amounts_known} of {c.needs} needs
      </span>
      <span className={`chip ${c.nutrition === 'computed' ? '' : 'chip-warn'}`}>
        nutrition {c.nutrition === 'computed' ? 'computed' : c.nutrition === 'not_deployed' ? 'not deployed' : 'unknown'}
      </span>
    </div>
  );
}

// ─── The Shop band ───────────────────────────────────────────

const KIND_MARK: Record<PlanAction['kind'], string> = { shop: '🛒', freeze: '❄', thaw: '↘', cook: '🍳' };

export function ShopPanel({ schedule, onOpenTrip }: { schedule: MealSchedule; onOpenTrip: (date: string) => void }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const strategy = d.prefs.strategy;
  const st = strategyOf(schedule, strategy);
  const [addOn, setAddOn] = useState('');
  const free = windowDates(windowOf(d)).filter((x) => !st?.trips.some((t) => t.date === x));
  // Days approved under the other strategy that this strategy buys nothing on: listed so the
  // approval can still be taken back from here.
  const elsewhereOnly = d.trips.filter((a) => a.strategy !== strategy && !st?.trips.some((t) => t.date === a.date));
  const actionsByDate = useMemo(() => {
    const out = new Map<string, PlanAction[]>();
    for (const a of st?.actions ?? []) out.set(a.date, [...(out.get(a.date) ?? []), a]);
    return [...out.entries()];
  }, [st]);
  return (
    <div className="mp-shop-panel">
      <fieldset className="mp-strategy">
        <legend>How to shop</legend>
        {schedule.strategies.map((s) => (
          <label key={s.name} className="check">
            <input type="radio" name="mp-strategy" checked={strategy === s.name}
                   onChange={() => mp.dispatch({ type: 'setPrefs', prefs: { strategy: s.name } })} />
            {STRATEGY_NAMES[s.name]}{s.recommended ? ' (recommended)' : ''}
            <span className="muted">
              {' '}· {s.trips.length} trips · {costText(s.total_cost, s.total_is_floor, s.trips.some(tripPriced))}
              {' '}· {counts(s.warning_counts)}
            </span>
          </label>
        ))}
      </fieldset>
      {!st?.trips.length && <p className="muted">No trips yet: trips appear once meals are on the calendar.</p>}
      <ul className="mp-trip-list">
        {st?.trips.map((t) => {
          const elsewhere = approvedElsewhere(d, t.date, strategy);
          const look = tripLook(t, elsewhere);
          return (
            <li key={t.id} className={`mp-trip-card mp-trip-${look.kind}`}>
              <div>
                <strong>{dayLabel(t.date)}</strong> · {tripChipText(t, elsewhere)}
                {priceDeltaText(t.price_delta) && <span className="cart-flag"> · {priceDeltaText(t.price_delta)}</span>}
              </div>
              <div className="muted">{t.reason}</div>
              {t.diff && t.diff.text.length > 0 && (
                <div className="cart-flag">Changed since you approved it: {t.diff.text.join(', ')}</div>
              )}
              <div className="mp-trip-actions">
                <button type="button" className="secondary mini" onClick={() => onOpenTrip(t.date)}>Open list</button>
                {look.kind === 'suggested' ? (
                  <>
                    <button type="button" className="mini" disabled={!mp.schedule.current}
                            onClick={() => mp.approveTrip(t, strategy)}>
                      {mp.schedule.current ? 'Approve' : 'Checking…'}
                    </button>
                    <button type="button" className="secondary mini"
                            onClick={() => mp.dispatch({ type: 'dismissTrip', date: t.date })}>Dismiss</button>
                  </>
                ) : (
                  <>
                    {look.kind === 'elsewhere' && (
                      <button type="button" className="mini" disabled={!mp.schedule.current}
                              onClick={() => mp.approveTrip(t, strategy, true)}>
                        {mp.schedule.current ? 'Approve this list instead' : 'Checking…'}
                      </button>
                    )}
                    <button type="button" className="secondary mini"
                            onClick={() => mp.dispatch({ type: 'unapproveTrip', date: t.date })}>Take the approval back</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
        {elsewhereOnly.map((a) => (
          <li key={`approved-${a.date}`} className="mp-trip-card mp-trip-elsewhere">
            <div>
              <strong>{dayLabel(a.date)}</strong> · <span aria-hidden="true">✓ </span>Approved under {STRATEGY_NAMES[a.strategy]}
            </div>
            <div className="muted">{STRATEGY_NAMES[strategy]} buys nothing on this day.</div>
            <div className="mp-trip-actions">
              <button type="button" className="secondary mini"
                      onClick={() => mp.dispatch({ type: 'unapproveTrip', date: a.date })}>Take the approval back</button>
            </div>
          </li>
        ))}
      </ul>
      {d.dismissed_dates.length > 0 && (
        <p className="muted">
          Dismissed: {d.dismissed_dates.filter((x) => inWindow(windowOf(d), x)).map((x) => (
            <button key={x} type="button" className="linkish" onClick={() => mp.dispatch({ type: 'restoreTrip', date: x })}>
              {dayLabel(x)} (restore)
            </button>
          ))}
        </p>
      )}
      <div className="form-row">
        <label>
          Add a trip on
          <select value={addOn} onChange={(e) => setAddOn(e.target.value)}>
            <option value="">choose a day</option>
            {free.map((x) => <option key={x} value={x}>{dayLabel(x)}</option>)}
          </select>
        </label>
        <button type="button" className="secondary" disabled={!addOn}
                onClick={() => { mp.dispatch({ type: 'addTrip', date: addOn }); setAddOn(''); }}>Add trip</button>
      </div>
      {actionsByDate.length > 0 && (
        <details className="mp-actions">
          <summary>Day by day: shop, freeze, thaw and cook ({st?.actions.length})</summary>
          <ol>
            {actionsByDate.map(([date, acts]) => (
              <li key={date}>
                <strong>{dayLabel(date)}</strong>
                <ul>
                  {acts.map((a, i) => (
                    <li key={i}>
                      <span aria-hidden="true">{KIND_MARK[a.kind]} </span>{a.text}
                      {a.basis === 'cited' && <span className="muted"> · cited ({a.rule_ids.join(', ')})</span>}
                      {a.basis === 'your_setting' && <span className="muted"> · your setting</span>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </details>
      )}
      <p className="muted">{schedule.synthetic_notice}</p>
      <details className="mp-sources-wrap">
        <summary>Sources and credits</summary>
        <SourceCredits sources={schedule.sources} />
      </details>
    </div>
  );
}

// ─── Suggest cook days ───────────────────────────────────────

export function CookDaysDiff() {
  const mp = useMealPlan();
  const { status, proposal, error } = mp.cookDays;
  if (status === 'idle' && !proposal) return null;
  const meals = mp.state.draft.meals;
  const name = (id: string) => {
    const m = meals.find((x) => x.id === id);
    return m ? mp.state.titles[m.recipe_key] ?? m.recipe_key : id;
  };
  const where = (p: { date: string | null; slot: string }) => (p.date ? `${dayLabel(p.date)} ${p.slot}` : 'the tray');
  return (
    <section className="mp-proposal" aria-label="Suggested cook days">
      <h3>Suggested cook days</h3>
      {status === 'checking' && <p className="muted">Working out fresher days…</p>}
      {status === 'error' && <p className="banner banner-error">Could not suggest cook days: {error}</p>}
      {proposal && (
        <>
          {proposal.ops.length === 0 ? (
            <p>Nothing to move: every meal is already on a day that keeps its food fresh.</p>
          ) : (
            <ul className="mp-proposal-ops">
              {proposal.ops.map((op) => (
                <li key={op.meal_id}>
                  <strong>{name(op.meal_id)}</strong>: {where(op.from)} → {where(op.to)}
                  <div className="muted">{op.reason}</div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            Warnings under {STRATEGY_NAMES[mp.state.draft.prefs.strategy]}: {counts(proposal.warnings_before)} now,
            {' '}{counts(proposal.warnings_after)} after.
          </p>
        </>
      )}
      <div className="mp-trip-actions">
        {proposal && proposal.ops.length > 0 && (
          <button type="button" onClick={() => mp.applyCookDays()}>Apply</button>
        )}
        <button type="button" className="secondary" onClick={mp.dismissCookDays}>Dismiss</button>
      </div>
    </section>
  );
}
