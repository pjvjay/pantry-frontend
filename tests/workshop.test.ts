// The Workshop's small decisions: the keys that move along rows and tabs, the price per 100 g, the
// words and tags of each state, the evidence's wording, and the Metrics helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  claimLabel, confidenceBand, figureColumns, humanize, kindKey, legendFor, originStatus, queueStatus,
  rowAfterKey, runStatus, simStatus, sourceLabel, stamp, tabAfterKey, traceOf, unitPrice, unitPriceText,
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
