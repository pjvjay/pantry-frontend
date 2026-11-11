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
//                 itself is down, the page's OfflinePanel already says so once.
//   EmptyState    what is not here yet: an icon, one sentence of where things stand, one cue for
//                 what to do, one action.
//   Skeleton      placeholders shaped like what is loading, only once it has taken 300 ms.
//   Tag           a state in a glyph and words (done, in progress, next, cannot start yet, needs
//                 attention, paused, changed): never colour alone.
//   Toasts        a short confirmation in one polite live region above the bottom bar, with at
//                 most one action (Undo); it goes after about 6 s unless hovered or focused.
//                 useToast().show({ text, action }) from anywhere under ToastProvider.
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';

import { useHubStatus } from '../hubStatus';
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
    <div className={`notice notice-${tone}${className ? ` ${className}` : ''}`}
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

export function HubErrorBanner({ error, hint }: { error: string; hint?: ReactNode }) {
  const hub = useHubStatus();
  if (!error || !hub.ok) return null;
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
        <p className="offline-checked" role="status">
          {stillOff && !hub.checking && hub.checkedAt ? `Checked again at ${clockTime(hub.checkedAt)}: still not answering.` : ''}
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
// reader. The shimmer stops under reduced motion (styles/ui.css).
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
  if (!shown) return null;
  return (
    <div className={`skel-group skel-group-${kind}`} role="status">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: count }, (_, i) => <span key={i} className={`skel skel-${kind}`} aria-hidden="true" />)}
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
