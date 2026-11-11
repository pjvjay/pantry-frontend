// One question and the assistant's answer to it, top to bottom: the question; how the assistant
// got there (RunTimeline, one line that opens into its steps); a thinking model's reasoning; a
// recipe the hub read from a link; the answer, with its carts or meal-plan draft; and, when the
// run did not answer, what stopped it and the way to ask again.
//
// Each turn is drawn once and kept (memo): a new event redraws only the turn it belongs to, which
// matters once a conversation holds long answers and carts.
import { memo, useContext, useMemo } from 'react';
import type { Ref } from 'react';

import { replyBeforeChange, routedLinks } from '../../alternatives';
import { foldRun } from '../../transcript';
import type { Ev, Turn } from '../../transcript';
import type { RecipeImportEvent } from '../../types';
import { CartCard } from '../cart';
import { ImportActions, ImportCard } from '../ImportSheet';
import Markdown from '../Markdown';
import { MealPlanCard } from '../MealPlanCard';
import { Notice } from '../ui';
import { RunTimeline } from './RunTimeline';
import { Thought } from './Thought';

// An import's card, which opens the import sheet on what it read.
function ImportItem({ event }: { event: RecipeImportEvent }) {
  const open = useContext(ImportActions);
  return <ImportCard event={event} onOpen={open} />;
}

// The answer: the model's sentences, then what it planned. A meal-plan draft is its own card; a
// recipe's plan is a cart; a week plan keeps the hub's Markdown tables, with its "Open in Meal plan"
// link drawn only where the console has the page it leads to.
function Answer({ answer, notice, routes }: {
  answer: Ev<'assistant'>;
  notice?: string;
  routes: readonly string[];
}) {
  const plans = answer.plans ?? [];
  const meals = plans.filter((c) => c.kind === 'mealplan');
  if (meals.length > 0) {
    return (
      <div className="card answer answer-cards">
        {answer.reply && <Markdown text={answer.reply} headings={4} />}
        {meals.map((c, i) => <MealPlanCard key={i} card={c} />)}
      </div>
    );
  }
  if (plans.length > 0 && plans.every((c) => c.kind === 'plan')) {
    const before = answer.reply ? replyBeforeChange(plans) : '';
    return (
      <div className="card answer answer-cards">
        {answer.reply && <Markdown text={answer.reply} headings={4} />}
        {plans.map((c, i) => <CartCard key={i} summary={c.summary} cardRef={c.ref} pinned={c.pinned_lines} />)}
        {before && <p className="cart-notice">{before}</p>}
        {notice && <p className="cart-notice">{notice}</p>}
      </div>
    );
  }
  const links = routedLinks(plans.flatMap((c) => c.links ?? []), routes);
  return (
    <div className="card answer">
      <Markdown text={answer.text} headings={4} />
      {links.length > 0 && (
        <p className="answer-links">
          {links.map((l) => <a key={l.href} className="btn btn-secondary" href={l.href}>{l.label}</a>)}
        </p>
      )}
    </div>
  );
}

export const TurnView = memo(function TurnView({ turn, routes, modelLabel, onRetry, outage, latestRef }: {
  turn: Turn;
  routes: readonly string[];
  modelLabel?: (id: string) => string;
  onRetry: (turn: Turn) => void;
  // the demo hub is refusing or not there: a run it cut off waits for it rather than offering Try again
  outage: boolean;
  // the newest turn: where "New reply" takes focus
  latestRef?: Ref<HTMLLIElement>;
}) {
  const run = useMemo(() => foldRun(turn), [turn]);
  return (
    <li className="turn" ref={latestRef} tabIndex={latestRef ? -1 : undefined}>
      <h3 className="sr-only">You asked</h3>
      <p className="turn-q">{turn.question}</p>
      <RunTimeline run={run} sentAt={turn.sentAt} modelLabel={modelLabel} />
      <Thought run={run} />
      {run.imports.map((e, i) => <ImportItem key={i} event={e} />)}
      {run.answers.map((a, i) => <Answer key={i} answer={a} notice={turn.notice} routes={routes} />)}
      {run.status === 'failed' && (outage
        ? (
          <Notice tone="warn" title="The answer stopped: the demo hub went away">
            {run.error} Ask again once the hub is back.
          </Notice>
        )
        : (
          <Notice tone="danger" title="The assistant could not finish"
                  actions={[{ label: 'Try again', icon: 'refresh', onClick: () => onRetry(turn) }]}>
            {run.error}
          </Notice>
        ))}
      {run.status === 'stopped' && <p className="turn-stopped">You stopped this answer.</p>}
    </li>
  );
});
