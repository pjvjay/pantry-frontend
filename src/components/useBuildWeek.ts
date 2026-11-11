// "Build a week for me", for whichever page offers it (Pick meals now, Home later): the week
// planner picks dinners from the recipe library for the plan's days, under its budget, diet,
// leave-out list and origin rules (mealplan/buildweek.ts says what it is asked and how its
// answer is checked), and they go into the plan as ONE edit (board.weekEdit in 'add' mode: each
// dinner on the first free dinner, the rest in the tray), told in a toast whose Undo takes the
// whole week back out. The edit is dispatched quiet, so the plan's own live region does not say
// it a second time.
//
//   const week = useBuildWeek({ onBuilt: (added) => … });   // onBuilt is optional
//   <button aria-disabled={week.running || undefined} onClick={week.build}>…</button>
//   week.running, week.elapsed (seconds, for "Building your week… 0:04"), week.problem (why the
//   last build added nothing, with the planner's code: 'budget_infeasible' and the like),
//   week.note (what the diet check left out of the last build). onBuilt runs once the dinners
//   are in the plan and the toast is up: a page that is not the plan (Home) can go there then.
//
// A build runs once at a time: pressing again while one runs does nothing. The plan the week
// goes into is the plan as it is when the answer arrives, not as it was when the button was
// pressed. A page that goes away mid-build stops waiting, and nothing is added.
import { useCallback, useEffect, useRef, useState } from 'react';

import { PlanAbortError, mealCatalog } from '../api';
import { HubError, planWeekWith } from '../hub';
import { weekEdit } from '../mealplan/board';
import { builtText, dietChecked, fitting, leftText, noneFitText, weekDinners, weekRequest } from '../mealplan/buildweek';
import type { LeftOut } from '../mealplan/buildweek';
import { catalogRequest } from '../mealplan/catalog';
import { todayIn } from '../mealplan/dates';
import { SLOTS } from '../mealplan/model';
import { useMealPlan } from '../mealplan/store';
import { useToast } from './ui';
import { useElapsed } from './useElapsed';

export interface BuildProblem {
  text: string;
  // the planner's reason when it gave one (PlanAlert code: 'budget_infeasible',
  // 'unavailable_within_constraints', 'missing_ingredients'); 'unreachable' when nothing answered;
  // 'none_fit' when the diet check left out every dinner; 'refused' when the plan would not take
  // them (its recipe limit)
  code: string | null;
}

export interface BuildWeek {
  build: () => void;
  running: boolean;
  elapsed: number;
  problem: BuildProblem | null;
  note: string | null;
}

const UNREACHABLE = 'The planner did not answer: the pantry API may be down. Try again in a moment.';

// A failed build in the shopper's words: the planner's own sentence when it refused ("Cheapest
// possible 6-dinner basket is $70.61 — over the $50.00 budget."), plain words when nothing
// answered.
function problemOf(e: unknown): BuildProblem {
  if (e instanceof PlanAbortError) return { text: e.message, code: e.execution.aborted?.code ?? null };
  if (e instanceof HubError && (e.status === 0 || (e.status >= 500 && e.detail === null))) {
    return { text: UNREACHABLE, code: 'unreachable' };
  }
  if (e instanceof TypeError) return { text: UNREACHABLE, code: 'unreachable' };
  return { text: e instanceof Error ? e.message : String(e), code: null };
}

const aborted = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

const newId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
  : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

export function useBuildWeek({ onBuilt }: { onBuilt?: (added: number) => void } = {}): BuildWeek {
  const mp = useMealPlan();
  const toast = useToast();
  // the plan as it is now, for an answer that arrives after the render that asked for it, and
  // the caller's latest onBuilt
  const latest = useRef(mp);
  latest.current = mp;
  const built = useRef(onBuilt);
  built.current = onBuilt;
  const busy = useRef(false);
  const ctl = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false);
  const [problem, setProblem] = useState<BuildProblem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const elapsed = useElapsed(running);

  useEffect(() => () => ctl.current?.abort(), []);

  const build = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    const c = new AbortController();
    ctl.current = c;
    setRunning(true);
    setProblem(null);
    setNote(null);
    void (async () => {
      try {
        const asked = latest.current.state.draft;
        const week = await planWeekWith(weekRequest(asked), c.signal);
        let dinners = weekDinners(week);
        let left: LeftOut[] = [];
        // the catalog's verdict, for every slot (a library dinner may be filed as a lunch)
        if (dietChecked(asked.prefs)) {
          const catalog = await mealCatalog({ ...catalogRequest(asked, []), slots: [...SLOTS] }, c.signal);
          ({ kept: dinners, left } = fitting(dinners, catalog.recipes));
        }
        if (c.signal.aborted) return;
        if (!dinners.length) {
          setProblem(left.length ? { text: noneFitText(left), code: 'none_fit' }
            : { text: 'The planner found no dinner for this plan.', code: null });
          return;
        }
        const now = latest.current;
        const out = weekEdit(now.state, dinners, 'add', todayIn(), newId());
        if ('refused' in out) {
          setProblem({ text: `Nothing was added: ${out.refused}.`, code: 'refused' });
          return;
        }
        const done = now.dispatch(out.edit, { quiet: true });
        if (done.refused) {
          setProblem({ text: `Nothing was added: ${done.refused}.`, code: 'refused' });
          return;
        }
        toast.show({ text: builtText(out.added, out.trayed, left.length),
          action: { label: 'Undo', onClick: () => latest.current.undo() } });
        const notes = [leftText(left), out.problems.length ? `Not added: ${out.problems.join('; ')}.` : null];
        setNote(notes.filter(Boolean).join(' ') || null);
        built.current?.(out.added);
      } catch (e) {
        if (aborted(e) || c.signal.aborted) return;
        setProblem(problemOf(e));
      } finally {
        if (ctl.current === c) ctl.current = null;
        busy.current = false;
        if (!c.signal.aborted) setRunning(false);
      }
    })();
  }, [toast]);

  return { build, running, elapsed, problem, note };
}
