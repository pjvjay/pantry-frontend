// "Open in Meal plan" for the Planner's week of dinners: each dinner on its own day from the
// plan's first day, as one undo step, opened on the plan's Place on days stage. A plan that already has meals is never replaced without
// asking: the shopper chooses a new plan or adding to the current one.
import { useState } from 'react';

import { weekEdit } from '../mealplan/board';
import { weekDinners } from '../mealplan/buildweek';
import { todayIn } from '../mealplan/dates';
import { useMealPlan } from '../mealplan/store';
import { stepHash } from '../mealplan/wizard';
import type { WeekPlan } from '../types';

const newId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
  : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

export function OpenInMealPlan({ week }: { week: WeekPlan }) {
  const mp = useMealPlan();
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hasMeals = mp.state.draft.meals.length > 0;

  const open = (mode: 'replace' | 'add') => {
    const out = weekEdit(mp.state, weekDinners(week), mode, todayIn(), newId());
    if ('refused' in out) {
      setProblem(out.refused);
      return;
    }
    const done = mp.dispatch(out.edit);
    if (done.refused) {
      setProblem(done.refused);
      return;
    }
    mp.announce(out.said);
    window.location.hash = stepHash(4);
  };

  if (asking) {
    return (
      <span className="row-gap" role="group" aria-label="Open in Meal plan">
        <span className="muted">Your meal plan has meals already.</span>
        <button type="button" className="mini" onClick={() => open('add')}>Add these dinners</button>
        <button type="button" className="secondary mini" onClick={() => open('replace')}>Start a new plan</button>
        <button type="button" className="secondary mini" onClick={() => setAsking(false)}>Cancel</button>
      </span>
    );
  }
  return (
    <span className="row-gap">
      <button type="button" className="secondary mini" onClick={() => (hasMeals ? setAsking(true) : open('replace'))}
              title="Each dinner on its own day, with trips, freshness and nutrition">
        Open in Meal plan
      </button>
      {problem && <span className="cart-flag">{problem}</span>}
    </span>
  );
}
