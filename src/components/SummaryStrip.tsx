// Pick meals opens by restating Set up, as GOV.UK's "check your answers" does: each answer in a
// few words (when, the budget, the diet, what to leave out, where the shopper is and how far
// they go, the days they shop), each with a Change that goes back to it in Set up, focused there,
// so the keyboard is where the change is made. Set up is optional: for most shoppers this strip
// is where they see what the plan assumes (a week from tomorrow, no budget, anything) before
// they start. A grid of short cells, two to a row on a phone, each reading down: what it is, the
// answer, and that answer's own Change under it (never at the cell's far edge, where it would sit
// against the next cell and read as part of it); the words are in mealplan/basics.ts
// (setupStrip).
import type { MouseEvent } from 'react';

import { setupStrip } from '../mealplan/basics';
import type { SetupItem } from '../mealplan/basics';
import { useMealPlan } from '../mealplan/store';
import { stepHash } from '../mealplan/wizard';

export function SetupStrip({ onChange }: { onChange: (key: SetupItem['key']) => void }) {
  const mp = useMealPlan();
  const items = setupStrip(mp.state.draft);
  // A plain click goes there in this page, focused on the answer; a click that asks for another
  // tab or window is the browser's.
  const change = (e: MouseEvent<HTMLAnchorElement>, key: SetupItem['key']) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onChange(key);
  };
  return (
    <section className="card mp-setup" aria-labelledby="mp-setup-head">
      <h3 id="mp-setup-head" className="mp-setup-head">Your setup</h3>
      <dl className="mp-setup-list">
        {items.map((x) => (
          <div key={x.key} className="mp-setup-item">
            <dt className="label">{x.label}</dt>
            <dd className="mp-setup-value">
              {x.value}
              {x.note && <span className="mp-setup-note">{x.note}</span>}
            </dd>
            <dd className="mp-setup-change">
              <a href={stepHash(1)} onClick={(e) => change(e, x.key)}>
                Change<span className="sr-only"> {x.change}</span>
              </a>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
