// In-store mode (#/shop/trip/<date>): one trip's list, for a phone in the shop. A header that
// stays at the top of the screen says which day and stores and how far along the trip is ("7 of
// 12 · $38.40 of $52.00"); under it the lines to pick up, by store and then by section, each one
// row with a big check (two to a row on a wide screen); a line ticked shows it where it was, ticked
// and "In the basket", for a moment, then moves to "In the basket" at the end, struck through; and
// "Done shopping" goes back to the shopping plan, at this trip in Your list. Each row also says
// where its product comes from, in a short origin tag ("Canada · preferred", "Origin unknown: check
// the label" while the plan leaves a country out), so the labels worth reading are marked where
// the shopper stands; a product the trip buys against the rule (planned or approved before its
// evidence came in) is named over the list as well.
//
// Where pantry-api cannot be reached (a shop's signal), the list opens from the offline copy this
// browser kept of the trip as last approved (mealplan/offline.ts), with when it was made; the
// fresh answer takes over the moment it comes.
//
// The trip is the one the plan's last schedule answer has on that day: the list approved there,
// under the way to shop it was approved under, else the day's trip under the way the shopper chose
// (mealplan/board.ts tripToShop, as Home's next trip and the offline copy have it). The ticks are
// kept in this browser beside the plan, not in it (components/useTicks.ts, mealplan/shopping.ts):
// ticking never gives the plan a new revision, never sends it to be scheduled again and never lands
// in its undo. While the page is open the screen is asked to stay on (useWakeLock). Every product's
// picture comes from the demo hub and may not come at all (the public demo has none): a quiet
// placeholder takes its place, the same box, so nothing moves.
//
// Focus: the page opens at its top with the keyboard on its heading. Ticking a line moves focus to
// the line that takes its place (or Done shopping once the list is done), and a screen reader
// hears what was ticked and how far along the trip is; a line taken back out of the basket keeps
// focus where it goes back to.
import { useEffect, useMemo, useRef, useState } from 'react';

import { arriving } from '../components/arrival';
import { Icon } from '../components/icons';
import { OriginTag } from '../components/matchmarks';
import { ProductPicture } from '../components/pictures';
import { EmptyState, Notice, Skeleton } from '../components/ui';
import { copiedAt, offlineTrip, readOffline } from '../mealplan/offline';
import { useKeepClear } from '../components/useKeepClear';
import { useTicks } from '../components/useTicks';
import { useWakeLock } from '../components/useWakeLock';
import { tripToShop } from '../mealplan/board';
import { dayLabel } from '../mealplan/dates';
import { inWindow, windowDates, windowOf } from '../mealplan/model';
import { againstRule, countryRules, originWords } from '../mealplan/origin';
import type { CountryRules } from '../mealplan/origin';
import { instoreView, listOf, shopRows, tickedText } from '../mealplan/shoplist';
import type { ShopRow } from '../mealplan/shoplist';
import { useMealPlan } from '../mealplan/store';
import { hrefFor } from '../routes';

const SHOP = hrefFor({ name: 'shop' });

// A row's place on the page, for focus to come back to it after it moves.
const rowSelector = (key: string) => `[data-row="${CSS.escape(key)}"] input`;

// localStorage, or null where the browser will not hand it over.
function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// How long a line just ticked stays where it was, ticked, before it moves to the basket: long
// enough to see what the tick did, short enough not to be in the way.
const SETTLE_MS = 900;

// How long the list may show from the offline copy, while the answer is on its way, before it
// says so: a normal answer takes about half a second, and the line would only flash.
const SLOW_MS = 1500;

// settling: just ticked, still shown in its place with "In the basket" before it moves there.
// rules: the plan's country rules, which its origin tag is read against.
function Row({ row, on, settling = false, onToggle, rules }: { row: ShopRow; on: boolean; settling?: boolean;
  onToggle: (row: ShopRow, on: boolean) => void; rules: CountryRules }) {
  const meta = [row.amount, row.forText, ...row.notes].filter(Boolean).join(' · ');
  const origin = originWords(row.origin, rules);
  return (
    <li className={`is-row${on ? ' is-row-on' : ''}${settling ? ' is-row-settling' : ''}`} data-row={row.key}>
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
          {settling && <span className="is-moved" aria-hidden="true"><Icon name="bag" size={14} />In the basket</span>}
        </span>
        <span className={`is-price${row.price === null ? ' is-price-unknown' : ''}`}>{row.priceText}</span>
        {/* under the words and the price, the width of both, so the pill stays one line on a phone (a
            processing claim's caveat wraps under it) */}
        {origin && <span className="is-origin"><OriginTag words={origin} /></span>}
      </label>
    </li>
  );
}

export default function InStoreView({ date }: { date: string }) {
  const mp = useMealPlan();
  const d = mp.state.draft;
  const schedule = mp.schedule;
  const answer = schedule.answer;
  const rules = countryRules(d.settings);
  const fresh = tripToShop(answer, d, date);
  // With no answer yet (on its way, or pantry-api out of reach), the trip as this browser last kept
  // it, if that copy is of the plan as it is now; a fresh answer always takes over.
  const copy = useMemo(() => (answer ? null : readOffline(browserStorage())), [answer === null, d.id, d.rev]);
  const copied = answer ? null : offlineTrip(copy, d, date);
  const trip = fresh ?? copied;
  // the copy says it is one at once when the plan could not be checked, and once the answer is
  // slow to come (a shop's signal), but not for the moment a normal answer takes
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!copied || schedule.status === 'error') return undefined;
    const id = window.setTimeout(() => setSlow(true), SLOW_MS);
    return () => window.clearTimeout(id);
  }, [copied !== null, schedule.status]);
  const days = useMemo(() => windowDates(windowOf(d)), [d.start_date, d.days]);
  const ticks = useTicks(d.id, date, days);
  // lines just ticked, still shown in their place for a moment (SETTLE_MS) before they move
  const [settling, setSettling] = useState<number[]>([]);
  const timers = useRef(new Map<number, number>());
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);
  const tickKey = ticks.ticked.join(',');
  const settlingKey = settling.join(',');
  // what the header counts (every tick) and how the list is drawn (a settling line still in place)
  const view = useMemo(() => (trip ? instoreView(trip, ticks.ticked) : null), [trip, tickKey]);
  const drawn = useMemo(() => (trip ? instoreView(trip, ticks.ticked.filter((x) => !settling.includes(x))) : null),
    [trip, tickKey, settlingKey]);
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

  // Back to the shopping plan, at this trip in Your list near its top (its heading takes the
  // keyboard: components/shoplist.tsx), not at its card at the far end of the page; else at the
  // trip's own "Shop this trip" (components/mealtrips.tsx), else the plan's heading.
  const back = arriving(SHOP, { focus: [`#shop-trip-${date}`, `[data-shop-trip="${date}"]`] });

  const toggle = (row: ShopRow, on: boolean) => {
    if (!trip || !view || !drawn) return;
    if (on) {
      // the row that takes this one's place, else the one before it, else the list is done (rows
      // still settling are on their way out, so not where the keyboard goes)
      const order = drawn.toGet.flatMap((g) => g.sections.flatMap((s) => s.rows))
        .filter((r) => r.key === row.key || !settling.includes(r.productId));
      const i = order.findIndex((r) => r.key === row.key);
      const next = order[i + 1] ?? order[i - 1];
      setFocusTo(next ? next.key : 'done');
      // seen where it was, ticked, for a moment; then on to the basket
      setSettling((now) => [...now.filter((x) => x !== row.productId), row.productId]);
      window.clearTimeout(timers.current.get(row.productId));
      timers.current.set(row.productId, window.setTimeout(() => {
        timers.current.delete(row.productId);
        setSettling((now) => now.filter((x) => x !== row.productId));
      }, SETTLE_MS));
    } else {
      window.clearTimeout(timers.current.get(row.productId));
      setSettling((now) => now.filter((x) => x !== row.productId));
      setFocusTo(row.key);
    }
    ticks.set(row.productId, on);
    const after = instoreView(trip, on ? [...ticks.ticked, row.productId] : ticks.ticked.filter((x) => x !== row.productId));
    mp.announce(tickedText(row, on, after));
  };

  const day = dayLabel(date);
  const inPlan = inWindow(windowOf(d), date);
  const hasRecipes = Object.keys(d.recipes).length > 0;
  const loading = !answer && !copied && hasRecipes && schedule.status !== 'error';
  const ticked = new Set(ticks.ticked);
  const pct = view && view.total ? Math.round((view.done / view.total) * 100) : 0;
  const severalStores = (view?.toGet.length ?? 0) > 1 || (view?.stores.length ?? 0) > 1;
  // a section's name is a level under its store's, or under the page's own heading when the trip
  // has one store and no store heading is drawn, so no heading level is skipped
  const Sec = severalStores ? 'h4' : 'h3';
  // a product this trip buys against the plan's country rule, named over the list
  const against = trip ? againstRule(rules, shopRows(trip)) : null;

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

      {copied && copy && (slow || schedule.status === 'error') && (
        <p className="is-offline">
          <Icon name="plug" size={16} />
          <span>
            Offline copy from {copiedAt(copy.at, new Date())}
            {schedule.status === 'error' ? ': the plan could not be checked just now.' : '.'}
          </span>
          {schedule.status === 'error' && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={mp.recheck}>Try again</button>
          )}
        </p>
      )}

      {view && against && <Notice tone="warn" className="is-against" title={against} />}

      {loading && <Skeleton kind="row" count={8} label="Loading your trip" />}

      {!answer && !copied && schedule.status === 'error' && (
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

      {trip && view && drawn && (
        <>
          {drawn.toGet.map((g) => (
            <section key={g.store} className="is-store" aria-label={g.store}>
              {severalStores && <h3 className="is-store-name"><Icon name="store" size={18} />{g.store}</h3>}
              {g.sections.map((s) => (
                <div key={s.name}>
                  <Sec className="is-sec-name">{s.name}</Sec>
                  <ul className="is-rows">
                    {s.rows.map((r) => (
                      <Row key={r.key} row={r} on={ticked.has(r.productId)} settling={settling.includes(r.productId)}
                           onToggle={toggle} rules={rules} />
                    ))}
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

          {drawn.basket.length > 0 && (
            <section className="is-basket" aria-labelledby="is-basket-head">
              <h3 id="is-basket-head" className="is-basket-name">
                <Icon name="bag" size={18} />In the basket <span className="is-basket-count">({view.basket.length})</span>
              </h3>
              <ul className="is-rows">
                {drawn.basket.map((r) => (
                  <Row key={r.key} row={r} on={ticked.has(r.productId)} onToggle={toggle} rules={rules} />
                ))}
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
