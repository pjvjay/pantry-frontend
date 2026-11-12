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

import { TIMING_KEY, readTimingForm, timingFrom } from '../calendar';
import type { StorageLike } from '../mealplan/persist';
import { EXPORTED_KEY, exportedFor, markExported, readExported, writeExported } from '../mealplan/exported';
import type { ExportMark, ExportedState } from '../mealplan/exported';
import type { CalendarTiming, MealSlot } from '../types';

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

// The browser's time zone, as the events' times are meant.
export function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

// The times and reminders the Calendar stage would send now: its saved choices (calendar.ts), in
// this browser's time zone, for the meals the plan has. A page without the Calendar stage (Home)
// compares the mark with these.
export function savedTiming(slots: readonly MealSlot[]): CalendarTiming {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(TIMING_KEY);
  } catch {
    /* none kept: the defaults */
  }
  return timingFrom(readTimingForm(raw), browserZone(), slots);
}
