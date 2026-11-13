// The meal plan's Shop stage, its trips, and what hangs off them: each trip as a card (Shop this
// trip once approved, Open list, Approve, Dismiss, Move) with Approve all over them, each trip as a
// sheet with its cart per store and its list to copy or print, the warnings with their fixes, what
// the data covers, the day-by-day actions, and the Suggest cook days proposal as a diff to apply
// or dismiss. The stage's list for the whole period, "Check your plan" and the two ways to shop
// are in components/shoplist.tsx.
//
// Code suggests trips; only the shopper approves, moves or dismisses them. An approved trip is
// never rewritten: when edits change what it should carry it reads "Changed since approved"
// with the diff, and a price change shows as a delta (demo prices) without changing its state.
// Approve stays Approve while the trips are worked out again after an edit: pressed then, it
// waits for the new answer and approves from it only a list the shopper saw (mealplan/store.tsx).
// A trip's state is a Tag (matchmarks.tsx TripTag); the sheet's total is the groceries, and its cart
// card's, titled so, the groceries and travel. Each item in the sheet says where its product comes
// from in the origin tag that Shop's list and in-store mode wear (matchmarks.tsx OriginTag), and a
// trip that buys a product against the plan's country rule (planned or approved before its
// evidence came in) says so on its card and in its sheet.
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { sizeInName } from '../alternatives';
import {
  costText, forMealsText, needText, packsText, priceDeltaText, shelfText, strategyOf, tripLook, tripMoveDays, tripPriced,
  tripToCartSummary,
} from '../mealplan/board';
import {
  productNames, remedyLabel, remedyStep, tripMoveConsequence, warningRows, warningsFor,
} from '../mealplan/consequences';
import { dayLabel } from '../mealplan/dates';
import { MAX_PACKS, STRATEGY_NAMES, approvedElsewhere, inWindow, windowDates, windowOf } from '../mealplan/model';
import { tripLineKey, tripOptionsLabel } from '../mealplan/options';
import { againstRule, countryRules, originWords } from '../mealplan/origin';
import { shopRows, warningCountsText } from '../mealplan/shoplist';
import { useMealPlan } from '../mealplan/store';
import { hrefFor } from '../routes';
import type {
  MealSchedule, PlanAction, PlanCoverage, RemedyOp, Trip, TripLine,
} from '../types';
import { CartCard, copyText } from './cart';
import { SourceCredits } from './nutrition';
import { Sheet } from './Sheet';
import { TripLineOptionsDialog } from './tripoptions';
import { Icon } from './icons';
import type { IconName } from './icons';
import { OriginTag, TripTag } from './matchmarks';
import { Notice } from './ui';

// A trip card's "Shop this trip", which Done shopping in the store brings focus back to, and its
// "Open list", which stays on the card whatever state the trip is in.
export const shopTripSelector = (date: string) => `[data-shop-trip="${CSS.escape(date)}"]`;
const openTripSelector = (date: string) => `[data-open-trip="${CSS.escape(date)}"]`;

// ─── Trip sheet ──────────────────────────────────────────────

// Copy and Print use the list pantry-api builds: grouped by store, then aisle, with the demo
// footer. Printing shows only that list (the @media print rules in index.css).
function useListActions(text: string) {
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    setCopied(await copyText(text) ? 'copied' : 'failed');
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

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// A storage time cited from a source is plain; one that follows the shopper's setting or is not
// known says so with a sign.
const SHELF_CLASS = { cited: 'muted', yours: 'mp-unknown', unknown: 'mp-unknown' } as const;

function LineRow({ ln, trip, allowFreezer, onOptions }: { ln: TripLine; trip: Trip; allowFreezer: boolean;
  onOptions: (ln: TripLine) => void }) {
  const { dispatch, state } = useMealPlan();
  const overrides = state.draft.storage_overrides;
  const shelf = shelfText(ln);
  const need = needText(ln);
  const setPacks = (packs: number | null) =>
    dispatch({ type: 'setPacks', date: trip.date, productId: ln.product.id, packs });
  const yours = ln.packs_basis === 'your_setting';
  const delta = priceDeltaText(ln.price_delta);
  const origin = originWords(ln.origin, countryRules(state.draft.settings));
  return (
    <li className="mp-line">
      <div className="mp-line-head">
        <strong>{ln.product.name}</strong>
        {/* a few products are the demo's own: a quiet word, since it differs from line to line */}
        {ln.product.demo_product && <span className="muted" title="A synthetic product added for the demo starters">demo product</span>}
        {!sizeInName(ln.product.name, ln.product.unit_size) && <span className="muted">{ln.product.unit_size}</span>}
        <span className="mp-line-price">
          {ln.price === null ? <span className="mp-unknown"><Icon name="help" size={13} />price unknown</span> : `$${ln.price.toFixed(2)}`}
          {ln.store && <span className="muted"> at {ln.store}</span>}
        </span>
        {/* The chat cart's Options dialog, for this purchase (components/tripoptions.tsx). */}
        <button type="button" className="btn btn-secondary btn-sm mp-line-options" aria-haspopup="dialog"
                aria-label={tripOptionsLabel(ln)} data-trip-line={tripLineKey(trip.date, ln.product.id)}
                onClick={() => onOptions(ln)}>Options<Icon name="chevron-right" size={14} /></button>
      </div>
      <div className="muted">{forMealsText(ln)}</div>
      {origin && <div className="mp-line-origin"><OriginTag words={origin} /></div>}
      <div className="mp-line-ctl">
        <span className="mp-stepper">
          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label={`One pack fewer of ${ln.product.name}`}
                  disabled={ln.packs === null || ln.packs <= 1}
                  onClick={() => setPacks(Math.max(1, (ln.packs ?? 1) - 1))}><Icon name="minus" size={14} /></button>
          <span className={ln.packs === null ? 'mp-unknown' : undefined}>{packsText(ln)}</span>
          <button type="button" className="btn btn-secondary btn-sm btn-icon" aria-label={`One pack more of ${ln.product.name}`}
                  disabled={(ln.packs ?? 0) >= MAX_PACKS}
                  onClick={() => setPacks(Math.min(MAX_PACKS, (ln.packs ?? 0) + 1))}><Icon name="plus" size={14} /></button>
          {yours && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPacks(null)}>Use the computed count</button>}
        </span>
        {need && <span className="muted">{need}</span>}
        {ln.leftover_qty !== null && ln.need_uom && (
          <span className="muted">
            {Math.round(ln.leftover_qty)} {ln.need_uom} left over{ln.leftover_until && ` (keeps until ${dayLabel(ln.leftover_until)})`}
          </span>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPacks(0)}>Leave off this trip</button>
      </div>
      <div className={SHELF_CLASS[shelf.level]}>
        {shelf.level !== 'cited' && <Icon name="help" size={13} />}
        {shelf.text}
        {ln.shelf_life.url && <> · <a href={ln.shelf_life.url} target="_blank" rel="noreferrer">source</a></>}
        {ln.shelf_life.note && shelf.level !== 'cited' && <span className="muted" title={ln.shelf_life.note}> (why)</span>}
      </div>
      {ln.storage !== 'pantry' && allowFreezer && (
        <div className="mp-line-freeze">
          <label className="check">
            <input type="checkbox" checked={ln.freeze_on_arrival || ln.storage === 'freezer'}
                   onChange={(e) => dispatch({ type: 'setStorage', productId: ln.product.id,
                     storage: e.target.checked ? 'freezer' : 'fridge' })} />
            Freeze on arrival
          </label>
          {String(ln.product.id) in overrides && (
            <button type="button" className="btn btn-ghost btn-sm"
                    onClick={() => dispatch({ type: 'setStorage', productId: ln.product.id, storage: null })}>
              Let the plan choose
            </button>
          )}
        </div>
      )}
      {!ln.stocked && <p className="mp-note-warn"><Icon name="alert" size={14} />No store in range stocks it now.</p>}
      {delta && <p className="mp-note"><Icon name="refresh" size={14} />Price changed: {delta}</p>}
    </li>
  );
}

// optionsFor: a product whose Options open with the sheet (a warning's open_options remedy).
export function TripSheet({ date, onClose, optionsFor = null }: { date: string | null; onClose: () => void;
  optionsFor?: number | null }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const strategy = d.prefs.strategy;
  const trip = date ? strategyOf(mp.schedule.answer, strategy)?.trips.find((t) => t.date === date) : undefined;
  const [moveTo, setMoveTo] = useState('');
  const [options, setOptions] = useState<{ productId: number; name: string } | null>(null);
  const list = useListActions(trip?.list_text ?? '');
  useEffect(() => setMoveTo(''), [date]);
  useEffect(() => {
    setOptions(date && optionsFor !== null ? { productId: optionsFor, name: '' } : null);
  }, [date, optionsFor]);
  const optionsName = options?.name
    || trip?.lines.find((ln) => ln.product.id === options?.productId)?.product.name || '';
  const optionsDialog = date && (
    <TripLineOptionsDialog date={date} productId={options?.productId ?? null} productName={optionsName}
                           onClose={() => setOptions(null)} />
  );
  const others = useMemo(() => (date ? tripMoveDays(d, date) : []), [d, date]);
  if (!date) return null;
  if (!trip) {
    return (
      <Sheet open onClose={onClose} title={`Shopping trip ${dayLabel(date)}`}>
        <p className="muted">This trip is not in the latest answer: the plan changed. Close and open it again from its Shop row.</p>
        {optionsDialog}
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
  const approve = (replace = false) => {
    const out = mp.approveTrip(trip, strategy, replace);
    if (!out.refused) onClose();
  };
  const delta = priceDeltaText(trip.price_delta);
  const against = againstRule(countryRules(d.settings), shopRows(trip));
  // the groceries alone, named so: the cart card below adds the travel, under its own title
  const groceries = costText(trip.total_cost, trip.total_is_floor, tripPriced(trip));
  return (
    <Sheet open onClose={onClose} title={`Shopping trip ${dayLabel(trip.date)}`}
           description={[STRATEGY_NAMES[strategy], plural(trip.stores.length, 'store', 'stores'),
             `groceries ${groceries}`, plural(trip.lines.length, 'item', 'items')].join(' · ')}
           footer={<>
             <button type="button" className="btn btn-secondary" onClick={() => void list.copy()}>
               <Icon name="copy" size={16} />
               {list.copied === 'copied' ? 'Copied' : list.copied === 'failed' ? 'Copy failed' : 'Copy list'}
             </button>
             <button type="button" className="btn btn-secondary" onClick={list.print}>
               <Icon name="printer" size={16} />Print list
             </button>
             {look.kind === 'suggested' && (
               <>
                 <button type="button" className="btn btn-secondary" onClick={() => act({ type: 'dismissTrip', date: trip.date }, true)}>Dismiss</button>
                 <button type="button" className="btn btn-primary" onClick={() => approve()}>Approve</button>
               </>
             )}
             {elsewhere && (
               <button type="button" className="btn btn-primary" onClick={() => approve(true)}>Approve this list instead</button>
             )}
             {approvedOne && (
               <button type="button" className="btn btn-secondary" onClick={() => act({ type: 'unapproveTrip', date: trip.date })}>
                 Take the approval back
               </button>
             )}
           </>}>
      <p className="mp-trip-status">
        <TripTag look={look} />
        {look.kind === 'approved' && <span className="muted">This list stays as you approved it.</span>}
      </p>
      {elsewhere && (
        <p>
          You approved this day's {STRATEGY_NAMES[elsewhere]} list. Below is the {STRATEGY_NAMES[strategy]}
          {' '}list for the same day; approving it replaces that approval.
        </p>
      )}
      <p>{trip.reason}</p>
      {against && <p className="mp-note-warn"><Icon name="alert" size={14} />{against}</p>}
      {trip.diff && trip.diff.text.length > 0 && (
        <div className="mp-diff" role="group" aria-label="Changed since approved">
          <strong>Changed since you approved it:</strong>
          <ul>{trip.diff.text.map((t) => <li key={t}><code>{t}</code></li>)}</ul>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => mp.approveTrip(trip, strategy)}>
            Approve with these changes
          </button>
        </div>
      )}
      {delta && <p className="mp-note"><Icon name="refresh" size={14} />Groceries: {delta}</p>}
      {trip.not_stocked.length > 0 && (
        <p className="mp-note-warn"><Icon name="alert" size={14} />Not stocked within range: {trip.not_stocked.join(', ')}</p>
      )}
      <CartCard summary={tripToCartSummary(trip)} copyButton={false} />
      <h3 className="mp-sheet-label">Each item</h3>
      <ul className="mp-lines">
        {/* The engine groups lines by product and storage, so a product can be here twice. */}
        {trip.lines.map((ln) => (
          <LineRow key={`${ln.product.id}:${ln.storage}`} ln={ln} trip={trip} allowFreezer={d.prefs.allow_freezer}
                   onOptions={(l) => setOptions({ productId: l.product.id, name: l.product.name })} />
        ))}
      </ul>
      {trip.dismissed.length > 0 && (
        <>
          <h3 className="mp-sheet-label">Left off this trip by you</h3>
          <ul className="mp-lines mp-left-off">
            {trip.dismissed.map((p) => (
              <li key={p.id}>
                {p.name}
                <button type="button" className="btn btn-ghost btn-sm" aria-label={`Put ${p.name} back on this trip`}
                        onClick={() => mp.dispatch({ type: 'setPacks', date: trip.date, productId: p.id, packs: null })}>
                  Put it back
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
          <button type="button" className="btn btn-secondary" disabled={!moveTo}
                  onClick={() => act({ type: 'moveTrip', from: trip.date, to: moveTo }, true)}>Move</button>
          {preview && <MovePreview level={preview.level} lines={preview.lines} />}
        </div>
      )}
      <p className="muted">Store hours not checked. {mp.schedule.answer?.synthetic_notice}</p>
      {createPortal(<pre className="mp-print">{trip.list_text}</pre>, document.body)}
      {/* a modal on top of this one; its focus comes back to the trip line */}
      {optionsDialog}
    </Sheet>
  );
}

// What moving a trip would do to freshness, from the last answer: a sign when it warns.
function MovePreview({ level, lines }: { level: string; lines: string[] }) {
  const warn = level === 'warn';
  return (
    <p className={warn ? 'mp-note-warn' : 'muted'}>
      {warn && <Icon name="alert" size={14} />}Preview: {lines.join(' ')}
    </p>
  );
}

// ─── Warnings ────────────────────────────────────────────────

const LEVEL_NAMES = { must_fix: 'Must fix', should_fix: 'Should fix', decide: 'To decide', note: 'Notes' } as const;

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
  // one row for warnings that say the same thing, one product at a time
  const groups = (['must_fix', 'should_fix', 'decide', 'note'] as const)
    .map((level) => [level, warningRows(list.filter((w) => w.level === level), names)] as const)
    .filter(([, rows]) => rows.length);
  const run = (op: RemedyOp) => {
    const r = remedyStep(op, mp.state);
    if ('edit' in r) mp.dispatch(r.edit);
    else onAsk(op);
  };
  return (
    <div className="mp-warnings">
      {groups.map(([level, rows]) => (
        <details key={level} open={level !== 'note'} className={`mp-warn-group mp-warn-${level}`}>
          <summary>{level === 'must_fix' && <Icon name="alert" className="ico-inline" />}{LEVEL_NAMES[level]} ({rows.length})</summary>
          <ul>
            {rows.map(({ warning: w, text, products, count }, i) => (
              <li key={`${w.code}-${i}`}>
                <span>{text}</span>
                {count > 1 && products.length > 3 && (
                  <details className="mp-warn-all">
                    <summary>All {products.length} products</summary>
                    {products.join(', ')}
                  </details>
                )}
                {w.remedies.length > 0 && (
                  <span className="mp-remedies">
                    {w.remedies.map((op, j) => (
                      <button key={j} type="button" className="btn btn-secondary btn-sm" onClick={() => run(op)}>
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

// What the figures rest on, as a short list in "What the data covers": each fact in words, a sign
// beside those that leave something unclaimed (no cited storage time, an amount not known,
// nutrition not computed).
export function CoverageList({ coverage }: { coverage: PlanCoverage }) {
  const c = coverage;
  const items: { text: string; title?: string; gap: boolean }[] = [
    { text: `Storage time cited for ${c.freshness_cited} of ${c.products} products`,
      title: 'Storage times quoted from a cited source', gap: false },
    ...(c.freshness_your_setting > 0 ? [{ text: `${c.freshness_your_setting} follow your buy-ahead setting`,
      title: 'No cited time: your buy-ahead setting limits them', gap: true }] : []),
    ...(c.freshness_unknown > 0 ? [{ text: `${c.freshness_unknown} with no storage time`,
      title: 'Shelf-stable or frozen with no cited time: no limit is claimed', gap: true }] : []),
    { text: `Amounts known for ${c.amounts_known} of ${c.needs} needs`, gap: c.amounts_known < c.needs },
    { text: `Nutrition ${c.nutrition === 'computed' ? 'computed' : c.nutrition === 'not_deployed' ? 'not deployed' : 'unknown'}`,
      gap: c.nutrition !== 'computed' },
  ];
  return (
    <ul className="mp-coverage" aria-label="What the data covers">
      {items.map((x) => (
        <li key={x.text} title={x.title}>
          <Icon name={x.gap ? 'help' : 'check'} size={14} />{x.text}
        </li>
      ))}
    </ul>
  );
}

// ─── The Shopping plan ───────────────────────────────────────

// "Move to…" on a suggested trip's card: another day, then Move (moveTrip, as a drag makes it).
function MoveTo({ date }: { date: string }) {
  const mp = useMealPlan();
  const [to, setTo] = useState('');
  const days = tripMoveDays(mp.state.draft, date);
  if (!days.length) return null;
  return (
    <span className="mp-move-to">
      <label className="fc-field fc-inline">
        <span className="fc-label">Move to</span>
        <select className="fc-input-sm" value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">a day…</option>
          {days.map((x) => <option key={x} value={x}>{dayLabel(x)}</option>)}
        </select>
      </label>
      <button type="button" className="btn btn-secondary btn-sm" disabled={!to} aria-label={`Move the trip on ${dayLabel(date)}`}
              onClick={() => { mp.dispatch({ type: 'moveTrip', from: date, to }); setTo(''); }}>Move</button>
    </span>
  );
}

// A sign for each kind of action, beside the words that say it: shop, freeze, thaw, cook.
const KIND_ICON: Record<PlanAction['kind'], IconName> = { shop: 'cart', freeze: 'snowflake', thaw: 'droplet', cook: 'pan' };

// The trips of the strategy shown, each as a card: an approved one opens in the store from its
// "Shop this trip"; a suggested one can be approved, dismissed or moved to another day. Approve
// all approves every suggested trip at once, as one step Undo takes back. Then the days dismissed,
// a trip added by hand, and what happens day by day.
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
  const suggested = (st?.trips ?? []).filter((t) => tripLook(t, approvedElsewhere(d, t.date, strategy)).kind === 'suggested');
  const rules = countryRules(d.settings);

  // Approved from its card: the Approve pressed is gone, and the trip's "Shop this trip" is where
  // the shopper goes on from. That only appears once the schedule has answered for the plan as it
  // is now (the card shows the trip as the answer has it), so focus waits on the card's Open list
  // until then, and moves on only if nothing else has taken it meanwhile.
  const [toShop, setToShop] = useState<{ date: string; parked: boolean } | null>(null);
  useEffect(() => {
    if (!toShop) return;
    const go = document.querySelector<HTMLElement>(shopTripSelector(toShop.date));
    const wait = document.querySelector<HTMLElement>(openTripSelector(toShop.date));
    const here = document.activeElement;
    // parked on Open list, and the shopper has moved on since: leave focus where they put it
    if (toShop.parked && here && here !== document.body && here !== wait) {
      setToShop(null);
      return;
    }
    if (go) {
      go.focus();
      setToShop(null);
    } else if (!toShop.parked) {
      wait?.focus();
      setToShop({ ...toShop, parked: true });
    }
  }, [toShop, schedule]);
  const approve = (t: Trip, replace = false) => {
    const out = mp.approveTrip(t, strategy, replace);
    if (!out.refused) setToShop({ date: t.date, parked: false });
  };

  // Every suggested trip at once, as one step: said in a toast with its Undo, not twice. While the
  // trips are being worked out again it waits for the answer, as each Approve does, and the toast
  // comes when the trips are approved (the plan's live region names any it could not approve).
  const approveAll = () => {
    if (!suggested.length) return;
    const before = d.trips.length;
    const waiting = !mp.schedule.current;
    const said = (n: number) => mp.toastUndo(n === suggested.length ? `Approved ${n} trips`
      : `Approved ${n} of ${suggested.length} trips`);
    const out = mp.approveTrips(suggested, strategy, said);
    if (out.refused) {
      mp.announce(`Not done: ${out.refused}.`);
      return;
    }
    if (!waiting) said(out.state.draft.trips.length - before);
    // Approve all goes once nothing is left to approve: on to the first trip's Shop this trip
    setToShop({ date: suggested[0].date, parked: false });
  };

  return (
    <div>
      {!st?.trips.length && <p className="muted">No trips yet: trips appear once meals are on the calendar.</p>}
      {suggested.length > 1 && (
        <div className="mp-approve-all">
          <button type="button" className="btn btn-primary" onClick={approveAll}>
            <Icon name="check" size={16} />Approve all {suggested.length} trips
          </button>
          <p className="muted">Or approve them one at a time below. An approved trip is never rewritten.</p>
        </div>
      )}
      <ul className="mp-trip-list">
        {st?.trips.map((t) => {
          const elsewhere = approvedElsewhere(d, t.date, strategy);
          const look = tripLook(t, elsewhere);
          // approved here, or under the other way to shop: either way in-store mode opens the
          // approved list (board.ts tripToShop)
          const approved = look.kind !== 'suggested';
          const delta = priceDeltaText(t.price_delta);
          const against = againstRule(rules, shopRows(t));
          return (
            <li key={t.id} className="card mp-trip-card">
              <div className="card-head">
                <div>
                  <h4 className="card-title">{dayLabel(t.date)}</h4>
                  <p className="card-sub mp-trip-card-sub">
                    {[plural(t.stores.length, 'store', 'stores'), costText(t.total_cost, t.total_is_floor, tripPriced(t)),
                      plural(t.lines.length, 'item', 'items')].join(' · ')}
                  </p>
                </div>
                <TripTag look={look} />
              </div>
              <p className="muted mp-trip-reason">{t.reason}</p>
              {delta && <p className="mp-note"><Icon name="refresh" size={14} />{delta}</p>}
              {t.diff && t.diff.text.length > 0 && (
                <p className="mp-note-warn"><Icon name="alert" size={14} />Changed since you approved it: {t.diff.text.join(', ')}</p>
              )}
              {against && <p className="mp-note-warn"><Icon name="alert" size={14} />{against}</p>}
              <div className="mp-trip-actions">
                {approved && (
                  <a className={`btn ${look.kind === 'elsewhere' ? 'btn-secondary' : 'btn-primary'} btn-sm`}
                     href={hrefFor({ name: 'trip', date: t.date })} data-shop-trip={t.date}
                     aria-label={`Shop the trip on ${dayLabel(t.date)}`}>
                    <Icon name="bag" size={16} />Shop this trip
                  </a>
                )}
                <button type="button" className="btn btn-secondary btn-sm" data-open-trip={t.date}
                        onClick={() => onOpenTrip(t.date)}>Open list</button>
                {look.kind === 'suggested' ? (
                  <>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => approve(t)}>Approve</button>
                    <button type="button" className="btn btn-secondary btn-sm"
                            onClick={() => mp.dispatch({ type: 'dismissTrip', date: t.date })}>Dismiss</button>
                    <MoveTo date={t.date} />
                  </>
                ) : (
                  <>
                    {look.kind === 'elsewhere' && (
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => approve(t, true)}>
                        Approve this list instead
                      </button>
                    )}
                    <button type="button" className="btn btn-ghost btn-sm"
                            onClick={() => mp.dispatch({ type: 'unapproveTrip', date: t.date })}>Take the approval back</button>
                  </>
                )}
              </div>
            </li>
          );
        })}
        {elsewhereOnly.map((a) => (
          <li key={`approved-${a.date}`} className="card mp-trip-card">
            <div className="card-head">
              <div>
                <h4 className="card-title">{dayLabel(a.date)}</h4>
                <p className="card-sub">{STRATEGY_NAMES[strategy]} buys nothing on this day.</p>
              </div>
              <TripTag look={{ kind: 'elsewhere', word: `Approved under ${STRATEGY_NAMES[a.strategy]}` }} />
            </div>
            <div className="mp-trip-actions">
              <a className="btn btn-primary btn-sm" href={hrefFor({ name: 'trip', date: a.date })} data-shop-trip={a.date}
                 aria-label={`Shop the trip on ${dayLabel(a.date)}`}>
                <Icon name="bag" size={16} />Shop this trip
              </a>
              <button type="button" className="btn btn-ghost btn-sm"
                      onClick={() => mp.dispatch({ type: 'unapproveTrip', date: a.date })}>Take the approval back</button>
            </div>
          </li>
        ))}
      </ul>
      {d.dismissed_dates.length > 0 && (
        <div className="mp-dismissed">
          <span className="muted">Dismissed:</span>
          {d.dismissed_dates.filter((x) => inWindow(windowOf(d), x)).map((x) => (
            <button key={x} type="button" className="btn btn-ghost btn-sm" aria-label={`Restore the trip on ${dayLabel(x)}`}
                    onClick={() => mp.dispatch({ type: 'restoreTrip', date: x })}>
              {dayLabel(x)}: restore
            </button>
          ))}
        </div>
      )}
      <div className="fc-row mp-addtrip">
        <label className="fc-field fc-inline">
          <span className="fc-label">Add a trip on</span>
          <select value={addOn} onChange={(e) => setAddOn(e.target.value)}>
            <option value="">choose a day</option>
            {free.map((x) => <option key={x} value={x}>{dayLabel(x)}</option>)}
          </select>
        </label>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!addOn}
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
                      <Icon name={KIND_ICON[a.kind]} className="ico-inline" />{a.text}
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
    <section className="card mp-proposal" aria-label="Suggested cook days">
      <h3 className="card-title">Suggested cook days</h3>
      {status === 'checking' && <p className="muted">Working out fresher days…</p>}
      {status === 'error' && <Notice tone="danger" title="Could not suggest cook days">{error}</Notice>}
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
            Warnings under {STRATEGY_NAMES[mp.state.draft.prefs.strategy]}: {warningCountsText(proposal.warnings_before)} now,
            {' '}{warningCountsText(proposal.warnings_after)} after.
          </p>
        </>
      )}
      <div className="mp-trip-actions">
        {proposal && proposal.ops.length > 0 && (
          <button type="button" className="btn btn-primary btn-sm" onClick={() => mp.applyCookDays()}>Apply</button>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={mp.dismissCookDays}>Dismiss</button>
      </div>
    </section>
  );
}
