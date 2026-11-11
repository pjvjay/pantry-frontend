// A question asked in place, instead of the browser's own confirm box: the control that asked
// gives way to the question, its choices and Cancel, in the console's words and look. The Planner
// lab's "Open in Meal plan" asks this way when the plan has meals already, Simulations before
// "Run all" spends a day's model quota, and System before "Reset demo data" reseeds the database.
//
// The keyboard comes with it. It starts on the first choice, since the control that asked has
// just gone; Escape is Cancel (and only Cancel: inside a sheet it does not close the sheet too).
// When the question goes with focus in it (Cancel, Escape, or a choice its owner answers by
// closing it), focus goes back to the control that asked, if the owner names it and it is on the
// page again. A choice that takes the shopper elsewhere leaves focus to the page it opens.
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';

export interface ConfirmChoice {
  label: string;
  onClick: () => void;
  // the way on (primary: the first choice's unless it says otherwise), another way (secondary),
  // or one that removes or resets something (danger)
  tone?: 'primary' | 'secondary' | 'danger';
}

export function InlineConfirm({ question, detail, choices, onCancel, cancelLabel = 'Cancel', returnFocus,
  className }: {
  // what is being asked, in one sentence; it names the group the choices sit in
  question: ReactNode;
  // what follows from it, in a quieter line under the question
  detail?: ReactNode;
  choices: ConfirmChoice[];
  // Cancel and Escape: the owner puts the control that asked back
  onCancel: () => void;
  cancelLabel?: string;
  // the control that asked, focused again when the question goes with focus in it
  returnFocus?: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const detailId = useId();
  const back = useRef(returnFocus);
  back.current = returnFocus;
  const hadFocus = useRef(false);

  useEffect(() => { first.current?.focus(); }, []);

  // As it leaves: a layout cleanup runs while the question is still on the page, so it can tell
  // whether focus was in it; the passive cleanup runs after the owner's control is back (its ref
  // set), so it can give focus to it.
  useLayoutEffect(() => () => {
    hadFocus.current = Boolean(box.current?.contains(document.activeElement));
  }, []);
  useEffect(() => () => {
    if (!hadFocus.current) return;
    const to = back.current?.current;
    if (to?.isConnected) to.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return;
    // prevented, so a sheet around the question does not take the Escape as its own close
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  };

  return (
    <div ref={box} className={`confirm${className ? ` ${className}` : ''}`} role="group"
         aria-labelledby={questionId} aria-describedby={detail ? detailId : undefined} onKeyDown={onKeyDown}>
      <div className="confirm-words">
        <p id={questionId} className="confirm-q">{question}</p>
        {detail && <p id={detailId} className="confirm-detail">{detail}</p>}
      </div>
      <div className="confirm-actions">
        {choices.map((c, i) => (
          <button key={c.label} ref={i === 0 ? first : undefined} type="button"
                  className={`btn btn-sm btn-${c.tone ?? (i === 0 ? 'primary' : 'secondary')}`}
                  onClick={c.onClick}>
            {c.label}
          </button>
        ))}
        <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>{cancelLabel}</button>
      </div>
    </div>
  );
}
