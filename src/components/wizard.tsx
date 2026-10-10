// The wizard's frame: the progress indicator over the six stages, and Back and Next under them.
//
// The indicator is a nav of links (aria-current="step" on the stage shown), so a screen reader
// hears it as the page's steps and each stage is a place in the browser's history. A stage the
// plan cannot be on yet is not a link, and says what it waits for. Next stays in the tab order
// when it cannot be used (aria-disabled), described by what stops it, and says so if pressed.
// What a stage needs is decided in mealplan/wizard.ts.
import { useId } from 'react';

import { LAST_STEP, nextBlock, stepHash, stepName, stepViews } from '../mealplan/wizard';
import type { StepNo, WizardFacts } from '../mealplan/wizard';

export function Stepper({ step, facts }: { step: StepNo; facts: WizardFacts }) {
  const views = stepViews(step, facts);
  return (
    <nav className="mp-steps" aria-label="Meal plan stages">
      <ol>
        {views.map((v) => {
          const waits = v.reachable ? null : nextBlock((v.n - 1) as StepNo, facts)?.text ?? null;
          const said = v.attention ? `, needs attention: ${v.attention}`
            : v.state === 'done' ? ', done' : waits ? `, not yet: ${waits}` : '';
          const mark = v.state === 'done' ? (v.attention ? '!' : '✓') : String(v.n);
          const body = (
            <>
              <span className="mp-step-mark" aria-hidden="true">{mark}</span>
              <span className="mp-step-name">{v.name}</span>
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

export function StageNav({ step, facts, go, onBlocked }: {
  step: StepNo;
  facts: WizardFacts;
  go: (n: StepNo) => void;
  // Next pressed while it cannot be used: the reason, for the live region
  onBlocked: (text: string) => void;
}) {
  const why = useId();
  const block = step < LAST_STEP ? nextBlock(step, facts) : null;
  const next = (step + 1) as StepNo;
  const back = (step - 1) as StepNo;
  return (
    <div className="mp-wnav">
      {step > 1 && (
        <button type="button" className="secondary" onClick={() => go(back)}>
          <span aria-hidden="true">← </span>Back: {stepName(back)}
        </button>
      )}
      {step < LAST_STEP && (
        <button type="button" className="mp-wnav-next" aria-disabled={block ? true : undefined}
                aria-describedby={block ? why : undefined}
                onClick={() => (block ? onBlocked(`Not yet: ${block.text}.`) : go(next))}>
          Next: {stepName(next)}<span aria-hidden="true"> →</span>
        </button>
      )}
      {block && (
        <p id={why} className={`mp-wnav-why ${block.state === 'pending' ? 'muted' : 'cart-flag'}`}>
          {block.text}
          {block.state !== 'pending' && block.step < step && (
            <> · <a href={stepHash(block.step)}>Go to {stepName(block.step)}</a></>
          )}
        </p>
      )}
    </div>
  );
}
