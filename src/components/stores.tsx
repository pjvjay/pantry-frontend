// The Ingredients stage's "Your stores": how far the shopper goes from where they are, and the
// stores near them, nearest first, each with its distance, how many of the plan's products it
// sells, and a switch to turn it off (the plan then buys nothing there). A new distance checks the
// recipes' products again; a store turned off or on is only skipped, an undoable edit that asks
// for the basket again. The words are in mealplan/stores.ts.
import { useId } from 'react';

import { placeText } from '../mealplan/basics';
import { useMealPlan, useStores } from '../mealplan/store';
import { distanceChoices, distanceLabel, kmText, sellsText, storesLine, storesView } from '../mealplan/stores';
import { FormCard, Segmented, Switch } from './fields';

// The heading Ingredients' "Your stores" answers move focus to.
export const STORES_HEAD = 'mp-stores-head';

export function StoresPanel() {
  const mp = useMealPlan();
  const st = mp.state.draft.settings;
  const stores = useStores(true);
  const kmHead = useId();
  const view = stores.answer ? storesView(stores.answer, st) : null;
  const total = stores.answer?.products_total ?? 0;
  return (
    <FormCard icon="store" title="Your stores" headId={STORES_HEAD} className="fc-stores"
              help={`Near ${placeText(st)} (Basics). Turn a store off and the plan buys nothing there.`}>
      <p id={kmHead} className="fc-sub">How far you go</p>
      <Segmented name="mp-km" labelledBy={kmHead} value={st.max_km ?? null}
                 options={distanceChoices(st.max_km).map((v) => ({ value: v, label: distanceLabel(v) }))}
                 onChange={(v) => mp.dispatch({ type: 'setSettings', settings: { max_km: v } })} />
      {stores.status === 'checking' && !view && <p className="muted fc-note" role="status">Finding the stores near you…</p>}
      {stores.status === 'error' && (
        <p className="cart-flag fc-note" role="alert">
          The stores could not be listed: {stores.error}{' '}
          <button type="button" className="linkish" onClick={stores.retry}>Try again</button>
        </p>
      )}
      {view && (
        <>
          <p className="stores-head">{storesLine(view, st)}</p>
          {view.warning && <p className="banner banner-update fc-note" role="alert">{view.warning}</p>}
          {view.inRange.length > 0 && (
            <ul className="stores-list">
              {view.inRange.map((s) => (
                <li key={s.id} className={s.off ? 'store-off' : undefined}>
                  <Switch checked={!s.off}
                          onChange={(on) => mp.dispatch({ type: 'setStoreOff', storeId: s.id, name: s.name, off: !on })}
                          hint={<>{kmText(s.distance_km)} · {sellsText(s.sells, total)}{s.address && <> · {s.address}</>}</>}>
                    {s.name}
                  </Switch>
                </li>
              ))}
            </ul>
          )}
          {view.farther.length > 0 && (
            <details className="stores-far">
              <summary>{view.farther.length} farther than {distanceLabel(st.max_km ?? null)}</summary>
              <ul>
                {view.farther.map((s) => (
                  <li key={s.id}>{s.name} <span className="muted">· {kmText(s.distance_km)}</span></li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </FormCard>
  );
}
