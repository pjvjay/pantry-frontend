// Check ingredients' "Your stores": how far the shopper goes from where they are, and the
// stores near them, nearest first, each with its address, its distance, how many of the plan's
// products it sells and about what the basket buys there, and a switch to turn it off (the plan
// then buys nothing there). When they are the demo's own stores (all of them are, or none) the
// card says so once, under its heading, rather than on every store. A new distance checks
// the recipes' products again; a store turned off or on is only skipped, an undoable edit that asks
// for the basket again. With it, while the hub serves map tiles, a map of them
// (components/storemap.tsx): a store's row and its marker light together, whether the pointer or
// focus is on the row, the marker, or an ingredient row the store sells it at (`lit`), and the map
// never moves to show it. The words are in mealplan/stores.ts.
import { useId, useMemo, useState } from 'react';

import { placeText } from '../mealplan/basics';
import { useMealPlan } from '../mealplan/store';
import type { KeyedCall } from '../mealplan/store';
import { distanceChoices, distanceLabel, kmText, storeLine, storeSpend, storesLine, storesView } from '../mealplan/stores';
import type { MealBasket, MealStores } from '../types';
import { FormCard, Segmented, Switch } from './fields';
import { StoreMap, useTilesOn } from './storemap';
import type { MapStore } from './storemap';
import { Notice } from './ui';

// The heading Ingredients' "Your stores" answers move focus to.
export const STORES_HEAD = 'mp-stores-head';

// stores: /mealplan/stores, asked by the stage, which also lets an ingredient's Options turn one
// back on. lit: the store an ingredient row elsewhere on the stage is bought at, while the pointer
// or focus is on that row. basket: the stage's basket, for what each store's share of it comes to.
export function StoresPanel({ stores, lit = null, basket = null }: { stores: KeyedCall<MealStores>;
  lit?: string | null; basket?: MealBasket | null }) {
  const mp = useMealPlan();
  const st = mp.state.draft.settings;
  const tilesOn = useTilesOn();
  const kmHead = useId();
  // the store lit on the map and in the list: the one under the pointer, else the focused row,
  // else the one an ingredient row is bought at
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const a = stores.answer;
  const litId = lit ? a?.stores.find((x) => x.name === lit)?.id ?? null : null;
  const hot = hover ?? focused ?? litId;
  const view = a ? storesView(a, st) : null;
  const total = a?.products_total ?? 0;
  const spend = useMemo(() => (basket ? storeSpend(basket) : null), [basket]);
  const demo = a?.synthetic === true;
  const origin = a?.origin ?? (st.lat != null && st.lon != null ? { lat: st.lat, lon: st.lon } : null);
  const marks: MapStore[] = (a?.stores ?? []).flatMap((x) => (x.lat != null && x.lon != null
    ? [{ id: x.id, name: x.name, at: { lat: x.lat, lon: x.lon }, off: x.off, inRange: x.in_range }] : []));
  const map = tilesOn && view && origin ? { origin, marks } : null;

  // A marker clicked: its row, opened if it is among the farther ones, and focused.
  const pick = (id: number) => {
    const row = document.querySelector<HTMLElement>(`[data-store="${id}"]`);
    const far = row?.closest('details');
    if (far && !far.open) far.open = true;
    row?.scrollIntoView({ block: 'nearest' });
    (row?.querySelector<HTMLElement>('input') ?? row)?.focus({ preventScroll: true });
  };
  const rowProps = (id: number) => ({
    'data-store': id,
    onMouseEnter: () => setHover(id),
    onMouseLeave: () => setHover(null),
    onFocus: () => setFocused(id),
    onBlur: () => setFocused(null),
  });

  return (
    <FormCard icon="store" title="Your stores" headId={STORES_HEAD} className="fc-stores"
              help={`${demo ? 'Demo stores' : 'Stores'} near ${placeText(st)} (Set up). Turn a store off and the plan buys nothing there.`}>
      <div className={map ? 'stores-body stores-body-map' : 'stores-body'}>
        <div className="stores-side">
          <p id={kmHead} className="label fc-sub">How far you go</p>
          <Segmented name="mp-km" labelledBy={kmHead} value={st.max_km ?? null}
                     options={distanceChoices(st.max_km).map((v) => ({ value: v, label: distanceLabel(v) }))}
                     onChange={(v) => mp.dispatch({ type: 'setSettings', settings: { max_km: v } })} />
          {stores.status === 'checking' && !view && <p className="muted fc-note" role="status">Finding the stores near you…</p>}
          {stores.status === 'error' && (
            <Notice tone="danger" title="The stores could not be listed"
                    actions={[{ label: 'Try again', icon: 'refresh', onClick: stores.retry }]}>
              {stores.error}
            </Notice>
          )}
          {view && (
            <>
              <p className="stores-head">{storesLine(view, st)}</p>
              {view.warning && <Notice tone="warn">{view.warning}</Notice>}
              {view.inRange.length > 0 && (
                <ul className="stores-list">
                  {view.inRange.map((x) => {
                    const line = storeLine(x, total, spend);
                    return (
                      <li key={x.id} className={`store${x.off ? ' store-off' : ''}${hot === x.id ? ' store-hot' : ''}`}
                          {...rowProps(x.id)}>
                        <Switch checked={!x.off}
                                onChange={(on) => mp.dispatch({ type: 'setStoreOff', storeId: x.id, name: x.name, off: !on })}
                                hint={<>
                                  {x.address && <span className="store-addr">{x.address}</span>}
                                  <span className="store-line">{line.head}</span>
                                  {line.share && <span className="store-share">{line.share}</span>}
                                </>}>
                          <span className="store-name">{x.name}</span>
                        </Switch>
                      </li>
                    );
                  })}
                </ul>
              )}
              {view.farther.length > 0 && (
                <details className="stores-far">
                  <summary>{view.farther.length} farther than {distanceLabel(st.max_km ?? null)}</summary>
                  <ul>
                    {view.farther.map((x) => (
                      <li key={x.id} tabIndex={-1} className={hot === x.id ? 'store-hot' : undefined} {...rowProps(x.id)}>
                        {x.name} <span className="muted">· {kmText(x.distance_km)}{x.address && ` · ${x.address}`}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
        {map && (
          <StoreMap origin={map.origin} stores={map.marks} maxKm={st.max_km ?? null} hot={hot}
                    onHot={setHover} onPick={pick} />
        )}
      </div>
    </FormCard>
  );
}
