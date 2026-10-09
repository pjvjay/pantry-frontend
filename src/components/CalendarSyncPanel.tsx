// Google Calendar, inside the Add to calendar dialog: keep a "Pantry plan" calendar in the
// shopper's Google account in step with the approved plan, through the local demo hub.
//
// Shown only when the hub answers /hub/calendar/status and has an OAuth client; with no hub (the
// HF Space, AKS) or no client it renders nothing, and the dialog's download and links are all
// there is. Nothing is written until the shopper clicks the button under a reviewed diff, and
// the hub applies exactly that diff or refuses (preview_stale). Edits made in Google start on
// Keep; deletions made there are restored only when ticked.
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { exportRequest } from '../calendar';
import {
  RETURN_TO, applyLabel, applySummary, choicesFor, connectionText, defaultChoices, failedItems,
  groupOps, oauthNotice, oauthReturn, opDay, refusal, resultText, retryIsSame, syncErrorText,
  syncPlan, unchangedText, withoutOauthReturn,
} from '../calendarSync';
import {
  HubError, calendarConnect, calendarDisconnect, calendarSyncApply, calendarSyncPreview,
  calendarSyncStatus,
} from '../hub';
import type {
  ApprovedSchedule, CalendarApplyResult, CalendarChoice, CalendarDiff, CalendarInclude, CalendarOp,
  CalendarOpResult, CalendarSyncStatus,
} from '../types';

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

export function CalendarSyncPanel({ open, schedule, include, ready }: {
  open: boolean;
  schedule: ApprovedSchedule | null;
  include: CalendarInclude[];
  // the dialog's preview is current and exportable: only then can changes be reviewed
  ready: boolean;
}) {
  const [status, setStatus] = useState<CalendarSyncStatus | null>(null);
  const [notice, setNotice] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [diff, setDiff] = useState<CalendarDiff | null>(null);
  const [chosen, setChosen] = useState<Record<string, CalendarChoice>>({});
  const [result, setResult] = useState<CalendarApplyResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleteCalendar, setDeleteCalendar] = useState(false);
  const headId = useId();
  const diffHead = useRef<HTMLHeadingElement>(null);

  const refresh = useCallback(() => {
    calendarSyncStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  // Status when the dialog opens and whenever the window regains focus (a revoke elsewhere).
  useEffect(() => {
    if (!open) return;
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [open, refresh]);

  // Back from Google's consent page: say how it went, once, and take it out of the address.
  useEffect(() => {
    if (!open) return;
    const ret = oauthReturn(window.location.hash);
    if (!ret) return;
    setNotice(oauthNotice(ret));
    window.history.replaceState(null, '', withoutOauthReturn(window.location.hash) || RETURN_TO);
  }, [open]);

  // A diff belongs to the plan and kinds it was made for.
  useEffect(() => {
    setDiff(null);
    setResult(null);
    setError(null);
  }, [schedule, include]);

  useEffect(() => {
    if (open) return;
    setConfirming(false);
    setDeleteCalendar(false);
    setNotice(null);
  }, [open]);

  if (!open || !status || !status.configured) return null;

  const connect = async () => {
    setBusy('connect');
    setError(null);
    try {
      const { auth_url } = await calendarConnect(RETURN_TO);
      window.location.assign(auth_url);             // Google, then back to the Meal plan
    } catch (err) {
      setError(errorText(err, 'Could not start the connection.'));
      setBusy(null);
      refresh();
    }
  };

  const review = async (): Promise<CalendarDiff | null> => {
    if (!schedule) return null;
    setBusy('review');
    setError(null);
    setResult(null);
    setDiff(null);                      // never leave an old diff, or its button, on screen
    try {
      const fresh = await calendarSyncPreview(exportRequest(schedule, include));
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

  const apply = async (d: CalendarDiff, choices: Record<string, CalendarChoice>) => {
    if (!schedule) return;
    setBusy('apply');
    setError(null);
    try {
      const r = await calendarSyncApply({ ...exportRequest(schedule, include),
        preview_token: d.preview_token, choices: choicesFor(d, choices) });
      setResult(r);
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
    if (fresh && retryIsSame(fresh, failed, chosen)) await apply(fresh, chosen);
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

  const plan = diff ? syncPlan(diff, chosen) : null;
  const results = new Map((result?.results ?? []).map((r) => [r.item_id, r]));
  const failed = failedItems(result);

  return (
    <section className="cal-sync" aria-labelledby={headId} aria-busy={busy !== null}>
      <h3 id={headId} className="cal-head">Google Calendar</h3>
      {notice && <p className={notice.ok ? 'cal-sync-ok' : 'cart-flag'} role="status">{notice.text}</p>}
      {status.problem && <p className="cart-flag" role="alert">{status.problem}</p>}

      {!status.connected ? (
        <>
          <p className="muted cal-sync-what">
            Sync these events into a calendar named Pantry plan that the demo hub creates in your
            Google account. It can see and change only calendars it created, and shows every
            change here before writing anything.
          </p>
          {status.needs_reconnect && (
            <p className="cart-flag" role="alert">
              Google ended the connection, as it does every 7 days while the app is in Testing.
              Connect again to keep syncing.
            </p>
          )}
          {!status.can_connect_here && (
            <p className="cart-flag">
              Connecting works from the console at <a href={status.connect_url}>{status.connect_url}</a>,
              the address registered with your Google OAuth client.
            </p>
          )}
          <div className="cal-sync-actions">
            <button type="button" disabled={busy !== null || !status.can_connect_here} onClick={() => void connect()}>
              {busy === 'connect' ? 'Opening Google…' : status.needs_reconnect ? 'Connect again' : 'Connect Google Calendar'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">{connectionText(status)}</p>
          <div className="cal-sync-actions">
            <button type="button" className="secondary" disabled={!ready || busy !== null}
                    onClick={() => void review()}>
              {busy === 'review' ? 'Reviewing…' : diff ? 'Review again' : 'Review changes'}
            </button>
          </div>
          {!ready && <p className="muted">Changes can be reviewed once the events above are ready.</p>}
        </>
      )}

      {error && <p className="cart-flag" role="alert">{error}</p>}

      {status.connected && diff && plan && (
        <div className="cal-diff">
          <h4 ref={diffHead} tabIndex={-1} className="cal-diff-head">
            Changes for {diff.calendar.summary}
          </h4>
          {unchangedText(diff) && <p className="muted">{unchangedText(diff)}</p>}
          {groupOps(diff).map((g) => (
            <section key={g.op} className={`cal-group cal-group-${g.op}`} aria-label={`${g.title}: ${g.ops.length}`}>
              <h5 className="cal-group-head">{g.title} <span className="muted">({g.ops.length})</span></h5>
              {g.hint && <p className="muted cal-group-hint">{g.hint}</p>}
              <ul className="cal-ops">
                {g.ops.map((op) => (
                  <OpRow key={op.item_id} op={op} choice={chosen[op.item_id]} disabled={busy !== null || result !== null}
                         onChoose={(c) => setChosen((now) => ({ ...now, [op.item_id]: c }))}
                         result={results.get(op.item_id)} />
                ))}
              </ul>
            </section>
          ))}
          {!result ? (
            <div className="cal-sync-actions">
              <button type="button" disabled={busy !== null || (plan.writes === 0 && plan.keep === 0)}
                      onClick={() => void apply(diff, chosen)}>
                {busy === 'apply' ? 'Writing to Google Calendar…' : applyLabel(diff, chosen)}
              </button>
            </div>
          ) : (
            <div className="cal-sync-actions">
              <p className={failed.length ? 'cart-flag' : 'cal-sync-ok'} role="status">{applySummary(result)}</p>
              {failed.length > 0 && (
                <button type="button" className="secondary" disabled={busy !== null} onClick={() => void retry()}>
                  Retry failed
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {status.connected && (
        <div className="cal-disconnect">
          {!confirming ? (
            <button type="button" className="secondary mini" disabled={busy !== null} onClick={() => setConfirming(true)}>
              Disconnect…
            </button>
          ) : (
            <div role="group" aria-label="Disconnect Google Calendar" className="cal-disconnect-confirm">
              <label className="check">
                <input type="checkbox" checked={deleteCalendar} onChange={(e) => setDeleteCalendar(e.target.checked)} />
                Also delete the Pantry plan calendar and its events from Google
              </label>
              <div className="cal-sync-actions">
                <button type="button" className={deleteCalendar ? 'danger mini' : 'mini'} disabled={busy !== null}
                        onClick={() => void disconnect()}>
                  {busy === 'disconnect' ? 'Disconnecting…' : deleteCalendar ? 'Disconnect and delete the calendar' : 'Disconnect'}
                </button>
                <button type="button" className="secondary mini" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}
      <p className="muted cal-sync-note">{status.testing_note}</p>
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
