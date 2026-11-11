// One trip's basket in the store (in-store mode): the products ticked off, read from and written
// to this browser beside the plan, never into it (mealplan/shopping.ts says why). A tick changes
// nothing the plan's store sees: no new revision, no schedule call, no undo step.
//
//   const ticks = useTicks(plan.id, '2026-11-13', planDays);
//   ticks.ticked: the product ids in the basket; ticks.set(productId, true | false)
//   ticks.kept: false once this browser refused to store a tick (they last while the page is open)
//
// Dates no longer among the plan's days are dropped when the page opens. Ticks made in another tab
// of the same browser show up here too.
import { useCallback, useEffect, useRef, useState } from 'react';

import type { StorageLike } from '../mealplan/persist';
import { SHOPPING_KEY, pruneShopping, readShopping, setTicked, tickedOn, writeShopping } from '../mealplan/shopping';
import type { ShoppingState } from '../mealplan/shopping';

// localStorage, or null where the browser will not hand it over.
function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useTicks(planId: string, date: string, days: readonly string[]) {
  const [state, setState] = useState<ShoppingState>(() => readShopping(browserStorage()));
  // the latest state, for a tick made before the render of the one before it
  const latest = useRef(state);
  const [kept, setKept] = useState(true);
  const daysKey = days.join(',');

  const keep = useCallback((next: ShoppingState) => {
    latest.current = next;
    setState(next);
    setKept(writeShopping(browserStorage(), next));
  }, []);

  useEffect(() => {
    const next = pruneShopping(latest.current, planId, daysKey ? daysKey.split(',') : []);
    if (next !== latest.current) keep(next);
  }, [planId, daysKey, keep]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SHOPPING_KEY && e.key !== null) return;
      const next = readShopping(browserStorage());
      latest.current = next;
      setState(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const set = useCallback((productId: number, on: boolean) => {
    const next = setTicked(latest.current, planId, date, productId, on);
    if (next !== latest.current) keep(next);
  }, [planId, date, keep]);

  return { ticked: tickedOn(state, planId, date), set, kept };
}
