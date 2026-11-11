// One modal surface for the console: a side panel on wide screens, a bottom sheet on phones. The
// meal plan's Move and Trip sheets and the cart's Options dialog all open in it.
//
// A native <dialog> opened with showModal() gives what is easy to get wrong by hand: the page
// behind turns inert (no Tab escapes, screen readers stay inside), and Escape closes it. The
// rest is done here: the open state follows the `open` prop, a click on the backdrop closes,
// the title labels the dialog, and on close focus goes back to the control that opened it.
//
// It slides in from its edge and out again (the motion is in index.css, timed by the duration
// tokens). Escape, the backdrop and the close button all ask the owner to close (onClose), so
// every way out leaves the same way. The moment it starts to leave, the dialog closes: the page
// behind is live again and focus goes back straight away. So wherever the owner sends focus as it
// closes the sheet (Quick add, after the first-run sheet's "Try the example") is where focus
// lands; a modal still on its way out would have left the page inert, and that focus() would
// have done nothing. What slides out over --dur-exit is a picture of the sheet: the closed
// dialog kept on screen, inert, marked data-closing and showing what it showed last (its owner
// may have let go of what it was about), over a scrim that fades as the backdrop did. Under
// reduced motion the duration is zero and it simply goes.
//
// A sheet can open from inside another (a trip line's Options inside its trip). The browser
// sends Escape to the one on top only, but React hands a nested dialog's cancel and close events
// to the outer dialog's handlers as well, so each handler acts on its own dialog's events only.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject, SyntheticEvent } from 'react';
import { Icon } from './icons';

// A duration token's value in milliseconds ("160ms", "0.16s", or "0ms" under reduced motion).
function msOf(value: string): number {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return 0;
  return value.trim().endsWith('ms') ? n : n * 1000;
}

// An event the dialog itself fired, not one React passed up from a sheet opened inside it.
const ownEvent = (e: SyntheticEvent<HTMLDialogElement>) => e.target === e.currentTarget;

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

  // Focus back where it was before the sheet opened, or where the owner asked.
  const giveBackFocus = () => {
    const back = latest.current.returnFocus?.current ?? opener.current;
    if (back?.isConnected) back.focus();
  };

  useEffect(() => {
    const d = dialog.current;
    if (!open || !d) return;
    // Reopened on its way out, the picture of it becomes the sheet again.
    if (!d.open) {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      d.showModal();
    }
    initialFocus?.current?.focus();
    return () => {
      // `open` turned false: the exit below closes it. Unmounted (or StrictMode rehearsing an
      // unmount), it closes now.
      if (!latest.current.open) return;
      if (d.open) d.close();
      giveBackFocus();
    };
    // giveBackFocus reads only refs
  }, [open, initialFocus]);

  // The exit, before anything else on the page runs its effects for the same change, so that
  // whatever moves focus next finds the page live: the dialog closes and focus goes back now,
  // and the closed dialog stays in view, inert, while it slides out.
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!leaving || !d) return undefined;
    // already shut by the browser itself (a second Escape can close a dialog outright): nothing
    // is left on screen to slide out
    if (!d.open) {
      giveBackFocus();
      setLeaving(false);
      return undefined;
    }
    d.close();
    d.inert = true;
    d.dataset.closing = '';
    giveBackFocus();
    const timer = window.setTimeout(() => setLeaving(false),
      msOf(getComputedStyle(d).getPropertyValue('--dur-exit')));
    return () => {
      window.clearTimeout(timer);
      // gone, reopened on the way out, or unmounted: the picture goes either way
      d.inert = false;
      delete d.dataset.closing;
    };
    // giveBackFocus reads only refs, so `leaving` is all this depends on
  }, [leaving]);

  // Escape and the browser's own close both end in the dialog's close event; tell the owner,
  // unless it was the owner that closed it (`open` already false). The event arrives a task
  // later, so it can also be a stale one from a close the dialog has since reopened after:
  // StrictMode runs an effect, its cleanup and the effect again on mount.
  const closed = (e: SyntheticEvent<HTMLDialogElement>) => {
    if (!ownEvent(e)) return;
    if (latest.current.open && !dialog.current?.open) latest.current.onClose();
  };
  // Every way out asks the owner, so the sheet leaves the same way whichever was used.
  const dismiss = () => { if (latest.current.open) latest.current.onClose(); };

  // A press and release both on the <dialog> element itself, not its content, are on the
  // backdrop: the content fills the dialog, which has no padding. Checking the press too keeps
  // a text selection dragged out of the sheet from closing it.
  const pressedOutside = useRef(false);

  return (
    <>
      {leaving && <div className="sheet-scrim" aria-hidden="true" />}
      <dialog
        ref={dialog}
        className={className ? `sheet ${className}` : 'sheet'}
        aria-labelledby={titleId}
        aria-describedby={view.description ? descriptionId : undefined}
        onClose={closed}
        onCancel={(e) => {
          if (!ownEvent(e)) return;
          e.preventDefault();
          dismiss();
        }}
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
    </>
  );
}
