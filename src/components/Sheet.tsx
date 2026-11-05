// One modal surface for the console: a side panel on wide screens, a bottom sheet on phones. The
// meal plan's Move and Trip sheets and the cart's Options dialog all open in it.
//
// A native <dialog> opened with showModal() gives what is easy to get wrong by hand: the page
// behind turns inert (no Tab escapes, screen readers stay inside), and Escape closes it. The
// rest is done here: the open state follows the `open` prop, a click on the backdrop closes,
// the title labels the dialog, and on close focus goes back to the control that opened it.
import { useEffect, useId, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';

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
  // The latest values for the native close handler and the effect's cleanup, which outlive the
  // render that created them.
  const latest = useRef({ open, onClose, returnFocus });
  latest.current = { open, onClose, returnFocus };

  useEffect(() => {
    const d = dialog.current;
    if (!open || !d) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // under StrictMode the effect runs twice; a second showModal on an open dialog would throw
    if (!d.open) d.showModal();
    initialFocus?.current?.focus();
    return () => {
      if (d.open) d.close();
      const back = latest.current.returnFocus?.current ?? opener;
      if (back?.isConnected) back.focus();
    };
  }, [open, initialFocus]);

  // Escape and close() both end in the dialog's close event; tell the owner, unless it was the
  // owner that closed it (`open` already false). The event arrives a task later, so it can also
  // be a stale one from a close the dialog has since reopened after: StrictMode runs an effect,
  // its cleanup and the effect again on mount.
  const closed = () => {
    if (latest.current.open && !dialog.current?.open) latest.current.onClose();
  };

  // A press and release both on the <dialog> element itself, not its content, are on the
  // backdrop: the content fills the dialog, which has no padding. Checking the press too keeps
  // a text selection dragged out of the sheet from closing it.
  const pressedOutside = useRef(false);

  return (
    <dialog
      ref={dialog}
      className={className ? `sheet ${className}` : 'sheet'}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={closed}
      onPointerDown={(e) => { pressedOutside.current = e.target === e.currentTarget; }}
      onClick={(e) => {
        if (pressedOutside.current && e.target === e.currentTarget) dialog.current?.close();
        pressedOutside.current = false;
      }}
    >
      {open && (
        <>
          <div className="sheet-head">
            <div>
              <h2 id={titleId} className="sheet-title">{title}</h2>
              {description && <p id={descriptionId} className="sheet-desc">{description}</p>}
            </div>
            <button type="button" className="secondary mini" onClick={() => dialog.current?.close()}>
              Close
            </button>
          </div>
          <div className="sheet-body">{children}</div>
          {footer && <div className="sheet-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
