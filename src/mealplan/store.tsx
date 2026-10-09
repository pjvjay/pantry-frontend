// The meal plan's state for the views: the reducer's plan with undo, saved in this browser,
// and the server calls around it.
//
// - Saving: pantry.mealplan.v1, 300 ms after the last change and on pagehide. A plan that could
//   not be read was copied to the backup key first; if even that copy failed, nothing is saved
//   over it until the shopper edits the new plan.
// - Schedule: /mealplan/schedule 400 ms after the last change, never during a drag. Each call
//   carries the draft's rev and the answer is used only while the rev still matches, so a slow
//   answer never paints over a newer plan; while a call runs the last answer stays on screen,
//   marked as not current, and approving waits for a current one. The dates the server spread
//   meals to are stored back on the plan (mergeSchedule). An answer the console already holds
//   for the rev an edit just made (Options checks a choice before making it) is used as it is,
//   with no second call (adoptSchedule).
// - Resolve: each recipe once, as it enters the tray, never on a drag (the one call that may
//   use a model). A failure is not retried on its own; retryResolve does that, both for a call
//   that failed and for a recipe the server answered with a failure status (llm_error,
//   not_found and the like), which it first makes pending again.
// - My recipes: read from pantry.recipes.v1, and the recipes recipe import sent with "Add to
//   meal plan" (pantry.mealplan.inbox.v1) join the tray, on load, when another tab saves, and
//   when the Meal plan view opens (syncSaved; a save in this same page fires no storage event).
// - Announcements: one polite live region, rendered here, for every edit and refusal.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import {
  ApiError, getMealStarters, parseSelection, resolveRecipes, scheduleMealPlan, suggestCookDays,
} from '../api';
import type {
  CookDaysProposal, MealSchedule, MealStarter, RecipeDoc, RecipeRef, Trip, TripStrategy,
} from '../types';
import {
  MEAL_PLAN_INBOX_KEY, RECIPES_KEY, forSelection, inboxEdit, readMyRecipes, takeInbox,
} from '../myRecipes';
import type { StorageLike } from '../myRecipes';
import { todayIn } from './dates';
import { historyStep, newPlan, recorded, redoPlan, undoPlan } from './model';
import type { MealPlanState, Outcome, PlanEdit } from './model';
import { parsePlan, readPlan, serialize, writePlan } from './persist';
import { buildPreview, previewEdit } from './selectionPreview';
import type { Preview } from './selectionPreview';
import { canRedo, canUndo, startHistory } from './undo';
import type { History } from './undo';

const SAVE_DELAY_MS = 300;
const SCHEDULE_DELAY_MS = 400;
const RESOLVE_DELAY_MS = 500;

export type CallStatus = 'idle' | 'checking' | 'ok' | 'error';

export interface ScheduleView {
  status: CallStatus;
  answer: MealSchedule | null;     // the last answer, kept while a newer one is on its way
  current: boolean;                // the answer is for the plan as it is now
  error: string | null;
  // the refusal's code and detail as pantry-api sent them (422 pin_invalid names the line)
  errorCode?: string | null;
  errorDetail?: unknown;
}

export interface ProposalView {
  status: CallStatus;
  proposal: CookDaysProposal | null;
  error: string | null;
}

export interface MealPlanApi {
  state: MealPlanState;
  dispatch: (e: PlanEdit) => Outcome;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  announce: (text: string) => void;
  // ok: saved in this browser; unavailable: storage is off; failed: the last save was refused
  persist: 'ok' | 'unavailable' | 'failed';
  loadProblem: string | null;      // why a saved plan could not be read (it was kept as a backup)
  schedule: ScheduleView;
  recheck: () => void;
  // An answer computed for the draft as the last edit made it (its rev): shown at once, instead
  // of asking the server again. An answer for any other rev is ignored.
  adoptSchedule: (answer: MealSchedule) => void;
  setDragging: (dragging: boolean) => void;
  resolve: { status: CallStatus; error: string | null; pending: string[] };
  retryResolve: (recipeKey?: string) => void;
  starters: MealStarter[];
  myRecipes: RecipeDoc[];
  myRecipesProblem: string | null;  // also says what could not join the plan from recipe import
  syncSaved: () => void;
  quickAdd: (text: string, signal?: AbortSignal) => Promise<Preview>;
  acceptPreview: (p: Preview) => { outcome: Outcome | null; problems: string[] };
  cookDays: ProposalView;
  proposeCookDays: () => void;
  applyCookDays: () => Outcome | null;
  dismissCookDays: () => void;
  // replace: the day's approval under the other strategy gives way to this one
  approveTrip: (trip: Trip, strategy: TripStrategy, replace?: boolean) => Outcome;
  exportText: () => string;
  importText: (text: string) => string | null;
  clear: () => void;
}

const MealPlanContext = createContext<MealPlanApi | null>(null);

export function useMealPlan(): MealPlanApi {
  const api = useContext(MealPlanContext);
  if (!api) throw new Error('useMealPlan needs a <MealPlanProvider> above it');
  return api;
}

// localStorage, or null where the browser will not hand it over (some private modes throw on
// the property itself).
function browserStorage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// A plan id. randomUUID exists only in secure contexts; getRandomValues works everywhere.
function newId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

// The refs a resolve call sends: the tray's recipe as the server reads it.
function refsToResolve(s: MealPlanState, keys: string[]): RecipeRef[] {
  return keys.filter((k) => s.draft.recipes[k]).map((k) => s.draft.recipes[k].ref);
}

function initial(): { history: History<MealPlanState>; loadProblem: string | null;
  available: boolean; holdSave: boolean } {
  const read = readPlan(browserStorage());
  const state = read.state ?? newPlan(todayIn(), newId());
  return { history: startHistory(state), loadProblem: read.problem, available: read.available,
    holdSave: Boolean(read.problem && !read.backedUp) };
}

export function MealPlanProvider({ children }: { children: ReactNode }) {
  const [boot] = useState(initial);
  const [history, setHistory] = useState(boot.history);
  // The latest history for callbacks and async answers, which outlive the render they came from.
  const historyRef = useRef(history);
  const holdSave = useRef(boot.holdSave);
  const [persist, setPersist] = useState<MealPlanApi['persist']>(boot.available ? 'ok' : 'unavailable');
  const [spoken, setSpoken] = useState('');

  const announce = useCallback((text: string) => {
    // Clear first, so the same sentence twice is still read out twice.
    setSpoken('');
    window.setTimeout(() => setSpoken(text), 50);
  }, []);

  const commit = useCallback((next: History<MealPlanState>) => {
    historyRef.current = next;
    setHistory(next);
  }, []);

  const dispatch = useCallback((e: PlanEdit): Outcome => {
    const { history: next, outcome } = historyStep(historyRef.current, e);
    if (next !== historyRef.current) {
      if (recorded(e)) holdSave.current = false;
      commit(next);
    }
    const text = outcome.refused ? `Not done: ${outcome.refused}.` : outcome.said;
    if (text) announce(text);
    return outcome;
  }, [announce, commit]);

  const undo = useCallback(() => {
    if (!canUndo(historyRef.current)) return;
    commit(undoPlan(historyRef.current));
    announce('Undone.');
  }, [announce, commit]);

  const redo = useCallback(() => {
    if (!canRedo(historyRef.current)) return;
    commit(redoPlan(historyRef.current));
    announce('Redone.');
  }, [announce, commit]);

  const state = history.present;
  const { draft } = state;

  // ─── Saving ────────────────────────────────────────────────
  useEffect(() => {
    if (persist === 'unavailable' || holdSave.current) return;
    const save = () => {
      const ok = writePlan(browserStorage(), historyRef.current.present, new Date().toISOString());
      setPersist(ok ? 'ok' : 'failed');
    };
    const timer = window.setTimeout(save, SAVE_DELAY_MS);
    window.addEventListener('pagehide', save);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', save);
    };
  }, [state, persist]);

  // ─── Schedule ──────────────────────────────────────────────
  const [schedule, setSchedule] = useState<Omit<ScheduleView, 'current'>>(
    { status: 'idle', answer: null, error: null });
  const [dragging, setDragging] = useState(false);
  const [recheckTick, setRecheckTick] = useState(0);
  const hasRecipes = Object.keys(draft.recipes).length > 0;
  const adopted = useRef<MealSchedule | null>(null);

  useEffect(() => {
    if (dragging) return;
    if (!hasRecipes) {
      setSchedule({ status: 'idle', answer: null, error: null });
      return;
    }
    const held = adopted.current;
    adopted.current = null;
    if (held && held.rev === historyRef.current.present.draft.rev) {
      setSchedule({ status: 'ok', answer: held, error: null });
      dispatch({ type: 'mergeSchedule', schedule: held });
      return;
    }
    const ctl = new AbortController();
    setSchedule((s) => ({ ...s, status: 'checking' }));
    const timer = window.setTimeout(() => {
      const sent = historyRef.current.present.draft;
      scheduleMealPlan(sent, ctl.signal).then((answer) => {
        // The revision gate: an answer for an older plan is dropped.
        if (answer.rev !== historyRef.current.present.draft.rev) return;
        setSchedule({ status: 'ok', answer, error: null });
        dispatch({ type: 'mergeSchedule', schedule: answer });
      }).catch((e) => {
        if (aborted(e)) return;
        setSchedule((s) => ({ ...s, status: 'error', error: message(e),
          errorCode: e instanceof ApiError ? e.code : null,
          errorDetail: e instanceof ApiError ? e.detail : null }));
      });
    }, SCHEDULE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      ctl.abort();
    };
  }, [draft.rev, dragging, hasRecipes, recheckTick, dispatch]);

  const recheck = useCallback(() => setRecheckTick((n) => n + 1), []);
  // Shown in the same render as the edit it was computed for, so what the edit redraws (a trip
  // line with another product) is on screen when focus looks for it.
  const adoptSchedule = useCallback((answer: MealSchedule) => {
    if (answer.rev !== historyRef.current.present.draft.rev) return;
    adopted.current = answer;
    setSchedule({ status: 'ok', answer, error: null });
  }, []);

  // ─── Resolve ───────────────────────────────────────────────
  const [resolve, setResolve] = useState<{ status: CallStatus; error: string | null }>(
    { status: 'idle', error: null });
  const failed = useRef(new Set<string>());
  const [retryTick, setRetryTick] = useState(0);
  const pending = useMemo(() => Object.keys(draft.recipes).filter((k) => !draft.resolved[k]).sort(),
    [draft.recipes, draft.resolved]);
  const pendingKey = pending.join('|');
  const { lat, lon, max_km } = draft.settings;
  // The plan's origin rules, as one key: a new array each render must not start a new call.
  const origin = JSON.stringify([draft.settings.exclude_origin ?? [], draft.settings.preference ?? []]);

  useEffect(() => {
    const waiting = pendingKey ? pendingKey.split('|') : [];
    // A recipe taken out and added back gets another try.
    for (const k of [...failed.current]) if (!waiting.includes(k)) failed.current.delete(k);
    const keys = waiting.filter((k) => !failed.current.has(k));
    if (!keys.length) return;
    const ctl = new AbortController();
    let retry = 0;
    // A short wait gathers recipes added one tap after another into one call: resolve allows
    // only a few calls a minute per client.
    const timer = window.setTimeout(() => {
      const recipes = refsToResolve(historyRef.current.present, keys).slice(0, 12);
      if (!recipes.length) return;
      setResolve({ status: 'checking', error: null });
      const [exclude_origin, preference] = JSON.parse(origin) as [string[], string[]];
      resolveRecipes({ recipes, lat, lon, max_km, exclude_origin, preference }, ctl.signal).then((r) => {
        dispatch({ type: 'setResolved', resolved: r.resolved });
        setResolve({ status: 'ok', error: null });
      }).catch((e) => {
        if (aborted(e)) return;
        for (const k of keys) failed.current.add(k);
        setResolve({ status: 'error', error: message(e) });
        // Over the rate limit the server says when to come back; try once more then.
        if (e instanceof ApiError && e.status === 429 && e.retryAfterS !== null) {
          retry = window.setTimeout(() => {
            for (const k of keys) failed.current.delete(k);
            setRetryTick((n) => n + 1);
          }, e.retryAfterS * 1000);
        }
      });
    }, RESOLVE_DELAY_MS);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(retry);
      ctl.abort();
    };
  }, [pendingKey, lat, lon, max_km, origin, retryTick, dispatch]);

  const retryResolve = useCallback((recipeKey?: string) => {
    if (recipeKey) dispatch({ type: 'forgetResolved', key: recipeKey });
    failed.current.clear();
    // The last call's error is not this one's: the tray says "Checking products…" until it ends.
    setResolve({ status: 'idle', error: null });
    setRetryTick((n) => n + 1);
  }, [dispatch]);

  // ─── Starters and my recipes ───────────────────────────────
  const [starters, setStarters] = useState<MealStarter[]>([]);
  useEffect(() => {
    const ctl = new AbortController();
    getMealStarters(ctl.signal).then(setStarters).catch(() => {
      /* the tray still offers library recipes and the shopper's own */
    });
    return () => ctl.abort();
  }, []);

  const [mine, setMine] = useState(() => readMyRecipes(browserStorage()));
  // What could not join the plan from the inbox. It stays until a later take finds something,
  // because the take after it (another tab's event, the view opening) finds the inbox empty.
  const [inboxNote, setInboxNote] = useState<string | null>(null);

  // Saved recipes read again, and the ones sent with "Add to meal plan" added to the tray with
  // one meal each, as one undo step.
  const syncSaved = useCallback(() => {
    const storage = browserStorage();
    const read = readMyRecipes(storage);
    setMine(read);
    const inbox = takeInbox(storage);
    if (!inbox.entries.length && !inbox.problem) return;
    const { edit, problems } = inboxEdit(inbox.entries, read.recipes, historyRef.current.present);
    if (edit) dispatch(edit);
    const notes = [inbox.problem, ...problems].filter((x): x is string => Boolean(x));
    setInboxNote(notes.length ? notes.join(' ') : null);
  }, [dispatch]);

  useEffect(() => {
    syncSaved();
    // Recipes saved or sent in another tab appear here too.
    const changed = (e: StorageEvent) => {
      if (e.key === RECIPES_KEY || e.key === MEAL_PLAN_INBOX_KEY || e.key === null) syncSaved();
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [syncSaved]);

  // ─── Quick add ─────────────────────────────────────────────
  const quickAdd = useCallback(async (text: string, signal?: AbortSignal) => {
    const household = historyRef.current.present.draft.prefs.household_servings;
    const result = await parseSelection({ text, recipes: forSelection(mine.recipes),
      household_servings: household }, signal);
    return buildPreview(result, household);
  }, [mine.recipes]);

  const acceptPreview = useCallback((p: Preview) => {
    const { edit, problems } = previewEdit(p, historyRef.current.present,
      { starters, myRecipes: mine.recipes });
    return { outcome: edit ? dispatch(edit) : null, problems };
  }, [dispatch, starters, mine.recipes]);

  // ─── Suggest cook days ─────────────────────────────────────
  const [cookDays, setCookDays] = useState<ProposalView>({ status: 'idle', proposal: null, error: null });
  const cookCtl = useRef<AbortController | null>(null);

  const proposeCookDays = useCallback(() => {
    cookCtl.current?.abort();
    const ctl = new AbortController();
    cookCtl.current = ctl;
    setCookDays({ status: 'checking', proposal: null, error: null });
    suggestCookDays(historyRef.current.present.draft, ctl.signal)
      .then((proposal) => setCookDays({ status: 'ok', proposal, error: null }))
      .catch((e) => {
        if (!aborted(e)) setCookDays({ status: 'error', proposal: null, error: message(e) });
      });
  }, []);

  const applyCookDays = useCallback(() => {
    if (!cookDays.proposal) return null;
    const outcome = dispatch({ type: 'applyCookDays', proposal: cookDays.proposal });
    if (!outcome.refused) setCookDays({ status: 'idle', proposal: null, error: null });
    return outcome;
  }, [cookDays.proposal, dispatch]);

  const dismissCookDays = useCallback(() => {
    cookCtl.current?.abort();
    setCookDays({ status: 'idle', proposal: null, error: null });
  }, []);

  useEffect(() => () => cookCtl.current?.abort(), []);

  // ─── Trips, export, import ─────────────────────────────────
  // Approving needs an answer for the plan as it is; the reducer refuses an older one.
  const approveTrip = useCallback((trip: Trip, strategy: TripStrategy, replace = false) =>
    dispatch({ type: 'approveTrip', trip, strategy, rev: schedule.answer?.rev ?? -1, replace }),
  [dispatch, schedule.answer]);

  const exportText = useCallback(() =>
    serialize(historyRef.current.present, new Date().toISOString()), []);

  const importText = useCallback((text: string) => {
    const loaded = parsePlan(text);
    if (!loaded.state) return loaded.problem;
    const outcome = dispatch({ type: 'replace', state: loaded.state });
    return outcome.refused;
  }, [dispatch]);

  const clear = useCallback(() => {
    dispatch({ type: 'clear', today: todayIn(), id: newId() });
  }, [dispatch]);

  const api = useMemo<MealPlanApi>(() => ({
    state, dispatch, undo, redo, canUndo: canUndo(history), canRedo: canRedo(history), announce,
    persist, loadProblem: boot.loadProblem,
    schedule: { ...schedule, current: schedule.answer?.rev === draft.rev && schedule.status === 'ok' },
    recheck, adoptSchedule, setDragging,
    resolve: { ...resolve, pending },
    retryResolve, starters, myRecipes: mine.recipes, myRecipesProblem: [mine.problem, inboxNote].filter(Boolean).join(' ') || null,
    syncSaved,
    quickAdd, acceptPreview, cookDays, proposeCookDays, applyCookDays, dismissCookDays, approveTrip,
    exportText, importText, clear,
  }), [state, dispatch, undo, redo, history, announce, persist, boot.loadProblem, schedule, draft.rev,
    recheck, adoptSchedule, resolve, pending, retryResolve, starters, mine, inboxNote, syncSaved, quickAdd, acceptPreview, cookDays,
    proposeCookDays, applyCookDays, dismissCookDays, approveTrip, exportText, importText, clear]);

  return (
    <MealPlanContext.Provider value={api}>
      {children}
      <div className="sr-only" role="status" aria-live="polite">{spoken}</div>
    </MealPlanContext.Provider>
  );
}
