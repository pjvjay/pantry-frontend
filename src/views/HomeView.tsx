// Home (#/home), where the console starts. With a plan, this week at a glance:
//   - a greeting for the time of day with the plan's days, beside the picture of the first meal
//     it cooks (a warm placeholder when there is none, or the demo hub cannot fetch it);
//   - "This week": the plan's six steps as a task list, each with its state in words (Done, In
//     progress, Next, Needs attention, Cannot start yet) and what it has produced so far, and one
//     "Continue" to the step to do next (mealplan/home.ts decides all of it);
//   - "Next trip": the next shopping trip, with "Shop this trip" (in-store mode) and the way to the
//     shopping plan;
//   - "Ask": a question for the assistant, carried to it and put in its message box, unsent.
// With no plan yet, one invitation to start: build a week of dinners, try the example sentence,
// or start planning by hand. How the console works is a quiet link to Workshop › About.
import { useId, useState } from 'react';
import type { FormEvent } from 'react';

import { ASK_PREFILL_KEY, arriveAt, arriving } from '../components/arrival';
import type { Arrival } from '../components/arrival';
import { Icon } from '../components/icons';
import { RecipePicture } from '../components/pictures';
import { Notice, Skeleton, Spinner, Tag } from '../components/ui';
import type { NoticeAction } from '../components/ui';
import { useBuildWeek } from '../components/useBuildWeek';
import { useHubStatus } from '../hubStatus';
import { todayIn } from '../mealplan/dates';
import { basketCounts, firstRecipe, greeting, homeTasks, nextTrip, periodText } from '../mealplan/home';
import type { NextTrip } from '../mealplan/home';
import { planPictures } from '../mealplan/images';
import { useBasket, useMealPlan, usePlanFacts } from '../mealplan/store';
import { clockText, stepHash, stepName } from '../mealplan/wizard';
import type { StepNo } from '../mealplan/wizard';
import { hrefFor } from '../routes';

// A stage of the plan, opened with a request for it (components/arrival.ts): the example in Quick
// add, focus on an answer, or only that the shopper has chosen already (no first-run sheet, and the
// keyboard on the stage's heading, since what was pressed here is gone).
function openStep(step: StepNo, arrival: Arrival) {
  arriveAt(stepHash(step), arrival);
  window.location.hash = stepHash(step);
}

// The same for a link, which goes there itself.
const asking = (step: StepNo, arrival: Arrival = {}) => arriving(stepHash(step), arrival);

// The fields of Set up a failed "Build a week" points to (MealPlanView's own Change targets).
const SETUP_FOCUS = { budget: ['#su-budget input'], diet: ['#su-diet input:checked'] };

// ─── No plan yet ─────────────────────────────────────────────

function Start() {
  // Built: on to Pick meals, where the dinners are (the toast with its Undo goes along).
  const week = useBuildWeek({ onBuilt: () => openStep(2, {}) });
  const about = useId();
  const p = week.problem;
  // after "Paste a recipe", the way on that fits why it failed (as on Pick meals)
  const second: NoticeAction | null = !p ? null
    : p.code === 'budget_infeasible' ? { label: 'Change the budget', onClick: () => openStep(1, { focus: SETUP_FOCUS.budget }) }
      : p.code === 'none_fit' ? { label: 'Change the diet', onClick: () => openStep(1, { focus: SETUP_FOCUS.diet }) }
        : p.code === 'unreachable' ? { label: 'Try again', icon: 'refresh', onClick: week.build } : null;
  return (
    <section className="home-start" aria-labelledby="home-title">
      <div className="home-start-main">
        <h2 id="home-title" className="home-title">Plan your week in a few minutes</h2>
        <p className="home-lede">
          Pick dinners for a week or two, see what they cost at stores near you, and come away with one
          shopping list and the days to cook. Your plan is kept in this browser.
        </p>
        <div className="home-start-ways">
          <button type="button" className="btn btn-primary btn-lg home-build" aria-describedby={about}
                  aria-disabled={week.running || undefined} onClick={week.build}>
            {week.running ? (
              <>
                <Spinner size={18} />Building your week…
                <span className="home-build-clock" aria-hidden="true">{clockText(week.elapsed)}</span>
              </>
            ) : <><Icon name="sparkle" size={18} />Build a week for me</>}
          </button>
          <a className="btn btn-secondary btn-lg" href={stepHash(2)} onClick={asking(2, { example: true })}>Try the example</a>
          <a className="btn btn-ghost btn-lg" href={stepHash(2)} onClick={asking(2)}>Start planning</a>
        </div>
        <p id={about} className="home-start-about">
          Build a week picks dinners from the recipe library for your budget and diet; one Undo takes them out
          again. The example is a sentence of dishes to read into a plan.
        </p>
        {week.note && <p className="mp-ways-note"><Icon name="info" size={16} />{week.note}</p>}
        {p && (
          <Notice tone="danger" title="Could not build a week" className="home-problem"
                  hint="Paste a recipe or a list of dishes in Pick meals instead, or add meals from its recipes."
                  actions={[{ label: 'Paste a recipe', icon: 'clipboard',
                    onClick: () => openStep(2, { focus: ['#mp-quick-text'] }) }, ...(second ? [second] : [])]}>
            {p.text}
          </Notice>
        )}
      </div>
      <ol className="home-start-steps" aria-label="How it goes">
        <li><Icon name="utensils" size={20} /><span><strong>Pick meals</strong> for a week or two, or have a week of dinners built for you.</span></li>
        <li><Icon name="bag" size={20} /><span><strong>Shop</strong> from one list, trip by trip, and tick it off in the store.</span></li>
        <li><Icon name="calendar" size={20} /><span><strong>Cook</strong> on the days you planned, with the trips and cook days in your calendar.</span></li>
      </ol>
    </section>
  );
}

// ─── This week ───────────────────────────────────────────────

function NextTripCard({ trip }: { trip: NextTrip }) {
  const approved = trip.look.kind === 'approved' || trip.look.kind === 'review';
  return (
    <section className="home-card home-trip" aria-labelledby="home-trip-head">
      <h3 id="home-trip-head" className="home-card-title">Next trip</h3>
      <p className="home-trip-when">
        <strong>{trip.when}</strong>{trip.when !== trip.day && <span className="home-trip-day"> · {trip.day}</span>}
      </p>
      <p className="home-trip-stores"><Icon name="store" size={18} /><span>{trip.stores}</span></p>
      <p className="home-trip-meta">
        {trip.items} · {trip.cost} ·{' '}
        <span className={`home-trip-state home-trip-${trip.look.kind}`}>
          {trip.look.kind !== 'suggested' && <Icon name={trip.look.kind === 'review' ? 'alert' : 'check'} size={14} />}
          {trip.look.word}
        </span>
      </p>
      <div className="home-trip-actions">
        <a className={`btn ${approved ? 'btn-primary' : 'btn-secondary'}`} href={hrefFor({ name: 'trip', date: trip.date })}>
          <Icon name="bag" size={18} />Shop this trip
        </a>
        <a className={`btn ${approved ? 'btn-secondary' : 'btn-primary'}`} href={hrefFor({ name: 'shop' })}
           onClick={arriving(hrefFor({ name: 'shop' }))}>
          See shopping plan
        </a>
      </div>
      {!approved && (
        <p className="home-trip-note">Suggested by the plan: approve it in the shopping plan and it is never rewritten.</p>
      )}
    </section>
  );
}

function AskBox() {
  const hub = useHubStatus();
  const [text, setText] = useState('');
  const field = useId();
  const off = hub.state === 'refused' || hub.state === 'unreachable';
  // The words go along in this tab's session storage; the Assistant puts them in its message box.
  const ask = (e: FormEvent) => {
    e.preventDefault();
    const words = text.trim();
    if (words) {
      try {
        window.sessionStorage.setItem(ASK_PREFILL_KEY, words);
      } catch {
        // storage refused: the Assistant opens with an empty box
      }
    }
    window.location.hash = hrefFor({ name: 'ask' });
  };
  return (
    <section className="home-card home-ask" aria-labelledby="home-ask-head">
      <h3 id="home-ask-head" className="home-card-title">Ask</h3>
      <form className="home-ask-form" onSubmit={ask}>
        <label className="home-ask-label" htmlFor={field}>Ask about your plan, a recipe or a product</label>
        <div className="home-ask-row">
          <input id={field} className="fc-input home-ask-input" value={text} maxLength={2000} autoComplete="off"
                 placeholder="What can I cook with what is on sale?" onChange={(e) => setText(e.target.value)} />
          <button type="submit" className="btn btn-primary"><Icon name="chat" size={18} />Ask</button>
        </div>
      </form>
      {off && (
        <p className="home-ask-off">
          <Icon name="plug" size={16} />The assistant needs the demo hub, which is not answering now. Planning and
          shopping still work.
        </p>
      )}
    </section>
  );
}

function ThisWeek() {
  const mp = useMealPlan();
  const s = mp.state;
  const d = s.draft;
  const basket = useBasket(true);
  const facts = usePlanFacts(basket);
  const schedule = mp.schedule;
  const counts = basket.answer && basket.current ? basketCounts(basket.answer, s) : null;
  const home = homeTasks(s, facts, counts, { answer: schedule.answer, failed: schedule.status === 'error' });
  const trip = nextTrip(s, schedule.answer, todayIn());
  const first = firstRecipe(d);
  const pic = first ? planPictures(d, basket.answer?.recipes ?? []).get(first) ?? null : null;
  const slot = first ? d.recipes[first]?.slot ?? 'dinner' : 'dinner';
  // the answers Home reads are still on their way (the first moments after opening): the list
  // waits for them rather than showing a state for a moment that is not the plan's
  const placedAny = d.meals.some((m) => m.date !== null);
  const settling = (!basket.answer && basket.status !== 'error')
    || (placedAny && !schedule.answer && schedule.status !== 'error');
  const weeks = d.days === 7 ? '1 week' : d.days === 14 ? '2 weeks' : `${d.days} days`;
  return (
    <>
      <section className="home-band" aria-labelledby="home-title">
        <div className="home-band-text">
          <h2 id="home-title" className="home-title">{greeting(new Date().getHours())}</h2>
          <p className="home-when">Your plan for {periodText(d)} <span className="home-weeks">({weeks})</span></p>
        </div>
        <RecipePicture pic={pic} slot={slot} size="hero" />
      </section>

      <div className="home-grid">
        <section className="home-card home-tasks" aria-labelledby="home-tasks-head">
          <h3 id="home-tasks-head" className="home-card-title">This week</h3>
          {settling ? <Skeleton kind="row" count={6} label="Checking where your plan stands" /> : (
            <>
              <ol className="home-steps">
                {home.tasks.map((t) => (
                  <li key={t.n} className={`home-step home-step-${t.tag}`}>
                    <span className="home-step-what">
                      {t.open ? <a className="home-step-name" href={stepHash(t.n)} onClick={asking(t.n)}>{t.name}</a>
                        : <span className="home-step-name">{t.name}</span>}
                      <span className="home-step-produces">{t.produces}</span>
                    </span>
                    <Tag kind={t.tag} />
                  </li>
                ))}
              </ol>
              <a className="btn btn-primary btn-lg home-continue" href={stepHash(home.next)} onClick={asking(home.next)}>
                Continue: {stepName(home.next)}<Icon name="arrow-right" size={18} />
              </a>
            </>
          )}
        </section>
        <div className="home-side">
          {trip && <NextTripCard trip={trip} />}
          <AskBox />
        </div>
      </div>
    </>
  );
}

export default function HomeView() {
  const mp = useMealPlan();
  const hasPlan = Object.keys(mp.state.draft.recipes).length > 0;
  return (
    <div className="view home">
      {hasPlan ? <ThisWeek /> : <Start />}
      <p className="home-how">
        <Icon name="info" size={18} />
        <a href={hrefFor({ name: 'workshop', tab: 'about' })}>How this works</a>
      </p>
    </div>
  );
}
