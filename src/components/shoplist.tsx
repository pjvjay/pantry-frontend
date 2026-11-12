// The Shop stage's own pieces (views/MealPlanView.tsx stage 5, and the shopping plan on its own
// at #/shop), in the order the stage reads, goal first:
//
//   CheckPlan       "Check your plan": the diet, the total against the budget, the days, the
//                   stores and how to shop, each with a Change (GOV.UK's check answers).
//   YourList        "Your list": one list for the whole period, trip by trip, each trip's lines by
//                   store section, with one Copy list and one Print list for all of it, and "Shop
//                   this trip" on each approved trip (in-store mode, views/InStoreView.tsx).
//   StrategyTiles   the two ways to shop as two tiles, each with its trips and total.
//
// The words and the grouping are in mealplan/shoplist.ts; the trips, their warnings and the trip
// sheet in components/mealtrips.tsx. Each part is a card on the page (styles/card.css).
import { useMemo, useRef, useState } from 'react';
import type { MouseEvent, RefObject } from 'react';

import { costText, strategyOf, tripPriced } from '../mealplan/board';
import { periodText } from '../mealplan/home';
import { STRATEGY_NAMES } from '../mealplan/model';
import { checkPlan, listCountText, listOf, listText, periodList, strategyTiles } from '../mealplan/shoplist';
import type { CheckItem, TripList } from '../mealplan/shoplist';
import { readShopping, tickedOn } from '../mealplan/shopping';
import { useMealPlan } from '../mealplan/store';
import { hrefFor } from '../routes';
import type { MealSchedule } from '../types';
import { copyText } from './cart';
import { Icon } from './icons';
import { TripTag } from './matchmarks';
import { Sheet } from './Sheet';
import { useToast } from './ui';

// ─── Check your plan ─────────────────────────────────────────

// href: where a Change goes (Set up, or Check ingredients for the stores); none for how to shop,
// whose tiles are further down this page, so its Change is a button that goes to them.
export function CheckPlan({ hrefOf, onChange }: {
  hrefOf: (key: CheckItem['key']) => string | null;
  onChange: (key: CheckItem['key']) => void;
}) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const answer = mp.schedule.answer;
  const items = checkPlan(d, strategyOf(answer, d.prefs.strategy), answer);
  // A plain click is handled in this page, so focus lands on the answer; a click that asks for
  // another tab or window is the browser's.
  const follow = (e: MouseEvent<HTMLAnchorElement>, key: CheckItem['key']) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onChange(key);
  };
  return (
    <section className="card shop-card" aria-labelledby="shop-check-head">
      <h3 id="shop-check-head" className="shop-card-title">Check your plan</h3>
      <dl className="shop-check-list">
        {items.map((x) => {
          const href = hrefOf(x.key);
          const words = <>Change<span className="sr-only"> {x.change}</span></>;
          return (
            <div key={x.key} className={`shop-check-row${x.over ? ' shop-check-over' : ''}`}>
              <dt className="shop-check-key">{x.label}</dt>
              <dd className="shop-check-value">
                {x.value}
                <span className="shop-check-note">
                  {x.over && <Icon name="alert" size={14} className="shop-check-warn" />}{x.note}
                </span>
              </dd>
              <dd className="shop-check-change">
                {href ? <a href={href} onClick={(e) => follow(e, x.key)}>{words}</a>
                  : <button type="button" className="shop-check-link" onClick={() => onChange(x.key)}>{words}</button>}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

// ─── Your list ───────────────────────────────────────────────

// Print shows only the list (the @media print rules in index.css): a copy of it as text, put on
// the page for as long as the print dialog is open. The trip sheet keeps its own trip's copy on
// the page while it is open, and the page behind an open sheet cannot be pressed, so the two never
// print together.
function printText(text: string) {
  const sheet = document.createElement('pre');
  sheet.className = 'mp-print';
  sheet.textContent = text;
  document.body.appendChild(sheet);
  document.body.classList.add('mp-printing');
  const done = () => {
    document.body.classList.remove('mp-printing');
    sheet.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
  // Some browsers return from print() without an afterprint event.
  window.setTimeout(done, 1000);
}

// localStorage, or null where the browser will not hand it over.
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// One trip of the list: its day and stores, its state, how far the shopper got with it in the store
// (the ticks, kept beside the plan: mealplan/shopping.ts), and its lines by section. Its heading
// is where Done shopping in the store brings the keyboard back to.
function TripBlock({ list, ticked }: { list: TripList; ticked: readonly number[] }) {
  // approved under either way to shop: in-store mode opens its approved list (board.ts tripToShop)
  const approved = list.look.kind !== 'suggested';
  const head = `shop-trip-${list.date}`;
  const has = new Set(ticked);
  const inBasket = list.sections.reduce((t, s) => t + s.rows.filter((r) => has.has(r.productId)).length, 0);
  return (
    <section className="shop-trip" aria-labelledby={head}>
      <div className="shop-trip-head">
        <div className="shop-trip-what">
          <h4 id={head} className="shop-trip-title" tabIndex={-1}>
            {list.day}
            {list.stores.length > 0 && <span className="shop-trip-stores"> · {listOf(list.stores)}</span>}
          </h4>
          <p className="shop-trip-meta">
            <TripTag look={list.look} />
            <span>{list.items} {list.items === 1 ? 'item' : 'items'} · {list.cost}</span>
            {inBasket > 0 && <span>{inBasket === list.items ? 'All in the basket' : `${inBasket} of ${list.items} in the basket`}</span>}
          </p>
        </div>
        {approved && (
          <a className="btn btn-primary btn-sm" href={hrefFor({ name: 'trip', date: list.date })}
             aria-label={`Shop the trip on ${list.day}`}>
            <Icon name="bag" size={16} />{inBasket > 0 && inBasket < list.items ? 'Carry on shopping' : 'Shop this trip'}
          </a>
        )}
      </div>
      <div className="shop-secs">
        {list.sections.map((s) => (
          <div key={s.name} className="shop-sec">
            <h5 className="shop-sec-name">{s.name}</h5>
            <ul className="shop-lines">
              {s.rows.map((r) => {
                const about = [r.forText, ...r.notes, list.manyStores ? list.storeLabels[r.store] ?? r.store : '']
                  .filter(Boolean);
                return (
                  <li key={r.key} className="shop-line">
                    <span className="shop-line-name">{r.name}</span>
                    <span className={`shop-line-price${r.price === null ? ' shop-line-unknown' : ''}`}>{r.priceText}</span>
                    <span className="shop-line-for">
                      <span className="shop-line-qty">{r.amount}</span>
                      {about.length > 0 && <> · {about.join(' · ')}</>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

// The copy that could not be made: the list in a box, selected, for the shopper to copy. It
// closes back onto Copy list (`back`).
function CopySheet({ text, onClose, back }: {
  text: string | null;
  onClose: () => void;
  back: RefObject<HTMLButtonElement | null>;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  return (
    <Sheet open={text !== null} onClose={onClose} title="Copy your list" initialFocus={box} returnFocus={back}
           description="This browser would not copy it for you. The list is selected below: copy it with your keyboard or a long press."
           footer={<button type="button" className="btn btn-primary" onClick={onClose}>Done</button>}>
      <textarea ref={box} className="shop-copy-box" readOnly value={text ?? ''} rows={16}
                aria-label="Your list as text" onFocus={(e) => e.currentTarget.select()} />
    </Sheet>
  );
}

export function YourList({ schedule }: { schedule: MealSchedule }) {
  const mp = useMealPlan();
  const toast = useToast();
  const d = mp.state.draft;
  const st = strategyOf(schedule, d.prefs.strategy);
  const lists = useMemo(() => periodList(st, d), [st, d]);
  // the basket each trip has in the store, read as the list opens (Done shopping comes back here)
  const shopping = useMemo(() => readShopping(browserStorage()), [d.id]);
  // the list's text, when the clipboard would not take it
  const [manual, setManual] = useState<string | null>(null);
  const copyButton = useRef<HTMLButtonElement>(null);
  const total = st ? costText(st.total_cost, st.total_is_floor, st.trips.some(tripPriced)) : '';
  const text = () => listText(lists, `Shopping list · ${periodText(d)} · ${STRATEGY_NAMES[d.prefs.strategy]}`,
    `Total ${total}`, schedule.synthetic_notice);
  // The older copy command, which copyText falls back on, copies from a box it focuses and then
  // removes, which leaves focus on the page: it comes back to Copy list.
  const copy = async () => {
    const t = text();
    const ok = await copyText(t);
    if (document.activeElement === document.body) copyButton.current?.focus();
    if (ok) toast.show({ text: `Copied your list: ${listCountText(lists)}.` });
    else setManual(t);
  };
  return (
    <section className="card shop-card" aria-labelledby="shop-list-head">
      <div className="shop-list-top">
        <div>
          <h3 id="shop-list-head" className="shop-card-title">Your list</h3>
          {lists.length > 0 && <p className="shop-list-sum">{listCountText(lists)} · {total}</p>}
        </div>
        {lists.length > 0 && (
          <div className="shop-list-actions">
            <button ref={copyButton} type="button" className="btn btn-secondary btn-sm" onClick={() => void copy()}>
              <Icon name="copy" size={16} />Copy list
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => printText(text())}>
              <Icon name="printer" size={16} />Print list
            </button>
          </div>
        )}
      </div>
      {lists.length ? lists.map((l) => <TripBlock key={l.date} list={l} ticked={tickedOn(shopping, d.id, l.date)} />)
        : <p className="muted shop-list-none">No trips yet: trips appear once meals are on days.</p>}
      <CopySheet text={manual} onClose={() => setManual(null)} back={copyButton} />
    </section>
  );
}

// ─── How to shop ─────────────────────────────────────────────

// The id of a strategy's radio, so "Check your plan" can bring the keyboard to the chosen one.
export const strategyInputId = (name: string) => `mp-strategy-${name}`;

const STRATEGY_ICONS = { fresh: 'leaf', fewest_trips: 'bag' } as const;

export function StrategyTiles({ schedule }: { schedule: MealSchedule }) {
  const mp = useMealPlan();
  const strategy = mp.state.draft.prefs.strategy;
  return (
    <fieldset className="shop-strategy">
      <legend className="shop-strategy-legend">How to shop</legend>
      <div className="shop-tiles">
        {strategyTiles(schedule, mp.state.draft.trips).map((t) => (
          <label key={t.name} className="tile shop-tile">
            <input type="radio" name="mp-strategy" id={strategyInputId(t.name)} checked={strategy === t.name}
                   onChange={() => mp.dispatch({ type: 'setPrefs', prefs: { strategy: t.name } })} />
            <span className="tile-face">
              <span className="shop-tile-top">
                <Icon name={STRATEGY_ICONS[t.name]} size={22} />
                <span className="tile-name">{t.label}</span>
                {strategy === t.name && <Icon name="circle-check" size={20} className="shop-tile-on" />}
              </span>
              <span className="shop-tile-hint">{t.hint}</span>
              <span className="tile-hint">{t.extra}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
