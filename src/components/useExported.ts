// Whether this plan's events have gone to a calendar (mealplan/exported.ts says what that means and
// why it is kept beside the plan, never in it): read from this browser and written to it when the
// Calendar stage's file is downloaded or a Google sync is written with nothing failed.
//
//   const exported = useExported(plan.id);
//   exported.mark: the plan's mark, or null; exported.kept: false once this browser refused to store one
//   exported.done({ sig, events, how }): this plan's events have just gone to a calendar
//
// A mark made in another tab of the same browser shows up here too.
import { useCallback, useEffect, useState } from 'react';

import type { StorageLike } from '../mealplan/persist';
import { EXPORTED_KEY, exportedFor, markExported, readExported, writeExported } from '../mealplan/exported';
import type { ExportMark, ExportedState } from '../mealplan/exported';

// localStorage, or null where the browser will not hand it over.
function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function useExported(planId: string) {
  const [state, setState] = useState<ExportedState>(() => readExported(browserStorage()));
  const [kept, setKept] = useState(true);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === EXPORTED_KEY || e.key === null) setState(readExported(browserStorage()));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const done = useCallback((m: Omit<ExportMark, 'id' | 'at'>) => {
    // read afresh, so a mark another tab made in the meantime is kept beside this one
    const next = markExported(readExported(browserStorage()), { ...m, id: planId, at: new Date().toISOString() });
    setState(next);
    setKept(writeExported(browserStorage(), next));
  }, [planId]);

  return { mark: exportedFor(state, planId), done, kept };
}
