// The wizard's frame: the progress indicator over the six stages, and Back and Next under them.
//
// The indicator is a nav of links (aria-current="step" on the stage shown), so a screen reader
// hears it as the page's steps and each stage is a place in the browser's history. A stage the
// plan cannot be on yet is not a link, and says what it waits for. Set up says it is optional.
//
// Back and Next sit in a bar that stays at the bottom of the screen, above the phone's bottom
// navigation, so the way on is always in reach; it reports how far it reaches (useKeepClear), so
// a control the keyboard moves to never comes to rest under it. Next stays in the tab order when
// it cannot be used (aria-disabled), described by what stops it, and says so if pressed. While an
// answer it waits for is on its way (the ingredients being checked), Next says so with how long it
// has waited ("Checking ingredients… 0:04"); pressed then, it moves on by itself the moment the
// answer is in, unless the shopper has gone to another stage first. What a stage needs is decided
// in mealplan/wizard.ts.
import { useEffect, useId, useState } from 'react';

import { LAST_STEP, clockText, nextBlock, stepHash, stepName, stepViews, waitWords } from '../mealplan/wizard';
import type { StepNo, WizardFacts } from '../mealplan/wizard';
import { Icon } from './icons';
import { Spinner } from './ui';
import { useElapsed } from './useElapsed';
import { useKeepClear } from './useKeepClear';

export function Stepper({ step, facts }: { step: StepNo; facts: WizardFacts }) {
  const views = stepViews(step, facts);
  return (
    <nav className="mp-steps" aria-label="Meal plan stages">
      <ol>
        {views.map((v) => {
          const waits = v.reachable ? null : nextBlock((v.n - 1) as StepNo, facts)?.text ?? null;
          const said = v.attention ? `, needs attention: ${v.attention}`
            : v.state === 'done' ? ', done' : waits ? `, not yet: ${waits}` : '';
          const mark = v.state === 'done'
            ? <Icon name={v.attention ? 'exclaim' : 'check'} size={16} strokeWidth={2.6} />
            : String(v.n);
          const body = (
            <>
              <span className="mp-step-mark" aria-hidden="true">{mark}</span>
              <span className="mp-step-name">
                {v.name}
                {v.optional && <span className="mp-step-opt"><span className="sr-only">, </span>optional</span>}
              </span>
              {said && <span className="sr-only">{said}</span>}
            </>
          );
          const cls = `mp-step mp-step-${v.state}${v.attention ? ' mp-step-attention' : ''}`
            + `${v.reachable ? '' : ' mp-step-closed'}`;
          return (
            <li key={v.n} className={cls}>
              {v.reachable ? (
                <a className="mp-step-link" href={stepHash(v.n)} aria-current={v.state === 'current' ? 'step' : undefined}>
                  {body}
                </a>
              ) : (
                <span className="mp-step-link" aria-disabled="true" title={waits ?? undefined}>{body}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StageNav({ step, facts, go, say, hidden = false }: {
  step: StepNo;
  facts: WizardFacts;
  go: (n: StepNo) => void;
  // for the live region: why Next cannot be used yet, or that it will move on by itself
  say: (text: string) => void;
  // while a meal or trip is picked up, the Moving bar takes its place at the bottom
  hidden?: boolean;
}) {
  const why = useId();
  const keepClear = useKeepClear('bottom');
  const block = step < LAST_STEP ? nextBlock(step, facts) : null;
  const pending = block?.state === 'pending';
  const waited = useElapsed(pending);
  const next = (step + 1) as StepNo;
  const back = (step - 1) as StepNo;

  // Next pressed while its answer was on the way: on to the next stage once it is in. A stage
  // change of any kind (Back, the stepper, the browser's own Back, Next itself) forgets it.
  const [queued, setQueued] = useState(false);
  useEffect(() => setQueued(false), [step]);
  const gateState = block?.state ?? 'ok';
  const gateText = block?.text ?? '';
  useEffect(() => {
    if (!queued) return;
    if (gateState === 'ok') {
      setQueued(false);
      go(next);
    } else if (gateState === 'blocked') {
      // the answer came back with something to fix: say what, and stay
      setQueued(false);
      say(`Not yet: ${gateText}.`);
    }
  }, [queued, gateState, gateText, go, next, say]);

  const press = () => {
    if (!block) go(next);
    else if (block.state === 'pending') {
      if (!queued) say(`${stepName(next)} opens as soon as the check is done.`);
      setQueued(true);
    } else say(`Not yet: ${block.text}.`);
  };

  return (
    <div ref={keepClear} className={`mp-wnav${step === 1 ? ' mp-wnav-first' : ''}`} hidden={hidden}>
      {step > 1 && (
        <button type="button" className="btn btn-secondary mp-wnav-back" onClick={() => go(back)}>
          <Icon name="arrow-left" size={16} /><span>Back<span className="mp-wnav-to">: {stepName(back)}</span></span>
        </button>
      )}
      {step < LAST_STEP && (
        <button type="button"
                className={`btn btn-primary mp-wnav-next${pending ? ' mp-wnav-wait' : ''}${queued ? ' mp-wnav-queued' : ''}`}
                aria-disabled={block?.state === 'blocked' ? true : undefined}
                aria-describedby={block ? why : undefined} onClick={press}>
          {/* the words give way (an ellipsis) before the time or the arrow on the narrowest phones */}
          {pending && block ? (
            <>
              <Spinner />
              <span className="mp-wnav-words">{waitWords(block)}</span>
              <span className="mp-wnav-clock" aria-hidden="true">{clockText(waited)}</span>
            </>
          ) : (
            <><span className="mp-wnav-words">Next: {stepName(next)}</span><Icon name="arrow-right" size={16} /></>
          )}
        </button>
      )}
      {block && (
        <p id={why} className={`mp-wnav-why ${block.state === 'pending' ? 'muted' : 'cart-flag'}`}>
          {block.text}
          {block.state === 'pending' && queued && ` ${stepName(next)} opens when it is done.`}
          {block.state !== 'pending' && block.step < step && (
            <> · <a href={stepHash(block.step)}>Go to {stepName(block.step)}</a></>
          )}
        </p>
      )}
    </div>
  );
}
