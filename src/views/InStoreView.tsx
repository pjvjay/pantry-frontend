// In-store mode (#/shop/trip/<date>): one trip's list, for a phone in the shop. A header that
// stays at the top of the screen says which day and stores and how far along the trip is ("7 of
// 12 · $38.40 of $52.00"); under it the lines to pick up, by store and then by section, each one
// row with a big check; a line ticked is struck through and moves to "In the basket" at the end,
// and "Done shopping" goes back to the shopping plan.
//
// The trip is the one the plan's last schedule answer has on that day, under the strategy the
// shopper chose (the same list as the shopping plan's). The ticks are kept in this browser beside
// the plan, not in it (components/useTicks.ts, mealplan/shopping.ts): ticking never gives the
// plan a new revision, never sends it to be scheduled again and never lands in its undo. While the
// page is open the screen is asked to stay on (useWakeLock). Every product's picture comes from
// the demo hub and may not come at all (the public demo has none): a quiet placeholder takes its
// place, the same box, so nothing moves.
//
// Focus: the page opens at its top with the keyboard on its heading. Ticking a line moves focus to
// the line that takes its place (or Done shopping once the list is done), and a screen reader
// hears what was ticked and how far along the trip is; a line taken back out of the basket keeps
// focus where it goes back to.
import { useEffect, useMemo, useRef, useState } from 'react';

import { arriving } from '../components/arrival';
import { Icon } from '../components/icons';
import { ProductPicture } from '../components/pictures';
import { EmptyState, Notice, Skeleton } from '../components/ui';
import { useKeepClear } from '../components/useKeepClear';
import { useTicks } from '../components/useTicks';
import { useWakeLock } from '../components/useWakeLock';
import { strategyOf } from '../mealplan/board';
import { dayLabel } from '../mealplan/dates';
import { inWindow, windowDates, windowOf } from '../mealplan/model';
import { instoreView, listOf, tickedText } from '../mealplan/shoplist';
import type { ShopRow } from '../mealplan/shoplist';
import { useMealPlan } from '../mealplan/store';
import { hrefFor } from '../routes';

const SHOP = hrefFor({ name: 'shop' });

// A row's place on the page, for focus to come back to it after it moves.
const rowSelector = (key: string) => `[data-row="${CSS.escape(key)}"] input`;

function Row({ row, on, onToggle }: { row: ShopRow; on: boolean; onToggle: (row: ShopRow, on: boolean) => void }) {
  const meta = [row.amount, row.forText, ...row.notes].filter(Boolean).join(' · ');
  return (
    <li className={`is-row${on ? ' is-row-on' : ''}`} data-row={row.key}>
      {/* one label is the whole row, a fingertip's target; the checkbox is named by all of it */}
      <label className="is-hit">
        <span className="is-box">
          <input type="checkbox" checked={on} onChange={(e) => onToggle(row, e.target.checked)} />
          <Icon name="check" size={20} strokeWidth={3} className="is-tick" />
        </span>
        <ProductPicture product={row.productName} ingredient={row.productName} />
        <span className="is-what">
          <span className="is-name">{row.name}</span>
          {meta && <span className="is-meta">{meta}</span>}
        </span>
        <span className={`is-price${row.price === null ? ' is-price-unknown' : ''}`}>{row.priceText}</span>
      </label>
    </li>
  );
}

export default function InStoreView({ date }: { date: string }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const schedule = mp.schedule;
  const answer = schedule.answer;
  const trip = strategyOf(answer, d.prefs.strategy)?.trips.find((t) => t.date === date) ?? null;
  const days = useMemo(() => windowDates(windowOf(d)), [d.start_date, d.days]);
  const ticks = useTicks(d.id, date, days);
  const tickKey = ticks.ticked.join(',');
  const view = useMemo(() => (trip ? instoreView(trip, ticks.ticked) : null), [trip, tickKey]);
  const wake = useWakeLock(trip !== null);
  const keepClear = useKeepClear('top');
  const heading = useRef<HTMLHeadingElement>(null);
  const done = useRef<HTMLAnchorElement>(null);
  // where focus goes once a tick is drawn: a row's key, or Done shopping
  const [focusTo, setFocusTo] = useState<string | 'done' | null>(null);

  // A new page: at its top, the keyboard on its heading (the button pressed to come here is gone).
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (focusTo === null) return;
    const el = focusTo === 'done' ? done.current : document.querySelector<HTMLElement>(rowSelector(focusTo));
    el?.focus();
    setFocusTo(null);
  }, [focusTo, view]);

  // Back to the shopping plan with the keyboard on this trip's own "Shop this trip" (an approved
  // trip has one: components/mealtrips.tsx), else on the plan's heading.
  const back = arriving(SHOP, { focus: [`[data-shop-trip="${date}"]`] });

  const toggle = (row: ShopRow, on: boolean) => {
    if (!trip || !view) return;
    if (on) {
      // the row that takes this one's place, else the one before it, else the list is done
      const order = view.toGet.flatMap((g) => g.sections.flatMap((s) => s.rows));
      const i = order.findIndex((r) => r.key === row.key);
      const next = order[i + 1] ?? order[i - 1];
      setFocusTo(next ? next.key : 'done');
    } else {
      setFocusTo(row.key);
    }
    ticks.set(row.productId, on);
    const after = instoreView(trip, on ? [...ticks.ticked, row.productId] : ticks.ticked.filter((x) => x !== row.productId));
    mp.announce(tickedText(row, on, after));
  };

  const day = dayLabel(date);
  const inPlan = inWindow(windowOf(d), date);
  const hasRecipes = Object.keys(d.recipes).length > 0;
  const loading = !answer && hasRecipes && schedule.status !== 'error';
  const ticked = new Set(ticks.ticked);
  const pct = view && view.total ? Math.round((view.done / view.total) * 100) : 0;
  const severalStores = (view?.toGet.length ?? 0) > 1 || (view?.stores.length ?? 0) > 1;

  return (
    <div className="view instore">
      <header className="is-head" ref={keepClear}>
        <a className="btn btn-ghost btn-icon is-back" href={SHOP} onClick={back} aria-label="Back to the shopping plan">
          <Icon name="arrow-left" />
        </a>
        <div className="is-heading">
          <h2 id="is-title" className="is-title" ref={heading} tabIndex={-1}>
            <span className="sr-only">Shopping trip, </span>{day}
          </h2>
          {trip && <p className="is-stores">{trip.stores.length ? listOf(trip.stores) : 'No store chosen yet'}</p>}
        </div>
        {view && (
          <p className="is-tally">
            <strong className="is-count">{view.count}</strong>
            <span className="is-money">{view.spent}<span className="is-of"> of {view.cost}</span></span>
          </p>
        )}
        {view && (
          <span className="is-bar" aria-hidden="true"><span className="is-bar-fill" style={{ width: `${pct}%` }} /></span>
        )}
      </header>

      {loading && <Skeleton kind="row" count={8} label="Loading your trip" />}

      {!answer && schedule.status === 'error' && (
        <Notice tone="danger" title="Your trip could not be loaded"
                actions={[{ label: 'Try again', icon: 'refresh', onClick: mp.recheck }, { label: 'Back to the shopping plan', href: SHOP }]}>
          {schedule.error}
        </Notice>
      )}

      {!trip && !loading && !(schedule.status === 'error' && !answer) && (
        <EmptyState icon="bag" className="is-none"
                    status={inPlan ? `There is no trip on ${day} in your plan now.` : `${day} is not one of your plan's days.`}
                    cue="Trips change as the plan does. The shopping plan has this week's trips, each with its list."
                    action={{ label: 'Back to the shopping plan', href: SHOP }} />
      )}

      {trip && view && (
        <>
          {view.toGet.map((g) => (
            <section key={g.store} className="is-store" aria-label={g.store}>
              {severalStores && <h3 className="is-store-name"><Icon name="store" size={18} />{g.store}</h3>}
              {g.sections.map((s) => (
                <div key={s.name} className="is-sec">
                  <h4 className="is-sec-name">{s.name}</h4>
                  <ul className="is-rows">
                    {s.rows.map((r) => <Row key={r.key} row={r} on={false} onToggle={toggle} />)}
                  </ul>
                </div>
              ))}
            </section>
          ))}

          {view.done === view.total && (
            <Notice tone="success" title="Everything is in the basket">
              {view.count} on this trip, {view.spent}.
            </Notice>
          )}

          {view.basket.length > 0 && (
            <section className="is-basket" aria-labelledby="is-basket-head">
              <h3 id="is-basket-head" className="is-basket-name">
                <Icon name="bag" size={18} />In the basket <span className="is-basket-count">({view.basket.length})</span>
              </h3>
              <ul className="is-rows">
                {view.basket.map((r) => <Row key={r.key} row={r} on={ticked.has(r.productId)} onToggle={toggle} />)}
              </ul>
            </section>
          )}

          <div className="is-foot">
            <a ref={done} className="btn btn-primary btn-lg is-done" href={SHOP} onClick={back}>
              <Icon name="check" size={18} />Done shopping
            </a>
            <p className="is-notes">
              {ticks.kept ? 'Your ticks are kept in this browser, apart from your plan.'
                : 'This browser would not save your ticks: they last while this page is open.'}
              {wake.held && ' The screen stays on while this list is open.'}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
