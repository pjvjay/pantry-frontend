// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Google Calendar sync as the console shows it. The demo hub previews what a sync would do
// (/hub/calendar/sync/preview) and applies exactly that (/hub/calendar/sync/apply); this module
// only groups the preview for reading, keeps the shopper's choices, says in words what the
// button will do, and reads results, refusals and the return from Google's consent page. Dates
// are the server's civil dates, shown with dayLabel: the browser's time zone never moves one.
import { dayLabel } from './mealplan/dates.ts';
import type {
  CalendarApplyResult, CalendarChoice, CalendarDiff, CalendarOp, CalendarOpKind, CalendarOpResult,
  CalendarSyncStatus,
} from './types.ts';

// Where Google sends the shopper back to: the Meal plan, with the dialog reopened.
export const RETURN_TO = '#/mealplan';

export interface SyncGroup {
  op: CalendarOpKind;
  title: string;
  hint: string;
  ops: CalendarOp[];
}

const GROUPS: readonly Omit<SyncGroup, 'ops'>[] = [
  { op: 'create', title: 'Add', hint: '' },
  { op: 'update', title: 'Change', hint: '' },
  { op: 'delete', title: 'Remove', hint: 'No longer in the plan.' },
  { op: 'conflict', title: 'Edited in Google',
    hint: 'Changed in Google Calendar since the last sync: your edit is kept unless you choose otherwise.' },
  { op: 'deleted_in_google', title: 'Deleted in Google',
    hint: 'Deleted in Google Calendar: left deleted unless you restore it.' },
  { op: 'skip', title: 'Past', hint: 'Days before today are left as they are.' },
];

// The diff's operations by group, in a fixed order, empty groups left out. Unchanged events
// (noop) are only counted.
export function groupOps(diff: CalendarDiff): SyncGroup[] {
  return GROUPS.map((g) => ({ ...g, ops: diff.ops.filter((o) => o.op === g.op) }))
    .filter((g) => g.ops.length > 0);
}

// Every "Edited in Google" row starts on Keep; nothing is restored unless ticked.
export function defaultChoices(diff: CalendarDiff): Record<string, CalendarChoice> {
  const out: Record<string, CalendarChoice> = {};
  for (const o of diff.ops) if (o.op === 'conflict') out[o.item_id] = 'keep';
  return out;
}

// The choices to send: one for every conflict (Keep unless Overwrite), restore only where
// ticked, nothing for an item the diff does not offer a choice on.
export function choicesFor(diff: CalendarDiff, chosen: Record<string, CalendarChoice>): Record<string, CalendarChoice> {
  const out: Record<string, CalendarChoice> = {};
  for (const o of diff.ops) {
    const c = chosen[o.item_id];
    if (o.op === 'conflict') out[o.item_id] = c === 'overwrite' ? 'overwrite' : 'keep';
    if (o.op === 'deleted_in_google' && c === 'restore') out[o.item_id] = 'restore';
  }
  return out;
}

export interface SyncPlan {
  add: number;
  change: number;
  remove: number;
  overwrite: number;
  restore: number;
  keep: number;                    // edits in Google kept: nothing is written for them
  writes: number;
}

export function syncPlan(diff: CalendarDiff, chosen: Record<string, CalendarChoice>): SyncPlan {
  const c = choicesFor(diff, chosen);
  const n = (op: CalendarOpKind) => diff.ops.filter((o) => o.op === op).length;
  const conflicts = diff.ops.filter((o) => o.op === 'conflict');
  const overwritten = conflicts.filter((o) => c[o.item_id] === 'overwrite');
  const plan = {
    add: n('create'),
    change: n('update'),
    remove: n('delete') + overwritten.filter((o) => o.origin === 'delete').length,
    overwrite: overwritten.filter((o) => o.origin !== 'delete').length,
    restore: diff.ops.filter((o) => o.op === 'deleted_in_google' && c[o.item_id] === 'restore').length,
    keep: conflicts.length - overwritten.length,
  };
  return { ...plan, writes: plan.add + plan.change + plan.remove + plan.overwrite + plan.restore };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function sentence(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

// The primary button, saying exactly what will happen:
// "Create the Pantry plan calendar and add 5 events", "Add 2, change 1 and remove 1 in Pantry
// plan", "Keep your edit in Google Calendar", or "Nothing to change".
export function applyLabel(diff: CalendarDiff, chosen: Record<string, CalendarChoice>): string {
  const p = syncPlan(diff, chosen);
  const name = diff.calendar.summary;
  if (diff.calendar_action === 'create' && p.add) {
    return `Create the ${name} calendar and add ${plural(p.add, 'event', 'events')}`;
  }
  const parts = [
    p.add ? `add ${p.add}` : '',
    p.change ? `change ${p.change}` : '',
    p.overwrite ? `overwrite ${p.overwrite}` : '',
    p.restore ? `restore ${p.restore}` : '',
    p.remove ? `remove ${p.remove}` : '',
  ].filter(Boolean);
  if (!parts.length) {
    return p.keep ? `Keep ${p.keep === 1 ? 'your edit' : `your ${p.keep} edits`} in Google Calendar`
      : 'Nothing to change';
  }
  const text = `${sentence(parts)} in ${name}`;
  return text[0].toUpperCase() + text.slice(1);
}

// The line above the groups: "3 unchanged.", or that everything is already as planned.
export function unchangedText(diff: CalendarDiff): string {
  const same = diff.counts.noop ?? 0;
  if (!diff.ops.length) return 'The plan has no events of the kinds chosen.';
  if (same === diff.ops.length) return `All ${plural(same, 'event is', 'events are')} already in Google Calendar as planned.`;
  return same ? `${same} unchanged.` : '';
}

export function opDay(op: Pick<CalendarOp, 'date'>): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(op.date) ? dayLabel(op.date) : op.date;
}

const DONE: Partial<Record<CalendarOpKind, string>> = {
  create: 'Added', update: 'Changed', delete: 'Removed', deleted_in_google: 'Restored',
};

// One row's result: "Added", "Kept your edit in Google Calendar", or why it failed.
export function resultText(r: CalendarOpResult): string {
  if (r.ok) return r.message ?? DONE[r.op] ?? 'Done';
  return r.message ?? `Failed (${r.error_code ?? 'error'})`;
}

export function failedItems(result: CalendarApplyResult | null): string[] {
  return result ? result.results.filter((r) => !r.ok).map((r) => r.item_id) : [];
}

// The line under the button after an apply.
export function applySummary(result: CalendarApplyResult): string {
  const total = result.results.length;
  const failed = failedItems(result).length;
  if (!total) return 'Nothing needed writing.';
  if (!failed) return total === 1 ? 'Done.' : `All ${total} done.`;
  if (failed === total) return total === 1 ? 'It failed: see the row above.' : `All ${total} failed: see the rows above.`;
  return `${total - failed} of ${total} done; ${failed} failed.`;
}

// Retry failed may apply a fresh diff straight away only when it writes nothing but the items
// that failed: anything else (a new edit in Google, a changed plan) is shown for review first.
export function retryIsSame(fresh: CalendarDiff, failed: string[], chosen: Record<string, CalendarChoice>): boolean {
  const c = choicesFor(fresh, chosen);
  const writing = fresh.ops.filter((o) => ['create', 'update', 'delete'].includes(o.op)
    || (o.op === 'conflict' && c[o.item_id] === 'overwrite')
    || (o.op === 'deleted_in_google' && c[o.item_id] === 'restore'));
  const newConflicts = fresh.ops.some((o) => o.op === 'conflict' && !(o.item_id in chosen));
  return writing.length > 0 && !newConflicts && writing.every((o) => failed.includes(o.item_id));
}

// A refusal from /hub/calendar/*, as the shopper reads it. The hub's messages already say what
// to do; these are the ones worth putting in the console's own words.
export function syncErrorText(status: number, code: string | null, message: string): string {
  switch (code) {
    case 'needs_reconnect':
      return 'Google ended the connection (Testing-mode connections last 7 days): connect again.';
    case 'not_connected':
      return 'Connect Google Calendar first.';
    case 'sync_in_progress':
      return 'A sync is already running; try again in a moment.';
    case 'choice_needed':
      return 'Choose Keep or Overwrite for every event edited in Google Calendar.';
    default:
      break;
  }
  if (message) return message;
  if (status === 0) return 'The demo hub is not reachable.';
  return `The hub answered ${status}.`;
}

// The hub's refusal body ({code, message}) from whatever a failed call carried.
export function refusal(detail: unknown, fallback: string): { code: string | null; message: string } {
  if (detail && typeof detail === 'object' && 'code' in detail) {
    const d = detail as { code?: unknown; message?: unknown };
    return { code: typeof d.code === 'string' ? d.code : null,
      message: typeof d.message === 'string' ? d.message : fallback };
  }
  return { code: null, message: typeof detail === 'string' ? detail : fallback };
}

export type OAuthOutcome = 'connected' | 'denied' | 'error';

// "#/mealplan?calendar=connected" (or denied, or error&reason=...): the hub's redirect back from
// Google. null for any other hash.
export function oauthReturn(hash: string): { outcome: OAuthOutcome; reason: string | null } | null {
  const query = hash.split('?')[1];
  if (!query) return null;
  const q = new URLSearchParams(query);
  const outcome = q.get('calendar');
  if (outcome !== 'connected' && outcome !== 'denied' && outcome !== 'error') return null;
  return { outcome, reason: q.get('reason') };
}

// The hash with the redirect's calendar and reason taken out, so a reload does not repeat it.
export function withoutOauthReturn(hash: string): string {
  const [path, query] = hash.split('?');
  if (query === undefined) return hash;
  const q = new URLSearchParams(query);
  q.delete('calendar');
  q.delete('reason');
  const rest = q.toString();
  return rest ? `${path}?${rest}` : path;
}

const REASONS: Record<string, string> = {
  access_denied: 'You cancelled at Google, or this Google account is not a test user of the OAuth app.',
  scope_not_granted: 'Google did not grant access to the calendars this app creates: connect again and leave that box ticked.',
  no_refresh_token: 'Google sent no refresh token: connect again.',
  exchange_failed: 'Google refused the sign-in code: connect again.',
  google_unavailable: 'Google could not be reached: try again.',
};

export function oauthNotice(ret: { outcome: OAuthOutcome; reason: string | null }): { text: string; ok: boolean } {
  if (ret.outcome === 'connected') return { text: 'Connected to Google Calendar.', ok: true };
  const why = REASONS[ret.reason ?? ''] ?? 'The connection did not complete: connect again.';
  return { text: `Google Calendar was not connected. ${why}`, ok: false };
}

// "Connected · reconnect by Fri 16 Oct": Testing-mode connections end after 7 days.
export function connectionText(s: CalendarSyncStatus): string {
  const by = s.reconnect_by && /^\d{4}-\d{2}-\d{2}$/.test(s.reconnect_by) ? ` · reconnect by ${dayLabel(s.reconnect_by)}` : '';
  const cal = s.calendar ? ` · calendar ${s.calendar.summary}` : '';
  return `Connected${cal}${by}`;
}
