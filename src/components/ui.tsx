// The console's shared pieces, so the same kind of thing looks and reads the same on every page.
// Their styles are in styles/ui.css.
//
//   Notice        something the shopper should know, in one of four tones (danger, warn, info,
//                 success): an icon, a title and words, a hint, up to two actions. Danger is an
//                 alert; the others are polite. ErrorBanner, which the views used for every error
//                 before, is a danger Notice now.
//   OfflinePanel  the one thing a page shows where what it needs is the demo hub and the hub is
//                 refusing or not there: what is off, what still works, Retry and Open System. It
//                 draws nothing while the hub answers (or has not been asked yet).
//   HubErrorBanner  a failed hub call's error, shown only while the hub answers: when the hub
//                 itself is down, the page's OfflinePanel already says so once, and an error the
//                 hub has been down over since is old news when it comes back.
//   EmptyState    what is not here yet: an icon, one sentence of where things stand, one cue for
//                 what to do, one action.
//   Skeleton      placeholders shaped like what is loading, only once it has taken 300 ms.
//   Tag           a state in a glyph and words (done, in progress, next, cannot start yet, needs
//                 attention, paused, changed): never colour alone.
//   Toasts        a short confirmation in one polite live region above the bottom bar, with at
//                 most one action (Undo); it goes after about 6 s unless hovered or focused.
//                 useToast().show({ text, action }) from anywhere under ToastProvider.
//   Spinner       a small turning ring beside the words of something under way ("Building your
//                 week… 0:04"); the words say it, the ring is decoration, and it holds still under
//                 reduced motion.
//   StatTile      one figure with its name over it ("BUDGET  $90.00") and a note under it, in a
//   StatRow       StatRow of them; a tone colours the figure and puts a sign beside it.
//   ScrollRegion  a box that scrolls inside itself (a wide table, a long sheet): a stop for the
//                 keyboard, named, only while its content overflows.
//
// Beside them, the primitives that are classes only, with no component of their own:
//   styles/card.css   .card, the one surface, with .card-row, .card-pic, .card-head, .card-title,
//                     .card-sub, .card-interactive and its stretched .card-link
//   styles/table.css  .table, .num for a cell of figures, .table-sticky for a head that stays,
//                     and .table-scroll for ScrollRegion's box
//   index.css         .chip (a choice, a filter or a plain fact; a state is a Tag) and the fields'
//                     own look, set on input, select and textarea themselves
//   styles/ui.css     .vt-stage, what a view transition fades (components/viewTransition.ts)
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FocusEvent, HTMLAttributes, ReactNode } from 'react';

import { useHubStatus } from '../hubStatus';
import { STAT_TONES, overflows, scrollRegionProps } from '../primitives';
import type { StatTone } from '../primitives';
import { hrefFor } from '../routes';
import { Icon } from './icons';
import type { IconName } from './icons';

// ─── Notice ──────────────────────────────────────────────────

export type NoticeTone = 'danger' | 'warn' | 'info' | 'success';

export interface NoticeAction {
  label: string;
  onClick?: () => void;
  href?: string;
  icon?: IconName;
}

const TONE_ICON: Record<NoticeTone, IconName> = {
  danger: 'circle-x', warn: 'alert', info: 'info', success: 'circle-check',
};
// Said before the words for a screen reader, which does not see the icon.
const TONE_WORD: Record<NoticeTone, string> = {
  danger: 'Problem', warn: 'Warning', info: 'Note', success: 'Done',
};
// Each tone's class written out whole, so a search for it finds where it is drawn.
const TONE_CLASS: Record<NoticeTone, string> = {
  danger: 'notice-danger', warn: 'notice-warn', info: 'notice-info', success: 'notice-success',
};

function ActionButton({ action, primary }: { action: NoticeAction; primary: boolean }) {
  const cls = `btn btn-sm ${primary ? 'btn-secondary' : 'btn-ghost'}`;
  const body = <>{action.icon && <Icon name={action.icon} size={16} />}{action.label}</>;
  return action.href
    ? <a className={cls} href={action.href} onClick={action.onClick}>{body}</a>
    : <button type="button" className={cls} onClick={action.onClick}>{body}</button>;
}

export function Notice({ tone = 'info', title, children, hint, actions = [], icon, className }: {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  hint?: ReactNode;
  // the first is the way on; a second is quieter. More than two are not drawn.
  actions?: NoticeAction[];
  icon?: IconName;
  className?: string;
}) {
  return (
    <div className={`notice ${TONE_CLASS[tone]}${className ? ` ${className}` : ''}`}
         role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="notice-icon">
        <Icon name={icon ?? TONE_ICON[tone]} />
        <span className="sr-only">{TONE_WORD[tone]}: </span>
      </span>
      <div className="notice-body">
        {title && <p className="notice-title">{title}</p>}
        {children && <div className="notice-text">{children}</div>}
        {hint && <p className="notice-hint">{hint}</p>}
        {actions.length > 0 && (
          <div className="notice-actions">
            {actions.slice(0, 2).map((a, i) => <ActionButton key={a.label} action={a} primary={i === 0} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// An error in a view, as it always was: the message, and a hint at the fix. Nothing when there is
// no error, so a view can always draw it.
export function ErrorBanner({ error, hint }: { error: string; hint?: ReactNode }) {
  if (!error) return null;
  return <Notice tone="danger" hint={hint}>{error}</Notice>;
}

// ─── The demo hub, when it is not there ──────────────────────

// An error that was on the page while the hub was down (the outage's own "The demo hub is not
// running", or anything from before it) is over once the hub answers again, so it stays hidden
// from then on, until the page has a new error to show. The Workshop's pages are drawn afresh when
// the hub returns, which drops their errors the same way; a page that stays mounted (the
// Assistant) relies on this, or the outage's error would come back beside the header's "Ready".
export function HubErrorBanner({ error, hint }: { error: string; hint?: ReactNode }) {
  const hub = useHubStatus();
  const down = hub.state === 'refused' || hub.state === 'unreachable';
  const [outlived, setOutlived] = useState('');
  useEffect(() => {
    if (!error) setOutlived('');
    else if (down) setOutlived(error);
  }, [error, down]);
  if (!error || !hub.ok || error === outlived) return null;
  return <ErrorBanner error={error} hint={hint} />;
}

const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// `off`: what this page cannot do without the hub, as a sentence. `works`: what still does.
// `systemLink`: offer Workshop › System (not on that page itself).
export function OfflinePanel({ off, works, systemLink = true, className }: {
  off: ReactNode;
  works?: ReactNode;
  systemLink?: boolean;
  className?: string;
}) {
  const hub = useHubStatus();
  const toast = useToast();
  const titleId = useId();
  // a Retry that found the hub still not answering, so the panel says it looked again
  const [stillOff, setStillOff] = useState(false);
  if (hub.state === 'ok' || hub.state === 'connecting') return null;

  const retry = async () => {
    if (hub.checking) return;
    const state = await hub.refresh();
    if (state === 'ok') {
      // the panel, and the button just pressed, are gone: say so, and start the keyboard at the page
      toast.show({ text: 'The demo hub is answering again.' });
      document.getElementById('main')?.focus({ preventScroll: true });
    } else {
      setStillOff(true);
    }
  };

  return (
    <section className={`offline${className ? ` ${className}` : ''}`} aria-labelledby={titleId}>
      <span className="offline-icon" aria-hidden="true"><Icon name="plug" size={22} /></span>
      <div className="offline-body">
        <h2 id={titleId} className="offline-title">{hub.message}</h2>
        <p className="offline-off">{off}</p>
        {works && <p className="offline-works"><strong>Still working:</strong> {works}</p>}
        <div className="offline-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void retry()}
                  aria-disabled={hub.checking || undefined}>
            <Icon name="refresh" size={16} />{hub.checking ? 'Checking…' : 'Retry'}
          </button>
          {systemLink && (
            <a className="btn btn-ghost btn-sm" href={hrefFor({ name: 'workshop', tab: 'system' })}>Open System</a>
          )}
        </div>
        {/* A live region is heard when its words change, so it is on the page from the start,
            empty, and keeps its last words while the next check runs: each Retry that finds the
            hub still off changes them (a new time), and a screen reader says so. */}
        <p className="offline-checked" role="status">
          {stillOff && hub.checkedAt ? `Checked again at ${clockTime(hub.checkedAt)}: still not answering.` : ''}
        </p>
        {hub.reason && (
          <details className="offline-details">
            <summary>Details</summary>
            <p>{hub.reason}</p>
          </details>
        )}
      </div>
    </section>
  );
}

// ─── EmptyState ──────────────────────────────────────────────

export interface EmptyAction {
  label: string;
  href?: string;
  onClick?: () => void;
  // primary unless the page has a stronger way on elsewhere
  variant?: 'primary' | 'secondary';
}

export function EmptyState({ icon, heading, status, cue, action, className }: {
  icon: IconName;
  heading?: string;
  status: ReactNode;
  cue?: ReactNode;
  action?: EmptyAction;
  className?: string;
}) {
  const cls = `btn btn-${action?.variant ?? 'primary'}`;
  return (
    <div className={`empty${className ? ` ${className}` : ''}`}>
      <span className="empty-icon" aria-hidden="true"><Icon name={icon} size={24} /></span>
      {heading && <h3 className="empty-heading">{heading}</h3>}
      <p className="empty-status">{status}</p>
      {cue && <p className="empty-cue">{cue}</p>}
      {action && (action.href
        ? <a className={cls} href={action.href} onClick={action.onClick}>{action.label}</a>
        : <button type="button" className={cls} onClick={action.onClick}>{action.label}</button>)}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────

// A load that answers within 300 ms shows nothing at all, rather than a flash of grey; a slower
// one shows rows or cards in the shape of what is coming, and says what is loading to a screen
// reader. The live region is there from the start, empty, and the words arrive in it at 300 ms: a
// region that appears already holding its words is not reliably read out. The shimmer stops under
// reduced motion (styles/ui.css).
export function Skeleton({ kind = 'row', count = 3, label }: {
  kind?: 'row' | 'card';
  count?: number;
  label: string;
}) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = window.setTimeout(() => setShown(true), 300);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className={shown ? `skel-group skel-group-${kind}` : undefined} role="status">
      {shown && (
        <>
          <span className="sr-only">{label}…</span>
          {Array.from({ length: count }, (_, i) => <span key={i} className={`skel skel-${kind}`} aria-hidden="true" />)}
        </>
      )}
    </div>
  );
}

// ─── Tag ─────────────────────────────────────────────────────

export type TagKind = 'done' | 'progress' | 'next' | 'blocked' | 'attention' | 'paused' | 'changed';

export const TAG_WORDS: Record<TagKind, { word: string; icon: IconName }> = {
  done: { word: 'Done', icon: 'check' },
  progress: { word: 'In progress', icon: 'circle-dashed' },
  next: { word: 'Next', icon: 'arrow-right' },
  blocked: { word: 'Cannot start yet', icon: 'ban' },
  attention: { word: 'Needs attention', icon: 'alert' },
  paused: { word: 'Paused', icon: 'pause' },
  changed: { word: 'Changed', icon: 'refresh' },
};

// The words are the kind's own unless the caller has better ones ("2 to answer").
export function Tag({ kind, children }: { kind: TagKind; children?: ReactNode }) {
  return (
    <span className={`tag tag-${kind}`}>
      <Icon name={TAG_WORDS[kind].icon} size={14} strokeWidth={2.2} />
      {children ?? TAG_WORDS[kind].word}
    </span>
  );
}

// ─── Toasts ──────────────────────────────────────────────────

export interface ToastInput {
  text: string;
  // one action at most, such as Undo; pressing it also dismisses the toast
  action?: { label: string; onClick: () => void };
}

interface ToastItem extends ToastInput { id: number }

export interface ToastApi {
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast needs a <ToastProvider> above it');
  return api;
}

const TOAST_MS = 6000;
const MAX_TOASTS = 3;

// The region is always on the page, empty until a toast arrives, so a screen reader is already
// listening to it: it reads each toast once, politely. A page that also announces the same
// change in its own live region (the meal plan does) should not toast it as well.
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((ts) => [...ts, { ...toast, id }].slice(-MAX_TOASTS));
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => <Toast key={t.id} toast={t} dismiss={dismiss} />)}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ toast, dismiss }: { toast: ToastItem; dismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const held = hovered || focused;

  // It waits while the pointer is on it or focus is in it, and gets its whole time again after.
  useEffect(() => {
    if (held) return undefined;
    const id = window.setTimeout(() => dismiss(toast.id), TOAST_MS);
    return () => window.clearTimeout(id);
  }, [held, dismiss, toast.id]);

  // Gone by a press of its own: the keyboard carries on from the page, not from nowhere.
  const leave = () => {
    const hadFocus = box.current?.contains(document.activeElement) ?? false;
    dismiss(toast.id);
    if (hadFocus) document.getElementById('main')?.focus({ preventScroll: true });
  };
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
  };

  return (
    <div ref={box} className="toast" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
         onFocus={() => setFocused(true)} onBlur={onBlur}>
      <p className="toast-text">{toast.text}</p>
      {toast.action && (
        <button type="button" className="btn btn-ghost btn-sm toast-action"
                onClick={() => { toast.action?.onClick(); leave(); }}>
          {toast.action.label}
        </button>
      )}
      <button type="button" className="btn btn-ghost btn-sm btn-icon toast-close" aria-label="Dismiss" onClick={leave}>
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}

// ─── Spinner ─────────────────────────────────────────────────

// Beside words that say what is under way, never instead of them.
export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden="true" />;
}

// ─── StatTile and StatRow ────────────────────────────────────

export type { StatTone } from '../primitives';

// A figure the shopper reads at a glance: its name in the label role, the figure in the title
// role in equal-width digits, and an optional note under it ("of $90.00", "2 not placed"). A tone
// other than 'default' colours the figure and puts its sign beside it; say what it means in the
// note as well ("$12.40 over"), since a screen reader hears no colour. Tiles go in a StatRow,
// which is the description list their names and figures belong to.
export function StatTile({ label, value, note, tone = 'default' }: {
  label: ReactNode;
  value: ReactNode;
  note?: ReactNode;
  tone?: StatTone;
}) {
  const { className, icon } = STAT_TONES[tone];
  return (
    <div className={className}>
      <dt className="stat-tile-label">{label}</dt>
      <dd className="stat-tile-value">{icon && <Icon name={icon} size={16} strokeWidth={2.2} />}{value}</dd>
      {note && <dd className="stat-tile-note">{note}</dd>}
    </div>
  );
}

// A row of tiles, as many to a line as fit (about 130px each), wrapping on a phone. `plain` draws
// them without their boxes, for a bar that is already a box (the meal plan's budget strip). (Its
// class is .stat-tiles: .stat-row is still Provenance's older row of .stat boxes.)
export function StatRow({ children, plain = false, className }: {
  children: ReactNode;
  plain?: boolean;
  className?: string;
}) {
  return <dl className={['stat-tiles', plain && 'stat-tiles-plain', className].filter(Boolean).join(' ')}>{children}</dl>;
}

// ─── ScrollRegion ────────────────────────────────────────────

// A box that scrolls inside itself (a table wider than a phone, a sheet's long body). While its
// content overflows it is a stop for the keyboard (Tab reaches it, the arrow keys scroll it) and a
// region named by `label` or by `labelledBy` (the id of a heading that says it), so a screen
// reader says what the stop is; while everything fits it is a plain box, with no Tab stop that
// leads nowhere. It measures itself and its children whenever either changes size (a phone turned,
// rows arriving), so it follows its content without being told. Its overflow is the caller's
// class's to set (styles/table.css has .table-scroll); it adds .scroll-region for the focus ring.
export function ScrollRegion({ label, labelledBy, className, children, ...rest }: {
  label?: string;
  labelledBy?: string;
  className?: string;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'tabIndex' | 'aria-label' | 'aria-labelledby' | 'children'>) {
  const box = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setOver(overflows(el));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    // the box itself, and each thing directly in it (a table that grows a row grows itself)
    const sizes = new ResizeObserver(measure);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(el);
      for (const child of Array.from(el.children)) sizes.observe(child);
    };
    watch();
    const kids = new MutationObserver(() => { watch(); measure(); });
    kids.observe(el, { childList: true });
    return () => { sizes.disconnect(); kids.disconnect(); };
  }, []);
  return (
    <div ref={box} className={className ? `scroll-region ${className}` : 'scroll-region'} {...rest}
         {...scrollRegionProps(over, { label, labelledBy })}>
      {children}
    </div>
  );
}
