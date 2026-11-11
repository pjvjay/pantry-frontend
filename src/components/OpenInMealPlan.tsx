// "Open in Meal plan" for the Planner's week of dinners: each dinner on its own day from the
// plan's first day, as one undo step, opened on the plan's Place on days stage. A plan that already has meals is never replaced without
// asking: the shopper chooses a new plan or adding to the current one.
import { useRef, useState } from 'react';

import { weekEdit } from '../mealplan/board';
import { weekDinners } from '../mealplan/buildweek';
import { todayIn } from '../mealplan/dates';
import { useMealPlan } from '../mealplan/store';
import { stepHash } from '../mealplan/wizard';
import type { WeekPlan } from '../types';
import { InlineConfirm } from './InlineConfirm';

const newId = () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
  : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join(''));

export function OpenInMealPlan({ week }: { week: WeekPlan }) {
  const mp = useMealPlan();
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // the button that asked, which has the keyboard back when the question is cancelled
  const trigger = useRef<HTMLButtonElement>(null);
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
      <InlineConfirm question="Your meal plan has meals already." returnFocus={trigger}
                     choices={[
                       { label: 'Add these dinners', onClick: () => open('add') },
                       { label: 'Start a new plan', onClick: () => open('replace'), tone: 'secondary' },
                     ]}
                     onCancel={() => setAsking(false)} />
    );
  }
  return (
    <span className="row-gap">
      <button ref={trigger} type="button" className="secondary mini"
              onClick={() => (hasMeals ? setAsking(true) : open('replace'))}
              title="Each dinner on its own day, with trips, freshness and nutrition">
        Open in Meal plan
      </button>
      {problem && <span className="cart-flag">{problem}</span>}
    </span>
  );
}
