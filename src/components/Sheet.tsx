// One modal surface for the console: a side panel on wide screens, a bottom sheet on phones. The
// meal plan's Move and Trip sheets and the cart's Options dialog all open in it.
//
// A native <dialog> opened with showModal() gives what is easy to get wrong by hand: the page
// behind turns inert (no Tab escapes, screen readers stay inside), and Escape closes it. The
// rest is done here: the open state follows the `open` prop, a click on the backdrop closes,
// the title labels the dialog, and on close focus goes back to the control that opened it.
//
// It slides in from its edge and out again (the motion is in index.css, timed by the duration
// tokens). Leaving takes --dur-exit: for that long the sheet stays open, marked data-closing and
// showing what it showed last, even if its owner has already moved on, and then the dialog
// closes and focus goes back. Escape, the backdrop and the close button all ask the owner to
// close (onClose), so every way out leaves the same way. Under reduced motion the duration is
// zero and it simply goes.
import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { Icon } from './icons';

// A duration token's value in milliseconds ("160ms", "0.16s", or "0ms" under reduced motion).
function msOf(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.trim().endsWith('ms') ? n : n * 1000;
}

export function Sheet({ open, onClose, title, description, footer, initialFocus, returnFocus,
  className, children }: {
  open: boolean;
  // Called however the sheet is closed (Close, Escape, the backdrop); it must set `open` false.
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  // Actions, kept in view under the scrolling body.
  footer?: ReactNode;
  // Focused on open instead of the first control (the Close button).
  initialFocus?: RefObject<HTMLElement | null>;
  // Focused on close instead of the element that had focus at open: for an opener that may be
  // re-rendered away meanwhile, such as a cart line after a swap replaced its card.
  returnFocus?: RefObject<HTMLElement | null>;
  // Added to "sheet", for a sheet that needs another width (the cart's Options are wider).
  className?: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  // The latest values for the native close handler and the effects' cleanups, which outlive the
  // render that created them.
  const latest = useRef({ open, onClose, returnFocus });
  latest.current = { open, onClose, returnFocus };
  const opener = useRef<HTMLElement | null>(null);

  // Leaving: `open` has just turned false and the sheet is still on screen, on its way out. Set
  // while rendering, so the render that closes it already keeps the content in place.
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setLeaving(!open);
  }
  // What the sheet shows as it leaves: its content as last drawn open, since the owner may have
  // let go of the thing it was about.
  const shown = useRef({ title, description, footer, children });
  if (open) shown.current = { title, description, footer, children };
  const view = shown.current;

  // Closed for good: the dialog shut, the mark off, focus back where it was.
  const finish = (d: HTMLDialogElement) => {
    if (d.open) d.close();
    delete d.dataset.closing;
    setLeaving(false);
    const back = latest.current.returnFocus?.current ?? opener.current;
    if (back?.isConnected) back.focus();
  };

  useEffect(() => {
    const d = dialog.current;
    if (!open || !d) return;
    // Reopened while leaving, it is still open: it simply stays.
    if (!d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
    }
    initialFocus?.current?.focus();
    return () => {
      // `open` turned false: the exit below lets it leave in view first. Unmounted (or StrictMode
      // rehearsing an unmount), it closes now.
      if (!latest.current.open) return;
      if (d.open) d.close();
      const back = latest.current.returnFocus?.current ?? opener.current;
      if (back?.isConnected) back.focus();
    };
  }, [open, initialFocus]);

  useEffect(() => {
    const d = dialog.current;
    if (!leaving || !d) return;
    let done = false;
    const end = () => { done = true; finish(d); };
    // already shut by the browser itself (a second Escape can close a dialog outright)
    if (!d.open) { end(); return; }
    d.dataset.closing = '';
    const timer = window.setTimeout(end, msOf(getComputedStyle(d).getPropertyValue('--dur-exit')));
    return () => {
      window.clearTimeout(timer);
      if (done) return;
      // reopened on the way out: it stays; unmounted on the way out: it goes now
      if (latest.current.open) delete d.dataset.closing;
      else finish(d);
    };
    // finish reads only refs and a state setter, so `leaving` is all this depends on
  }, [leaving]);

  // Escape and close() both end in the dialog's close event; tell the owner, unless it was the
  // owner that closed it (`open` already false). The event arrives a task later, so it can also
  // be a stale one from a close the dialog has since reopened after: StrictMode runs an effect,
  // its cleanup and the effect again on mount.
  const closed = () => {
    if (latest.current.open && !dialog.current?.open) latest.current.onClose();
  };
  // Every way out asks the owner, so the sheet leaves the same way whichever was used.
  const dismiss = () => { if (latest.current.open) latest.current.onClose(); };

  // A press and release both on the <dialog> element itself, not its content, are on the
  // backdrop: the content fills the dialog, which has no padding. Checking the press too keeps
  // a text selection dragged out of the sheet from closing it.
  const pressedOutside = useRef(false);

  return (
    <dialog
      ref={dialog}
      className={className ? `sheet ${className}` : 'sheet'}
      aria-labelledby={titleId}
      aria-describedby={view.description ? descriptionId : undefined}
      onClose={closed}
      onCancel={(e) => { e.preventDefault(); dismiss(); }}
      onPointerDown={(e) => { pressedOutside.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressedOutside.current && e.target === e.currentTarget) dismiss();
        pressedOutside.current = false;
      }}
    >
      {(open || leaving) && (
        <>
          <div className="sheet-head">
            <div>
              <h2 id={titleId} className="sheet-title">{view.title}</h2>
              {view.description && <p id={descriptionId} className="sheet-desc">{view.description}</p>}
            </div>
            <button type="button" className="btn btn-ghost btn-icon sheet-close" aria-label="Close" title="Close"
                    onClick={dismiss}>
              <Icon name="x" />
            </button>
          </div>
          <div className="sheet-body">{view.children}</div>
          {view.footer && <div className="sheet-foot">{view.footer}</div>}
        </>
      )}
    </dialog>
  );
}
