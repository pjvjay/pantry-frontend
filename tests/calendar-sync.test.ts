// Google Calendar sync's console side (src/calendarSync.ts): the hub's diff grouped for reading,
// Keep as every conflict's default, the button saying exactly what will happen, results and
// Retry failed, refusals in the shopper's words, and the return from Google's consent page.
// The diffs are the hub's /hub/calendar/sync/preview answers in shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyLabel, applySummary, choicesFor, connectionText, defaultChoices, failedItems, groupOps,
  oauthNotice, oauthReturn, opDay, refusal, resultText, retryIsSame, syncErrorText, syncPlan,
  unchangedText, withoutOauthReturn,
} from '../src/calendarSync.ts';
import type { CalendarDiff, CalendarOp, CalendarOpKind, CalendarSyncStatus } from '../src/types.ts';

const op = (item_id: string, kind: CalendarOpKind, extra: Partial<CalendarOp> = {}): CalendarOp => ({
  item_id, op: kind, kind: 'cook', title: `Cook: ${item_id}`, date: '2026-10-13', changes: [], ...extra,
});

function diff(ops: CalendarOp[], action: 'create' | 'existing' = 'existing'): CalendarDiff {
  const counts = { create: 0, update: 0, delete: 0, conflict: 0, deleted_in_google: 0, noop: 0, skip: 0 };
  for (const o of ops) counts[o.op] += 1;
  return { preview_token: 'a'.repeat(64), calendar_action: action, calendar: { summary: 'Pantry plan' },
    plan: 'plan-abc', rev: 2, counts, ops };
}

const mixed = diff([
  op('m1', 'noop'), op('m2', 'create'), op('m3', 'update', { changes: ['date'] }),
  op('m4', 'delete'), op('m5', 'conflict', { origin: 'update', changes: ['title'] }),
  op('m6', 'deleted_in_google'), op('m7', 'skip'), op('m8', 'conflict', { origin: 'delete' }),
]);

test('the diff is grouped Add, Change, Remove, Edited in Google, Deleted in Google, Past', () => {
  const groups = groupOps(mixed);
  assert.deepEqual(groups.map((g) => g.title),
    ['Add', 'Change', 'Remove', 'Edited in Google', 'Deleted in Google', 'Past']);
  assert.deepEqual(groups.map((g) => g.ops.map((o) => o.item_id)),
    [['m2'], ['m3'], ['m4'], ['m5', 'm8'], ['m6'], ['m7']]);
  // unchanged events are counted, not listed
  assert.equal(unchangedText(mixed), '1 unchanged.');
  assert.equal(unchangedText(diff([op('a', 'noop'), op('b', 'noop')])),
    'All 2 events are already in Google Calendar as planned.');
  assert.equal(unchangedText(diff([])), 'The plan has no events of the kinds chosen.');
  assert.equal(unchangedText(diff([op('a', 'create')])), '');
  assert.deepEqual(groupOps(diff([op('a', 'noop')])), []);
});

test('every edit made in Google starts on Keep, and nothing is restored unless ticked', () => {
  assert.deepEqual(defaultChoices(mixed), { m5: 'keep', m8: 'keep' });
  assert.deepEqual(choicesFor(mixed, {}), { m5: 'keep', m8: 'keep' });
  // choices only where the diff offers one, and restore only when ticked
  assert.deepEqual(choicesFor(mixed, { m5: 'overwrite', m6: 'restore', m2: 'restore', gone: 'keep' }),
    { m5: 'overwrite', m8: 'keep', m6: 'restore' });
  assert.deepEqual(choicesFor(mixed, { m6: 'keep' }), { m5: 'keep', m8: 'keep' });
});

test('the button says exactly what will be written', () => {
  assert.deepEqual(syncPlan(mixed, {}),
    { add: 1, change: 1, remove: 1, overwrite: 0, restore: 0, keep: 2, writes: 3 });
  assert.equal(applyLabel(mixed, {}), 'Add 1, change 1 and remove 1 in Pantry plan');
  assert.equal(applyLabel(mixed, { m5: 'overwrite', m6: 'restore', m8: 'overwrite' }),
    'Add 1, change 1, overwrite 1, restore 1 and remove 2 in Pantry plan');
  // the first sync makes the calendar
  const first = diff([op('a', 'create'), op('b', 'create'), op('c', 'skip')], 'create');
  assert.equal(applyLabel(first, {}), 'Create the Pantry plan calendar and add 2 events');
  assert.equal(applyLabel(diff([op('a', 'create')], 'create'), {}),
    'Create the Pantry plan calendar and add 1 event');
  // only edits to keep: nothing goes to Google, and it says so
  const kept = diff([op('a', 'conflict', { origin: 'update' }), op('b', 'noop')]);
  assert.equal(applyLabel(kept, {}), 'Keep your edit in Google Calendar');
  assert.equal(syncPlan(kept, {}).writes, 0);
  assert.equal(applyLabel(diff([op('a', 'conflict'), op('b', 'conflict')]), {}),
    'Keep your 2 edits in Google Calendar');
  assert.equal(applyLabel(diff([op('a', 'noop'), op('b', 'deleted_in_google')]), {}), 'Nothing to change');
  assert.equal(applyLabel(diff([op('a', 'update')]), {}), 'Change 1 in Pantry plan');
});

test('results read per row, with a summary and what Retry failed may redo at once', () => {
  assert.equal(resultText({ item_id: 'a', op: 'create', ok: true }), 'Added');
  assert.equal(resultText({ item_id: 'a', op: 'delete', ok: true }), 'Removed');
  assert.equal(resultText({ item_id: 'a', op: 'conflict', ok: true, message: 'Kept your edit in Google Calendar' }),
    'Kept your edit in Google Calendar');
  assert.equal(resultText({ item_id: 'a', op: 'update', ok: false, error_code: 'rate_limited' }),
    'Failed (rate_limited)');
  const partial = { status: 'partial' as const, calendar: { summary: 'Pantry plan' }, results: [
    { item_id: 'a', op: 'create' as const, ok: true },
    { item_id: 'b', op: 'create' as const, ok: false, error_code: 'quota_exceeded', message: 'quota' },
    { item_id: 'c', op: 'update' as const, ok: false, error_code: 'quota_exceeded', message: 'Not tried: quota' },
  ] };
  assert.deepEqual(failedItems(partial), ['b', 'c']);
  assert.equal(applySummary(partial), '1 of 3 done; 2 failed.');
  assert.equal(applySummary({ ...partial, results: partial.results.slice(0, 1) }), 'Done.');
  assert.equal(applySummary({ ...partial, results: [] }), 'Nothing needed writing.');
  assert.equal(applySummary({ ...partial, results: partial.results.slice(1) }), 'All 2 failed: see the rows above.');
  assert.deepEqual(failedItems(null), []);

  // a fresh diff that writes only what failed is applied straight away ...
  assert.equal(retryIsSame(diff([op('b', 'create'), op('c', 'update'), op('a', 'noop')]), ['b', 'c'], {}), true);
  // ... but anything new is shown for review first
  assert.equal(retryIsSame(diff([op('b', 'create'), op('d', 'update')]), ['b', 'c'], {}), false);
  assert.equal(retryIsSame(diff([op('b', 'create'), op('e', 'conflict')]), ['b'], {}), false);
  assert.equal(retryIsSame(diff([op('a', 'noop')]), ['b'], {}), false);
  assert.equal(retryIsSame(diff([op('b', 'conflict')]), ['b'], { b: 'overwrite' }), true);
});

test('refusals read in the shopper\'s words', () => {
  assert.match(syncErrorText(409, 'needs_reconnect', 'x'), /connect again/);
  assert.equal(syncErrorText(409, 'not_connected', ''), 'Connect Google Calendar first.');
  assert.match(syncErrorText(409, 'sync_in_progress', ''), /already running/);
  assert.equal(syncErrorText(409, 'preview_stale', 'The plan changed: review again.'), 'The plan changed: review again.');
  assert.equal(syncErrorText(502, null, ''), 'The hub answered 502.');
  assert.deepEqual(refusal({ code: 'calendar_missing', message: 'Gone.' }, 'f'), { code: 'calendar_missing', message: 'Gone.' });
  assert.deepEqual(refusal('plain', 'f'), { code: null, message: 'plain' });
  assert.deepEqual(refusal(null, 'f'), { code: null, message: 'f' });
});

test('the return from Google is read once and taken out of the address', () => {
  assert.deepEqual(oauthReturn('#/mealplan?calendar=connected'), { outcome: 'connected', reason: null });
  assert.deepEqual(oauthReturn('#/mealplan?calendar=denied&reason=access_denied'),
    { outcome: 'denied', reason: 'access_denied' });
  assert.equal(oauthReturn('#/mealplan'), null);
  assert.equal(oauthReturn('#/mealplan?calendar=pwned'), null);
  assert.equal(withoutOauthReturn('#/mealplan?calendar=error&reason=no_refresh_token'), '#/mealplan');
  assert.equal(withoutOauthReturn('#/catalog?product=3&calendar=connected'), '#/catalog?product=3');
  assert.equal(withoutOauthReturn('#/mealplan'), '#/mealplan');
  assert.deepEqual(oauthNotice({ outcome: 'connected', reason: null }), { text: 'Connected to Google Calendar.', ok: true });
  assert.match(oauthNotice({ outcome: 'denied', reason: 'access_denied' }).text, /not a test user/);
  assert.match(oauthNotice({ outcome: 'error', reason: 'scope_not_granted' }).text, /leave that box ticked/);
  assert.match(oauthNotice({ outcome: 'error', reason: '<script>' }).text, /did not complete/);
});

test('the connection line names the calendar and the reconnect-by day', () => {
  const s = { configured: true, client_type: 'web', connected: true, needs_reconnect: false,
    reconnect_by: '2026-10-16', can_connect_here: true, connect_url: 'http://127.0.0.1:8090/pantry/',
    calendar: { summary: 'Pantry plan' }, scope: 'calendar.app.created', all_day: true,
    testing_note: '', last_sync: null, problem: null } satisfies CalendarSyncStatus;
  assert.equal(connectionText(s), 'Connected · calendar Pantry plan · reconnect by Fri 16 Oct');
  assert.equal(connectionText({ ...s, calendar: null, reconnect_by: null }), 'Connected');
  assert.equal(opDay({ date: '2026-11-01' }), 'Sun 1 Nov');
});
