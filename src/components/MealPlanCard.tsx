// The Assistant's meal-plan draft (pantry's plan_meals) as a card: the days as a strip, what
// Apply changes in the shopper's Meal plan, the dishes that wait for the shopper's word (Use /
// Not this), the suggested trips, and Apply (one undo step) and Open in Meal plan. Nothing here
// approves a trip: that is the shopper's, in the Meal plan.
import { useState } from 'react';

import {
  applyDraft, asMealPlan, current, draftDiff, endOf, initials, stripDays, tripText,
} from '../mealplan/chatDraft';
import type { ChatMealPlan, Decisions } from '../mealplan/chatDraft';
import { dayLabel } from '../mealplan/dates';
import { useMealPlan } from '../mealplan/store';
import type { PlanCardData } from '../types';

const SLOT_SHORT: Record<string, string> = { breakfast: 'B', lunch: 'L', dinner: 'D', snack: 'S' };

function Strip({ plan }: { plan: ChatMealPlan }) {
  const days = stripDays(plan);
  return (
    <ol className="mp-strip" aria-label={`The draft by day, ${dayLabel(plan.start_date)} to ${dayLabel(endOf(plan))}`}>
      {days.map((d) => {
        const said = d.meals.map((m) => `${m.title} (${m.slot}${m.new ? ', new' : ''})`);
        if (d.trip) said.push(`suggested trip ${tripText(d.trip)}`);
        return (
          <li key={d.date} className={`mp-day${d.meals.some((m) => m.new) ? ' mp-day-new' : ''}`}
              aria-label={`${d.label}: ${said.join(', ') || 'nothing planned'}`}>
            <span className="mp-day-head" aria-hidden="true">{d.label.split(' ').slice(0, 2).join(' ')}</span>
            <span className="mp-day-meals" aria-hidden="true">
              {d.meals.map((m, i) => (
                <span key={i} className={`mp-meal${m.new ? ' mp-meal-new' : ''}`} title={`${m.title} (${m.slot})`}>
                  <span className="mp-meal-slot">{SLOT_SHORT[m.slot] ?? '?'}</span>{initials(m.title)}
                </span>
              ))}
            </span>
            {d.trip && <span className="mp-trip" aria-hidden="true" title={`Suggested trip: ${tripText(d.trip)}`}>🛒</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function MealPlanCard({ card }: { card: PlanCardData }) {
  const mp = useMealPlan();
  const plan = asMealPlan(card.summary);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [result, setResult] = useState<{ said: string; skipped: string[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!plan) return null;

  const fresh = current(mp.state, plan);
  const diff = draftDiff(mp.state, plan, decisions);
  // a second press of the same answer takes it back
  const decide = (key: string, d: 'use' | 'reject') => setDecisions((prev) => {
    const next = { ...prev };
    if (next[key] === d) delete next[key];
    else next[key] = d;
    return next;
  });
  const waiting = plan.proposals.filter((p) => !decisions[p.recipe_key]).length;
  const total = plan.total_cost === null ? 'price unknown'
    : `${plan.total_is_floor ? 'at least ' : ''}$${plan.total_cost.toFixed(2)}`;
  const newMeals = plan.meals.filter((m) => m.new).length;

  const apply = () => {
    const out = applyDraft(mp.state, plan, decisions);
    if ('refused' in out) {
      setProblem(out.refused);
      return;
    }
    const done = mp.dispatch(out.edit);
    if (done.refused) {
      setProblem(done.refused);
      return;
    }
    setProblem(null);
    setResult({ said: out.said, skipped: out.skipped });
    mp.announce(`${out.said} Undo is in the Meal plan.`);
  };

  return (
    <section className="cart mp-card" aria-label={`Meal plan draft: ${plan.days} days from ${dayLabel(plan.start_date)}`}>
      <div className="cart-head">
        <div>
          <div className="cart-title">Meal plan draft</div>
          <div className="muted">
            {plan.days} days from {dayLabel(plan.start_date)} · {newMeals} new meal{newMeals === 1 ? '' : 's'} · each serves {plan.household_servings}
          </div>
          {card.label && <span className="chip chip-muted mp-label">{card.label}</span>}
        </div>
        <div className="cart-total" title="The suggested trips' total (demo prices)">{total}</div>
      </div>

      <Strip plan={plan} />

      <div className="mp-section">
        <h4>What Apply changes in your Meal plan</h4>
        {!fresh && (
          <p className="cart-flag">Your Meal plan changed since this draft: each change is tried
            in turn, and a meal whose slot is taken waits for a free one.</p>
        )}
        {diff.length ? <ul className="mp-diff">{diff.map((line) => <li key={line}>{line}</li>)}</ul>
          : <p className="muted">Nothing yet: say Use to a dish below.</p>}
      </div>

      {plan.proposals.length > 0 && (
        <div className="mp-section">
          <h4>Needs your OK (not placed)</h4>
          <ul className="mp-proposals">
            {plan.proposals.map((p) => {
              const d = decisions[p.recipe_key];
              return (
                <li key={p.recipe_key}>
                  <span>{p.question} <span className="muted">{p.count} {p.slot === 'dinner' ? 'dinners' : `${p.slot}s`}</span></span>
                  <span className="row-gap" role="group" aria-label={`${p.title}: use it?`}>
                    <button type="button" className={`mini${d === 'use' ? '' : ' secondary'}`} aria-pressed={d === 'use'}
                            aria-label={`Use ${p.title} for "${p.input}"`} disabled={result !== null}
                            onClick={() => decide(p.recipe_key, 'use')}>Use</button>
                    <button type="button" className={`mini${d === 'reject' ? '' : ' secondary'}`} aria-pressed={d === 'reject'}
                            aria-label={`Not this: ${p.title} is not "${p.input}"`} disabled={result !== null}
                            onClick={() => decide(p.recipe_key, 'reject')}>Not this</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {plan.unmatched.length > 0 && (
        <div className="mp-section">
          <h4>Not found</h4>
          <ul className="mp-diff">
            {plan.unmatched.map((u) => (
              <li key={u.input}>
                {u.input}
                {u.candidates.length > 0 && <span className="muted"> (could be {u.candidates.map((c) => c.title).join(', ')})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mp-section">
        <h4>Suggested trips ({plan.strategy === 'fresh' ? 'shop fresh' : 'fewest trips'})</h4>
        {plan.trips.length ? (
          <ul className="mp-diff">
            {plan.trips.map((t) => (
              <li key={t.date}>{tripText(t)} <span className="muted">at {t.stores.join(', ') || 'no store'} · {t.items} item{t.items === 1 ? '' : 's'}</span></li>
            ))}
          </ul>
        ) : <p className="muted">No trips yet.</p>}
        <p className="muted">Demo prices. Only you approve a trip, in the Meal plan.</p>
        {plan.nutrition && <p className="muted mp-nutrition">{plan.nutrition}</p>}
        {plan.warnings.length > 0 && (
          <ul className="mp-warnings">{plan.warnings.map((w) => <li key={w} className="cart-flag">{w}</li>)}</ul>
        )}
      </div>

      <div className="cart-foot mp-actions">
        {result ? (
          <p role="status" className="mp-applied">
            Applied: {result.said}{result.skipped.length > 0 && ` Not applied: ${result.skipped.join('; ')}.`} Undo is in the Meal plan.
          </p>
        ) : (
          <button type="button" onClick={apply}
                  title={waiting ? `${waiting} dish(es) wait for your Use or Not this; Apply leaves them out` : undefined}>
            Apply to my Meal plan
          </button>
        )}
        <a className="card-link" href="#/mealplan?from=assistant">Open in Meal plan</a>
        {problem && <p className="cart-flag" role="alert">Not applied: {problem}.</p>}
      </div>
    </section>
  );
}
