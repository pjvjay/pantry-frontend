// The message box, stuck above the bottom bar: the one thing on the Ask page that is always in
// reach. It grows with what is typed (up to two fifths of the screen, then it scrolls), says how
// Enter works, and holds Import a recipe and Send. While the assistant answers, Send becomes Stop
// in the same place, the same button, so focus never falls off it; the box stays typeable, and
// what is typed waits there until the answer is done. On a phone its example is shorter, so it
// fits the box's one line instead of wrapping it two lines tall before anything is typed.
import { useId, useLayoutEffect } from 'react';
import type { FormEvent, KeyboardEvent, MouseEvent, RefObject } from 'react';

import { Icon } from '../icons';
import { useMedia } from '../useMedia';

export function Composer({
  value, onChange, onSend, onStop, onImport, busy, canSend, offline, boxRef, formRef,
}: {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onStop: () => void;
  onImport: () => void;
  busy: boolean;
  // there is something to send and nothing in the way (a swap being priced, the hub not ready)
  canSend: boolean;
  // the demo hub is refusing or not there: the box says Ask is off
  offline: boolean;
  boxRef: RefObject<HTMLTextAreaElement>;
  formRef: (el: HTMLFormElement | null) => void;
}) {
  const boxId = useId();
  const hintId = useId();
  const narrow = useMedia('(max-width: 640px)');

  // Grow to fit what is typed: measured from nothing each time, so it shrinks again too.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const max = Math.round(window.innerHeight * 0.4);
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden';
  }, [value, boxRef]);

  // Enter sends; Shift+Enter is a new line; Enter that finishes a composed character (an input
  // method's) is that, not a send.
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!busy && canSend) onSend();
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy && canSend) onSend();
  };
  const onButton = (e: MouseEvent<HTMLButtonElement>) => {
    if (!busy) return;            // Send: the form's submit does it
    e.preventDefault();
    onStop();
  };

  const hint = offline ? 'Ask is off while the demo hub is not answering.'
    : busy ? 'Answering… What you type waits here.'
      : 'Enter to send · Shift+Enter for a new line';

  return (
    <form ref={formRef} className="ask-composer" onSubmit={onSubmit}>
      <div className="ask-box">
        <label htmlFor={boxId} className="sr-only">Message</label>
        <textarea id={boxId} ref={boxRef} rows={1} value={value} aria-describedby={hintId}
                  placeholder={narrow ? 'Ask about a recipe or a product…'
                    : 'Ask about a recipe link, a product, a week of dinners…'}
                  onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} />
        <div className="ask-box-foot">
          <button type="button" className="btn btn-ghost btn-sm ask-import" onClick={onImport}>
            <Icon name="link" size={16} /><span className="ask-narrow-hide">Import a recipe</span>
          </button>
          <p id={hintId} className="ask-hint">{hint}</p>
          <button type="submit" className={`btn ask-send ${busy ? 'btn-secondary' : 'btn-primary'}`}
                  aria-disabled={!busy && !canSend ? true : undefined} onClick={onButton}>
            <Icon name={busy ? 'stop' : 'send'} size={16} />{busy ? 'Stop' : 'Send'}
          </button>
        </div>
      </div>
    </form>
  );
}
