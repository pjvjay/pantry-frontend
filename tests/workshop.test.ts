// The Workshop's small decisions: the keys that move along rows and tabs, the price per 100 g, the
// words and tags of each state, the evidence's wording, and the Metrics helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PLAN_STATES, claimLabel, confidenceBand, confidenceStatus, coverageStatus, figureColumns, humanize, keyStatus, kindKey,
  leftOutForOrigin,
  legendFor, observedStatus, originStatus, outcomeStatus, queueStatus, serviceStatus,
  newestFirst, rowAfterKey, runStatus, runnerDown, simStatus, sourceLabel, stamp, tabAfterKey, traceOf, unitPrice,
  unitPriceText, whenText,
} from '../src/workshop.ts';

test('rows: the arrows move one row and stop at the ends, Home and End jump, other keys pass', () => {
  assert.equal(rowAfterKey('ArrowDown', 0, 5), 1);
  assert.equal(rowAfterKey('ArrowDown', 4, 5), 4, 'the last row is the end');
  assert.equal(rowAfterKey('ArrowUp', 0, 5), 0, 'the first row is the end');
  assert.equal(rowAfterKey('ArrowUp', 3, 5), 2);
  assert.equal(rowAfterKey('Home', 3, 5), 0);
  assert.equal(rowAfterKey('End', 0, 5), 4);
  assert.equal(rowAfterKey('PageDown', 0, 25), 10);
  assert.equal(rowAfterKey('PageDown', 20, 25), 24);
  assert.equal(rowAfterKey('PageUp', 5, 25), 0);
  assert.equal(rowAfterKey('PageDown', 0, 25, 5), 5, 'a page can be shorter');
  for (const key of ['Enter', ' ', 'Tab', 'a', 'ArrowLeft', 'ArrowRight']) {
    assert.equal(rowAfterKey(key, 2, 5), null, key);
  }
  assert.equal(rowAfterKey('ArrowDown', 0, 0), null, 'no rows, nowhere to go');
  // a row that went (a filter narrowed the list) counts from the nearest end
  assert.equal(rowAfterKey('ArrowUp', 9, 3), 1);
  assert.equal(rowAfterKey('ArrowDown', -1, 3), 1);
});

test('tabs: Left and Right go round, Home and End go to the ends, Up and Down pass', () => {
  assert.equal(tabAfterKey('ArrowRight', 0, 3), 1);
  assert.equal(tabAfterKey('ArrowRight', 2, 3), 0, 'Right on the last tab is the first');
  assert.equal(tabAfterKey('ArrowLeft', 0, 3), 2, 'Left on the first tab is the last');
  assert.equal(tabAfterKey('Home', 2, 3), 0);
  assert.equal(tabAfterKey('End', 0, 3), 2);
  for (const key of ['ArrowDown', 'ArrowUp', 'Enter', 'Tab']) assert.equal(tabAfterKey(key, 1, 3), null, key);
  assert.equal(tabAfterKey('ArrowRight', 0, 0), null);
});

test('unit price: per 100 g, per 100 ml or each, from the package price and size', () => {
  const penne = unitPrice(2.29, 500, 'g');
  assert.equal(penne?.per, '100 g');
  assert.ok(Math.abs((penne?.amount ?? 0) - 0.458) < 1e-9);
  assert.equal(unitPriceText(unitPrice(2.29, 500, 'g')), '$0.46 / 100 g');
  assert.equal(unitPriceText(unitPrice(12, 2, 'kg')), '$0.60 / 100 g', 'kilograms in grams');
  assert.equal(unitPriceText(unitPrice(4.49, 1, 'L')), '$0.45 / 100 ml', 'litres, any case');
  assert.equal(unitPriceText(unitPrice(3.99, 500, 'ml')), '$0.80 / 100 ml');
  assert.equal(unitPriceText(unitPrice(5.04, 12, 'each')), '$0.42 / each');
  assert.equal(unitPriceText(unitPrice(1.29, 1000, 'g')), '$0.13 / 100 g');
  assert.equal(unitPriceText(unitPrice(1.2, 2, 'kg')), '$0.060 / 100 g', 'under ten cents, a third place');
  // no size, an odd unit or a broken price: no figure, never one made up
  assert.equal(unitPrice(2.29, null, 'g'), null);
  assert.equal(unitPrice(2.29, 0, 'g'), null);
  assert.equal(unitPrice(2.29, 500, 'bunch'), null);
  assert.equal(unitPrice(2.29, 500, ''), null);
  assert.equal(unitPrice(Number.NaN, 500, 'g'), null);
  assert.equal(unitPrice(-1, 500, 'g'), null);
  assert.equal(unitPriceText(null), '–');
});

test('origin states: only resolved reads as done; unknown, a guess and an outage never do', () => {
  assert.deepEqual(originStatus('resolved'), { kind: 'done', word: 'Resolved' });
  assert.deepEqual(originStatus('conflicting'), { kind: 'attention', word: 'Conflicting' });
  assert.deepEqual(originStatus('unknown'), { kind: 'blocked', word: 'Unknown' });
  assert.deepEqual(originStatus('lookup_failed'), { kind: 'attention', word: 'Lookup failed' });
  assert.deepEqual(originStatus('guess'), { kind: 'blocked', word: 'Guess only' });
  assert.deepEqual(originStatus(' Resolved '), { kind: 'done', word: 'Resolved' }, 'case and spaces');
  assert.deepEqual(originStatus(''), { kind: 'blocked', word: 'Unknown' });
  assert.deepEqual(originStatus(null), { kind: 'blocked', word: 'Unknown' });
  assert.deepEqual(originStatus('label_pending'), { kind: 'blocked', word: 'Label pending' },
    'a state the console has no words for is said as it came, never as done');
});

test('queue, simulation and run states have their own words', () => {
  assert.deepEqual(queueStatus('pending'), { kind: 'progress', word: 'Pending review' });
  assert.deepEqual(queueStatus('approved'), { kind: 'done', word: 'Approved' });
  assert.deepEqual(queueStatus('rejected'), { kind: 'blocked', word: 'Rejected' });
  assert.deepEqual(simStatus('passed'), { kind: 'done', word: 'Passed' });
  assert.deepEqual(simStatus('failed'), { kind: 'attention', word: 'Failed' });
  assert.deepEqual(simStatus('running'), { kind: 'progress', word: 'Running' });
  assert.deepEqual(simStatus('queued'), { kind: 'paused', word: 'Queued' });
  assert.deepEqual(simStatus('cancelled'), { kind: 'blocked', word: 'Stopped' });
  assert.deepEqual(simStatus(undefined), { kind: 'paused', word: 'Never run' });
  assert.deepEqual(runStatus('answered'), { kind: 'done', word: 'Answered' });
  assert.deepEqual(runStatus('error'), { kind: 'attention', word: 'Failed' });
  assert.deepEqual(runStatus('stopped'), { kind: 'paused', word: 'Stopped' });
});

test('evidence: a confidence band in words, the source and the claim in plain words', () => {
  assert.deepEqual(confidenceBand('high'), { level: 3, word: 'High confidence' });
  assert.deepEqual(confidenceBand('Medium'), { level: 2, word: 'Medium confidence' });
  assert.deepEqual(confidenceBand('low'), { level: 1, word: 'Low confidence' });
  assert.deepEqual(confidenceBand(''), { level: 0, word: 'Confidence not given' });
  assert.equal(sourceLabel('label-photo'), 'Label photo');
  assert.equal(sourceLabel('agent-label'), 'Approved reading');
  assert.equal(sourceLabel('submission'), 'Submitted reading', 'a reading still in the queue is not evidence yet');
  assert.equal(sourceLabel('open-food-facts'), 'Open Food Facts');
  assert.equal(sourceLabel('retailer-pdp'), 'Retailer page');
  assert.equal(sourceLabel('shelf_tag'), 'Shelf tag');
  assert.equal(sourceLabel(''), 'Source not given');
  assert.equal(claimLabel('product-of'), 'Product of');
  assert.equal(claimLabel('packaged-in'), 'Packaged in');
  assert.equal(claimLabel('unknown'), 'No claim');
  assert.equal(claimLabel(''), 'No claim');
  assert.equal(humanize('grown_in'), 'Grown in');
  assert.equal(stamp('2026-11-10T14:02:11.512+00:00'), '2026-11-10 14:02');
  assert.equal(stamp('2026-11-10 09:05'), '2026-11-10 09:05');
  assert.equal(stamp('2026-11-10'), '2026-11-10');
  assert.equal(stamp(''), '');
  assert.equal(stamp('yesterday'), 'yesterday');
});

test('a Metrics address names the run to open; nothing else does', () => {
  assert.equal(traceOf('#/workshop/metrics?trace=tr-53c01836faf0'), 'tr-53c01836faf0');
  assert.equal(traceOf('#/workshop/metrics?x=1&trace=tr%2Dab'), 'tr-ab', 'decoded, among other keys');
  assert.equal(traceOf('#/metrics?trace=abc'), 'abc', 'the old address too');
  assert.equal(traceOf('#/workshop/metrics'), null);
  assert.equal(traceOf('#/workshop/metrics?trace='), null);
  assert.equal(traceOf('#/workshop/metrics?trace=%20'), null);
  assert.equal(traceOf(''), null);
});

test('figure columns: numbers only, a missing value aside', () => {
  const rows = [
    { route: 'GET /hub/status', count: 307, p50_ms: 84, errors: 0, note: null },
    { route: 'POST /hub/agent/chat', count: 5, p50_ms: null, errors: 2, note: 'slow' },
  ];
  assert.deepEqual([...figureColumns(rows, ['route', 'count', 'p50_ms', 'errors', 'note'])],
    ['count', 'p50_ms', 'errors']);
  assert.deepEqual([...figureColumns([{ a: null }], ['a'])], [], 'nothing but gaps is not a figure column');
  assert.deepEqual([...figureColumns([], ['a'])], []);
});

test('the waterfall legend lists the kinds a trace holds, in one order, the gateway once', () => {
  assert.deepEqual(legendFor(['browser', 'model', 'turn', 'tool', 'model']), [
    { key: 'turn', label: 'the turn' },
    { key: 'model', label: 'model step' },
    { key: 'tool', label: 'MCP tool call' },
    { key: 'browser', label: 'browser' },
  ]);
  assert.deepEqual(legendFor(['gateway.tool', 'gateway', 'pantry.llm']).map((e) => e.key),
    ['gateway', 'pantry-llm'], 'the gateway and its tool calls are one entry');
  assert.deepEqual(legendFor(['cache.hit']), [{ key: 'cache-hit', label: 'Cache.hit' }],
    'a kind the console does not know still gets an entry');
  assert.deepEqual(legendFor([]), []);
  assert.equal(kindKey('pantry.step'), 'pantry-step');
  assert.equal(kindKey('gateway.tool'), 'gateway');
  assert.equal(kindKey('model'), 'model');
});

test('recent runs: newest first by when each began, whatever order the hub sent', () => {
  const runs = [
    { id: 'penne', started_at: '2026-11-11T10:00:24.007015+00:00' },
    { id: 'draft', started_at: '2026-11-11T10:30:24.164945+00:00' },
    { id: 'cheap', started_at: '2026-11-11T10:54:10.861144+00:00' },
    { id: 'early', started_at: '2026-11-11T07:35:27.264547+00:00' },
    { id: 'first', started_at: '2026-11-11T07:32:01.946473+00:00' },
  ];
  assert.deepEqual(newestFirst(runs).map((r) => r.id), ['cheap', 'draft', 'penne', 'early', 'first']);
  assert.deepEqual(runs.map((r) => r.id), ['penne', 'draft', 'cheap', 'early', 'first'], 'the list given is left as it was');
  const ties = [{ id: 'a', started_at: '2026-11-11T09:00:00Z' }, { id: 'b', started_at: '2026-11-11T09:00:00Z' },
    { id: 'odd', started_at: 'not a time' }, { id: 'c', started_at: '2026-11-11T08:00:00Z' }];
  assert.deepEqual(newestFirst(ties).map((r) => r.id), ['a', 'b', 'c', 'odd'], 'ties keep their order; an unreadable time goes last');
  assert.deepEqual(newestFirst([]), []);
});

test('a moment in the console\'s words: "Wed 11 Nov, 2:00 AM"', () => {
  // local times, so the words are the same on any machine's clock
  assert.equal(whenText(new Date(2026, 10, 11, 2, 0)), 'Wed 11 Nov, 2:00 AM');
  assert.equal(whenText(new Date(2026, 10, 11, 0, 5)), 'Wed 11 Nov, 12:05 AM', 'midnight is 12 AM');
  assert.equal(whenText(new Date(2026, 10, 11, 12, 30)), 'Wed 11 Nov, 12:30 PM', 'noon is 12 PM');
  assert.equal(whenText(new Date(2026, 0, 3, 23, 59)), 'Sat 3 Jan, 11:59 PM');
  assert.equal(whenText(new Date(2026, 10, 11, 14, 7).getTime()), 'Wed 11 Nov, 2:07 PM', 'a time in milliseconds');
  assert.equal(whenText(new Date(2026, 10, 11, 14, 7).toISOString()), 'Wed 11 Nov, 2:07 PM', 'a stored ISO time');
  assert.equal(whenText('not a time'), '');
});

test('the simulation runner not running is told apart from a run that failed', () => {
  assert.equal(runnerDown('the mcp-sim runner is not reachable at http://127.0.0.1:8765 (All connection attempts failed)'), true);
  assert.equal(runnerDown('the mcp-sim runner is busy with another job: wait for it to finish, then run again'), false);
  assert.equal(runnerDown('The demo hub is not running'), false, 'the hub itself down is the OfflinePanel\'s to say');
  assert.equal(runnerDown(''), false);
  assert.equal(runnerDown(undefined), false);
});

test('the Workshop\'s other states have their words here: services, keys, answers, conversations, coverage', () => {
  assert.deepEqual(serviceStatus(true), { kind: 'done', word: 'Answering' });
  assert.deepEqual(serviceStatus(false), { kind: 'attention', word: 'Not reachable' });
  assert.deepEqual(serviceStatus(null), { kind: 'paused', word: 'Not checked' });
  assert.deepEqual(keyStatus('Gemini key', true), { kind: 'done', word: 'Gemini key: held by the hub' });
  assert.deepEqual(keyStatus('Anthropic key', false, 'pantry-api'), { kind: 'attention', word: 'Anthropic key: missing' });
  assert.deepEqual(keyStatus('Gemini key', true, 'pantry-api').word, 'Gemini key: held by pantry-api');
  assert.deepEqual(confidenceStatus(1), { kind: 'done', word: 'Answer confidence 100%' });
  assert.deepEqual(confidenceStatus(0.9), { kind: 'done', word: 'Answer confidence 90%' }, '90% is done');
  assert.deepEqual(confidenceStatus(0.67), { kind: 'attention', word: 'Answer confidence 67%' });
  assert.deepEqual(confidenceStatus(null), { kind: 'paused', word: 'Confidence not measured' });
  assert.deepEqual(outcomeStatus('completed'), { kind: 'done', word: 'Completed' });
  assert.deepEqual(outcomeStatus('gave_up'), { kind: 'attention', word: 'Gave up' });
  assert.deepEqual(outcomeStatus(''), { kind: 'attention', word: 'No outcome' });
  assert.deepEqual(observedStatus(true), { kind: 'done', word: 'true' });
  assert.deepEqual(observedStatus(false), { kind: 'blocked', word: 'false' });
  assert.deepEqual(observedStatus(null), { kind: 'attention', word: 'unknown' });
  assert.deepEqual(coverageStatus(0.92, true), { kind: 'done', word: 'Origin checked for 92% of the spend' });
  assert.deepEqual(coverageStatus(0, false), { kind: 'attention', word: 'Origin checked for 0% of the spend' },
    'under the floor it needs attention, never reads as clean');
  assert.equal(leftOutForOrigin(2), '2 products left out for their origin');
  assert.equal(leftOutForOrigin(1), '1 product left out for its origin');
  for (const none of [0, undefined, null]) assert.equal(leftOutForOrigin(none), '', 'nothing said when none');
  assert.deepEqual(PLAN_STATES.recommended, { kind: 'done', word: 'Recommended' });
  assert.deepEqual(PLAN_STATES.escalated, { kind: 'changed', word: 'Escalated' });
});
