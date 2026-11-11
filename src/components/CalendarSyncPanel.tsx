// Google Calendar, on the wizard's Calendar stage: keep a "Pantry plan" calendar in the
// shopper's Google account in step with the approved plan, through the local demo hub. The
// times and reminders chosen on the stage go with every review and sync, so a change to them
// shows as an edit in the review and is written only as reviewed.
//
// One hook holds the sync (useGoogleSync), drawn in three places on the stage so its action sits
// beside the file's at the top: GoogleSyncButton in the actions row ("Connect Google Calendar",
// or once connected "Sync with Google Calendar", which reviews the changes first), GoogleSyncNote
// under it (what sync does, how it went, and why there is no button: the demo hub not answering,
// or no Google sign-in set up on it), and GoogleSyncPanel below (the reviewed changes, the button
// that writes exactly them, the results, Disconnect).
//
// Shown only when the hub answers /hub/calendar/status and has an OAuth client; with no hub (the
// HF Space, AKS) the note says the sync needs the demo hub, and the stage's download and links
// are all there is. Nothing is written until the shopper clicks the button under a reviewed diff,
// and the hub applies exactly that diff or refuses (preview_stale). Edits made in Google start on
// Keep; deletions made there are restored only when ticked.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { RefObject } from 'react';

import { exportRequest } from '../calendar';
import {
  RETURN_TO, applyLabel, applySummary, choicesFor, connectionText, defaultChoices, failedItems,
  groupOps, oauthNotice, oauthReturn, opDay, refusal, resultText, retryIsSame, syncErrorText,
  syncPlan, unchangedText, withoutOauthReturn,
} from '../calendarSync';
import type { SyncPlan } from '../calendarSync';
import {
  HubError, calendarConnect, calendarDisconnect, calendarSyncApply, calendarSyncPreview,
  calendarSyncStatus,
} from '../hub';
import { useHubStatus } from '../hubStatus';
import type {
  ApprovedSchedule, CalendarApplyResult, CalendarChoice, CalendarDiff, CalendarInclude, CalendarOp,
  CalendarOpResult, CalendarSyncStatus, CalendarTiming,
} from '../types';
import { Icon } from './icons';

type Busy = null | 'connect' | 'review' | 'apply' | 'disconnect';

// A failed call's message, or null when the status line already says it (the connection ended:
// the refreshed status shows Connect again with its own explanation).
const errorText = (err: unknown, fallback: string): string | null => {
  if (err instanceof HubError) {
    const r = refusal(err.detail, err.message || fallback);
    return r.code === 'needs_reconnect' ? null : syncErrorText(err.status, r.code, r.message);
  }
  return err instanceof Error ? err.message : fallback;
};

// Where the sync stands for the stage: the hub not answering (off), answering with no Google
// sign-in set up (unset), asked and not answered yet (checking), set up and not connected
// (connect), or connected.
export type SyncState = 'off' | 'unset' | 'checking' | 'connect' | 'connected';

export interface GoogleSync {
  state: SyncState;
  status: CalendarSyncStatus | null;
  ready: boolean;
  busy: Busy;
  notice: { text: string; ok: boolean } | null;
  error: string | null;
  diff: CalendarDiff | null;
  plan: SyncPlan | null;
  chosen: Record<string, CalendarChoice>;
  choose: (itemId: string, c: CalendarChoice) => void;
  result: CalendarApplyResult | null;
  confirming: boolean;
  setConfirming: (on: boolean) => void;
  deleteCalendar: boolean;
  setDeleteCalendar: (on: boolean) => void;
  diffHead: RefObject<HTMLHeadingElement>;
  // the line that says what was written, where focus goes once the button under the review is gone
  resultLine: RefObject<HTMLParagraphElement>;
  connect: () => Promise<void>;
  review: () => Promise<CalendarDiff | null>;
  apply: () => Promise<void>;
  retry: () => Promise<void>;
  disconnect: () => Promise<void>;
}

// onSynced: a write to Google with nothing failed, and how many events the calendar now holds
// for the plan (the stage marks its last step done: mealplan/exported.ts).
export function useGoogleSync({ open, schedule, include, timing, ready, onSynced }: {
  open: boolean;
  schedule: ApprovedSchedule | null;
  include: CalendarInclude[];
  timing?: CalendarTiming;
  // the stage's preview is current and exportable: only then can changes be reviewed
  ready: boolean;
  onSynced?: (diff: CalendarDiff) => void;
}): GoogleSync {
  const hub = useHubStatus();
  const [status, setStatus] = useState<CalendarSyncStatus | null>(null);
  const [asked, setAsked] = useState(false);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [diff, setDiff] = useState<CalendarDiff | null>(null);
  const [chosen, setChosen] = useState<Record<string, CalendarChoice>>({});
  const [result, setResult] = useState<CalendarApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleteCalendar, setDeleteCalendar] = useState(false);
  const diffHead = useRef<HTMLHeadingElement>(null);
  const resultLine = useRef<HTMLParagraphElement>(null);

  const refresh = useCallback(() => {
    calendarSyncStatus().then(setStatus).catch(() => setStatus(null)).finally(() => setAsked(true));
  }, []);

  // Status when the stage opens, whenever the window regains focus (a revoke elsewhere), and when
  // the hub comes back.
  useEffect(() => {
    if (!open) return undefined;
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [open, refresh, hub.ok]);

  // Back from Google's consent page: say how it went, once, and take it out of the address.
  useEffect(() => {
    if (!open) return;
    const ret = oauthReturn(window.location.hash);
    if (!ret) return;
    setNotice(oauthNotice(ret));
    window.history.replaceState(null, '', withoutOauthReturn(window.location.hash) || RETURN_TO);
  }, [open]);

  // A diff belongs to the plan, kinds and timing it was made for.
  useEffect(() => {
    setDiff(null);
    setResult(null);
    setError(null);
  }, [schedule, include, timing]);

  useEffect(() => {
    if (open) return;
    setConfirming(false);
    setDeleteCalendar(false);
    setNotice(null);
  }, [open]);

  const off = hub.state === 'refused' || hub.state === 'unreachable';
  const state: SyncState = off ? 'off' : status ? (!status.configured ? 'unset' : status.connected ? 'connected' : 'connect')
    : asked ? 'unset' : 'checking';

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const { auth_url } = await calendarConnect(RETURN_TO);
      window.location.assign(auth_url);             // Google, then back to the plan's Calendar
    } catch (err) {
      setError(errorText(err, 'Could not start the connection.'));
      setBusy(null);
      refresh();
    }
  };

  const review = async (): Promise<CalendarDiff | null> => {
    if (!schedule || !ready || busy !== null) return null;
    setBusy('review');
    setError(null);
    setResult(null);
    setDiff(null);                      // never leave an old diff, or its button, on screen
    try {
      const fresh = await calendarSyncPreview(exportRequest(schedule, include, timing));
      setDiff(fresh);
      setChosen((now) => ({ ...defaultChoices(fresh), ...pick(now, fresh) }));
      window.setTimeout(() => diffHead.current?.focus(), 0);
      return fresh;
    } catch (err) {
      setError(errorText(err, 'Could not review the changes.'));
      refresh();
      return null;
    } finally {
      setBusy(null);
    }
  };

  const applyDiff = async (d: CalendarDiff, choices: Record<string, CalendarChoice>) => {
    if (!schedule) return;
    setBusy('apply');
    setError(null);
    try {
      const r = await calendarSyncApply({ ...exportRequest(schedule, include, timing),
        preview_token: d.preview_token, choices: choicesFor(d, choices) });
      setResult(r);
      if (!failedItems(r).length) onSynced?.(d);
      window.setTimeout(() => resultLine.current?.focus(), 0);
      refresh();
    } catch (err) {
      setError(errorText(err, 'The sync failed.'));
      refresh();
    } finally {
      setBusy(null);
    }
  };

  // Retry failed: a fresh diff, applied at once only when it writes nothing but what failed.
  const retry = async () => {
    const failed = failedItems(result);
    const fresh = await review();
    if (fresh && retryIsSame(fresh, failed, chosen)) await applyDiff(fresh, chosen);
    else if (fresh) setNotice({ text: 'Things changed since: review them, then apply again.', ok: false });
  };

  const disconnect = async () => {
    setBusy('disconnect');
    setError(null);
    try {
      const r = await calendarDisconnect(deleteCalendar);
      setNotice({ ok: r.revoked, text: [
        r.calendar_deleted ? 'Disconnected, and the Pantry plan calendar was deleted.' : 'Disconnected.',
        r.note ?? '',
      ].filter(Boolean).join(' ') });
      setDiff(null);
      setResult(null);
      setConfirming(false);
    } catch (err) {
      setError(errorText(err, 'Could not disconnect.'));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  return {
    state, status, ready, busy, notice, error, diff, plan: diff ? syncPlan(diff, chosen) : null, chosen,
    choose: (itemId, c) => setChosen((now) => ({ ...now, [itemId]: c })), result, confirming, setConfirming,
    deleteCalendar, setDeleteCalendar, diffHead, resultLine, connect, review,
    apply: async () => { if (diff) await applyDiff(diff, chosen); }, retry, disconnect,
  };
}

// The sync's action, beside the file's: Connect, or once connected the review that every sync
// starts with. Nothing while the sync cannot be offered (the note says why). primary: the stage's
// main action (connected), else the second.
export function GoogleSyncButton({ sync, primary = false }: { sync: GoogleSync; primary?: boolean }) {
  const s = sync.status;
  if (sync.state === 'connect' && s) {
    return (
      <button type="button" className="btn btn-secondary" aria-disabled={sync.busy !== null || !s.can_connect_here || undefined}
              onClick={() => { if (sync.busy === null && s.can_connect_here) void sync.connect(); }}>
        <Icon name="calendar" size={18} />
        {sync.busy === 'connect' ? 'Opening Google…' : s.needs_reconnect ? 'Connect Google Calendar again' : 'Connect Google Calendar'}
      </button>
    );
  }
  if (sync.state !== 'connected') return null;
  return (
    <button type="button" className={`btn ${primary ? 'btn-primary' : 'btn-secondary'}`}
            aria-disabled={!sync.ready || sync.busy !== null || undefined} onClick={() => void sync.review()}>
      <Icon name="refresh" size={18} />
      {sync.busy === 'review' ? 'Reviewing the changes…' : sync.diff ? 'Review again' : 'Sync with Google Calendar'}
    </button>
  );
}

// Under the actions: what the sync does and how it went, or why it is not offered.
export function GoogleSyncNote({ sync }: { sync: GoogleSync }) {
  const s = sync.status;
  const said = (
    <>
      {sync.notice && <p className={sync.notice.ok ? 'cal-sync-ok' : 'cart-flag'} role="status">{sync.notice.text}</p>}
      {s?.problem && <p className="cart-flag" role="alert">{s.problem}</p>}
      {sync.error && <p className="cart-flag" role="alert">{sync.error}</p>}
    </>
  );
  if (sync.state === 'off') {
    return (
      <p className="cal-sync-line">
        <Icon name="plug" size={16} />
        <span>Google sync needs the demo hub, which is not answering now. The file and the links work without it.</span>
      </p>
    );
  }
  if (sync.state === 'unset') {
    return (
      <p className="cal-sync-line">
        <Icon name="info" size={16} />
        <span>Google sync is not set up on this demo hub. Google Calendar can import the file instead.</span>
      </p>
    );
  }
  if (sync.state === 'checking' || !s) return said;
  if (sync.state === 'connect') {
    return (
      <div className="cal-sync-note">
        {said}
        <p className="cal-sync-what">
          Sync puts these events in a calendar named Pantry plan that the demo hub creates in your
          Google account. It can see and change only calendars it created, and shows every change here
          before writing anything.
        </p>
        {s.needs_reconnect && (
          <p className="cart-flag" role="alert">
            Google ended the connection, as it does every 7 days while the app is in Testing. Connect
            again to keep syncing.
          </p>
        )}
        {!s.can_connect_here && (
          <p className="cart-flag">
            Connecting works from the console at <a href={s.connect_url}>{s.connect_url}</a>, the address
            registered with your Google OAuth client.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="cal-sync-note">
      {said}
      <p className="cal-sync-what">
        {connectionText(s)}. Sync shows every change here before anything is written.
        {!sync.ready && ' Changes can be reviewed once the events are ready.'}
      </p>
    </div>
  );
}

// The reviewed changes and what was written, and Disconnect: only once connected.
export function GoogleSyncPanel({ sync }: { sync: GoogleSync }) {
  const headId = useId();
  const s = sync.status;
  if (sync.state !== 'connected' || !s) return null;
  const { diff, plan, result, busy } = sync;
  const results = new Map((result?.results ?? []).map((r) => [r.item_id, r]));
  const failed = failedItems(result);
  return (
    <section className="cal-sync" aria-labelledby={headId} aria-busy={busy !== null}>
      <h3 id={headId} className="cal-head">Google Calendar</h3>
      {!diff && <p className="muted">Sync with Google Calendar shows the changes here first.</p>}
      {diff && plan && (
        <div className="cal-diff">
          <h4 ref={sync.diffHead} tabIndex={-1} className="cal-diff-head">
            Changes for {diff.calendar.summary}
          </h4>
          {unchangedText(diff) && <p className="muted">{unchangedText(diff)}</p>}
          {groupOps(diff).map((g) => (
            <section key={g.op} className={`cal-group cal-group-${g.op}`} aria-label={`${g.title}: ${g.ops.length}`}>
              <h5 className="cal-group-head">{g.title} <span className="muted">({g.ops.length})</span></h5>
              {g.hint && <p className="muted cal-group-hint">{g.hint}</p>}
              <ul className="cal-ops">
                {g.ops.map((op) => (
                  <OpRow key={op.item_id} op={op} choice={sync.chosen[op.item_id]} disabled={busy !== null || result !== null}
                         onChoose={(c) => sync.choose(op.item_id, c)} result={results.get(op.item_id)} />
                ))}
              </ul>
            </section>
          ))}
          {!result ? (
            <div className="cal-sync-actions">
              <button type="button" className="btn btn-primary" disabled={busy !== null || (plan.writes === 0 && plan.keep === 0)}
                      onClick={() => void sync.apply()}>
                {busy === 'apply' ? 'Writing to Google Calendar…' : applyLabel(diff, sync.chosen)}
              </button>
            </div>
          ) : (
            <div className="cal-sync-actions">
              <p ref={sync.resultLine} tabIndex={-1} className={`cal-sync-result ${failed.length ? 'cart-flag' : 'cal-sync-ok'}`}
                 role="status">{applySummary(result)}</p>
              {failed.length > 0 && (
                <button type="button" className="btn btn-secondary" disabled={busy !== null} onClick={() => void sync.retry()}>
                  Retry failed
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="cal-disconnect">
        {!sync.confirming ? (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={() => sync.setConfirming(true)}>
            Disconnect…
          </button>
        ) : (
          <div role="group" aria-label="Disconnect Google Calendar" className="cal-disconnect-confirm">
            <label className="check">
              <input type="checkbox" checked={sync.deleteCalendar} onChange={(e) => sync.setDeleteCalendar(e.target.checked)} />
              Also delete the Pantry plan calendar and its events from Google
            </label>
            <div className="cal-sync-actions">
              <button type="button" className={`btn btn-sm ${sync.deleteCalendar ? 'btn-danger' : 'btn-secondary'}`}
                      disabled={busy !== null} onClick={() => void sync.disconnect()}>
                {busy === 'disconnect' ? 'Disconnecting…' : sync.deleteCalendar ? 'Disconnect and delete the calendar' : 'Disconnect'}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => sync.setConfirming(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <p className="muted cal-sync-note-test">{s.testing_note}</p>
    </section>
  );
}

// The shopper's earlier choices for items still offering one.
function pick(now: Record<string, CalendarChoice>, d: CalendarDiff): Record<string, CalendarChoice> {
  const ids = new Set(d.ops.filter((o) => o.op === 'conflict' || o.op === 'deleted_in_google').map((o) => o.item_id));
  return Object.fromEntries(Object.entries(now).filter(([k]) => ids.has(k)));
}

function OpRow({ op, choice, disabled, onChoose, result }: {
  op: CalendarOp;
  choice: CalendarChoice | undefined;
  disabled: boolean;
  onChoose: (c: CalendarChoice) => void;
  result: CalendarOpResult | undefined;
}) {
  const name = `cal-choice-${op.item_id}`;
  return (
    <li className="cal-op">
      <div className="cal-op-head">
        <strong className="cal-title">{op.title}</strong>
        <span className="muted">{opDay(op)}</span>
        {result && (
          <span className={`chip ${result.ok ? 'chip-ok' : 'chip-warn'}`}>
            {resultText(result)}
          </span>
        )}
      </div>
      {op.op !== 'create' && op.op !== 'skip' && op.changes.length > 0 && (
        <div className="muted">
          {op.op === 'conflict' ? 'Differs from the plan in: ' : 'Changes: '}{op.changes.join(', ')}
        </div>
      )}
      {op.note && op.op !== 'conflict' && op.op !== 'deleted_in_google' && <div className="muted">{op.note}</div>}
      {op.op === 'conflict' && (
        <fieldset className="cal-choice" disabled={disabled}>
          <legend className="sr-only">{op.title} on {opDay(op)}: keep your edit or use the plan</legend>
          <label className="check">
            <input type="radio" name={name} checked={choice !== 'overwrite'} onChange={() => onChoose('keep')} />
            {op.origin === 'delete' ? 'Keep it in Google' : 'Keep my edit'}
          </label>
          <label className="check">
            <input type="radio" name={name} checked={choice === 'overwrite'} onChange={() => onChoose('overwrite')} />
            {op.origin === 'delete' ? 'Remove it' : 'Overwrite with the plan'}
          </label>
        </fieldset>
      )}
      {op.op === 'deleted_in_google' && (
        <label className="check cal-choice">
          <input type="checkbox" disabled={disabled} checked={choice === 'restore'}
                 onChange={(e) => onChoose(e.target.checked ? 'restore' : 'keep')} />
          Restore it
        </label>
      )}
    </li>
  );
}
