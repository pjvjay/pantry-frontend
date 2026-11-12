import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  UNDO_LIMIT, canRedo, canUndo, isLatest, markOf, record, redo, replace, startHistory, undo,
} from '../src/mealplan/undo.ts';

test('undo and redo walk the snapshots both ways, and a new edit drops the redo', () => {
  let h = startHistory('a');
  h = record(record(h, 'b'), 'c');
  h = undo(h);
  assert.equal(h.present, 'b');
  h = undo(h);
  assert.equal(h.present, 'a');
  assert.equal(canUndo(h), false);
  assert.equal(undo(h), h, 'nothing to undo');
  h = redo(h);
  assert.equal(h.present, 'b');
  h = record(h, 'd');
  assert.equal(canRedo(h), false);
  assert.deepEqual(h.past, ['a', 'b']);
});

test('an edit that changed nothing is not a step', () => {
  const h = startHistory({ n: 1 });
  assert.equal(record(h, h.present), h);
});

test('replace changes the present without a step', () => {
  const h = replace(record(startHistory('a'), 'b'), 'b2');
  assert.deepEqual(h, { past: ['a'], present: 'b2', future: [] });
  assert.equal(undo(h).present, 'a');
});

test(`at most ${UNDO_LIMIT} steps are kept, the oldest dropped first`, () => {
  let h = startHistory(0);
  for (let i = 1; i <= UNDO_LIMIT + 10; i += 1) h = record(h, i);
  assert.equal(h.past.length, UNDO_LIMIT);
  assert.equal(h.past[0], 10);
});

test('restore adapts the snapshot brought back to what is true now', () => {
  let h = record(startHistory({ v: 'a', rev: 1 }), { v: 'b', rev: 2 });
  const bump = (t: { v: string; rev: number }, now: { v: string; rev: number }) =>
    ({ ...t, rev: now.rev + 1 });
  h = undo(h, bump);
  assert.deepEqual(h.present, { v: 'a', rev: 3 });
  h = redo(h, bump);
  assert.deepEqual(h.present, { v: 'b', rev: 4 });
});

test('a step stays the latest until another step, an undo or a redo; a replaced present keeps it', () => {
  let h = record(startHistory('a'), 'b');
  const mark = markOf(h);
  assert.equal(isLatest(h, mark), true);
  h = replace(h, 'b2');
  assert.equal(isLatest(h, mark), true, 'an answer kept on the plan is not a step');
  assert.equal(isLatest(record(h, 'c'), mark), false, 'an edit since');
  assert.equal(isLatest(undo(h), mark), false, 'undone since');
  assert.equal(isLatest(redo(undo(h)), mark), false, 'undone and redone: a step again, not the one marked');
  const none = startHistory('a');
  assert.equal(isLatest(none, markOf(none)), false, 'no step to take back');
});
