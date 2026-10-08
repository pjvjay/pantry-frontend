// The drag gesture, hit-testing and the keyboard route, as the board will feed them events.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DRAG_THRESHOLD_PX, IDLE, autoScrollDelta, canDrop, dragStep, dropEdit, hitTest, keyIntent, keyMove,
  parseTarget, shopKey, slotLabel,
} from '../src/mealplan/dnd.ts';
import type { DragInput, DragPayload, DragState, TargetRect } from '../src/mealplan/dnd.ts';
import { cellKey, reduce } from '../src/mealplan/model.ts';
import { D, add, planWith } from './helpers/mealplan.ts';

const MEAL: DragPayload = { kind: 'meal', mealId: 'starter:pepperoni_pizza#1' };
const TRIP: DragPayload = { kind: 'trip', tripId: 'fresh-2026-10-09', date: '2026-10-09' };

// Two day columns, each a card holding a dinner slot, and the tray below them.
const RECTS: TargetRect[] = [
  { key: 'day', left: 0, top: 0, right: 200, bottom: 300 },
  { key: cellKey(D(0), 'dinner'), left: 10, top: 100, right: 100, bottom: 150 },
  { key: cellKey(D(1), 'dinner'), left: 100, top: 100, right: 190, bottom: 150 },
  { key: shopKey(D(1)), left: 100, top: 20, right: 190, bottom: 60 },
  { key: 'tray', left: 0, top: 400, right: 200, bottom: 500 },
];
const hit = (x: number, y: number) => hitTest(RECTS, x, y);

function feed(inputs: DragInput[], state: DragState = IDLE) {
  const effects = [];
  for (const i of inputs) {
    const out = dragStep(state, i, hit);
    state = out.state;
    if (out.effect) effects.push(out.effect);
  }
  return { state, effects };
}

test('the smallest target under the pointer wins, and a shared edge belongs to one side', () => {
  assert.equal(hit(50, 120), cellKey(D(0), 'dinner'));
  assert.equal(hit(100, 120), cellKey(D(1), 'dinner'));
  assert.equal(hit(99.9, 120), cellKey(D(0), 'dinner'));
  assert.equal(hit(5, 250), 'day');
  assert.equal(hit(500, 500), null);
});

test('drop keys parse, and anything else is not a target', () => {
  assert.deepEqual(parseTarget(cellKey(D(2), 'snack')), { kind: 'slot', date: D(2), slot: 'snack' });
  assert.deepEqual(parseTarget('tray'), { kind: 'tray' });
  assert.deepEqual(parseTarget(shopKey(D(3))), { kind: 'shop', date: D(3) });
  for (const bad of ['day', 'shop|2026-13-01', 'shop|2026-10-10|x', '', null]) {
    assert.equal(parseTarget(bad), null, String(bad));
  }
});

test('meals drop on slots and the tray; trips only on another day\'s Shop row', () => {
  assert.equal(canDrop(MEAL, cellKey(D(0), 'dinner')), true);
  assert.equal(canDrop(MEAL, 'tray'), true);
  assert.equal(canDrop(MEAL, shopKey(D(1))), false);
  assert.equal(canDrop(TRIP, shopKey(D(1))), true);
  assert.equal(canDrop(TRIP, shopKey(D(0))), false, 'its own day is not a move');
  assert.equal(canDrop(TRIP, cellKey(D(0), 'dinner')), false);
  assert.deepEqual(dropEdit(MEAL, cellKey(D(1), 'dinner')),
    { type: 'place', mealId: MEAL.mealId, date: D(1), slot: 'dinner' });
  assert.deepEqual(dropEdit(MEAL, 'tray'), { type: 'unplace', mealId: MEAL.mealId });
  assert.deepEqual(dropEdit(TRIP, shopKey(D(1))), { type: 'moveTrip', from: D(0), to: D(1) });
  assert.equal(dropEdit(TRIP, 'tray'), null);
});

test(`a movement under ${DRAG_THRESHOLD_PX} px is a tap, not a drag`, () => {
  const { state, effects } = feed([
    { type: 'down', pointerId: 1, button: 0, x: 50, y: 120, payload: MEAL },
    { type: 'move', pointerId: 1, x: 53, y: 124 },
    { type: 'up', pointerId: 1, x: 53, y: 124 },
  ]);
  assert.deepEqual(effects, [{ kind: 'tap', payload: MEAL }]);
  assert.deepEqual(state, IDLE);
});

test('a drag starts past the threshold, reports a new target only when it changes, and drops', () => {
  const { state, effects } = feed([
    { type: 'down', pointerId: 7, button: 0, x: 50, y: 400 },
    { type: 'move', pointerId: 7, x: 50, y: 410 },
    { type: 'move', pointerId: 7, x: 50, y: 130 },
    { type: 'move', pointerId: 7, x: 60, y: 131 },
    { type: 'move', pointerId: 7, x: 5, y: 250 },
    { type: 'move', pointerId: 7, x: 150, y: 120 },
    { type: 'up', pointerId: 7, x: 150, y: 120 },
  ].map((i) => (i.type === 'down' ? { ...i, payload: MEAL } : i)) as DragInput[]);
  assert.deepEqual(effects, [
    { kind: 'start', payload: MEAL, over: 'tray' },
    { kind: 'over', over: cellKey(D(0), 'dinner') },
    { kind: 'over', over: null },               // the day card is not a target for a meal
    { kind: 'over', over: cellKey(D(1), 'dinner') },
    { kind: 'drop', payload: MEAL, target: cellKey(D(1), 'dinner') },
  ]);
  assert.deepEqual(state, IDLE);
});

test('releasing over nothing, pointercancel, blur or Escape cancel with no edit', () => {
  const start: DragInput[] = [
    { type: 'down', pointerId: 1, button: 0, x: 50, y: 120, payload: MEAL },
    { type: 'move', pointerId: 1, x: 50, y: 200 },
  ];
  assert.deepEqual(feed([...start, { type: 'up', pointerId: 1, x: 500, y: 500 }]).effects.at(-1),
    { kind: 'cancel', payload: MEAL });
  const cancelled = feed([...start, { type: 'cancel' }]);
  assert.deepEqual(cancelled.effects.at(-1), { kind: 'cancel', payload: MEAL });
  assert.deepEqual(cancelled.state, IDLE);
  // A cancel before the drag started is silent: nothing was picked up.
  assert.deepEqual(feed([start[0], { type: 'cancel' }]).effects, []);
});

test('only the primary button starts, and other pointers are ignored', () => {
  assert.deepEqual(feed([{ type: 'down', pointerId: 1, button: 2, x: 0, y: 0, payload: MEAL }]).state, IDLE);
  const { effects } = feed([
    { type: 'down', pointerId: 1, button: 0, x: 50, y: 120, payload: MEAL },
    { type: 'down', pointerId: 2, button: 0, x: 60, y: 120, payload: TRIP },
    { type: 'move', pointerId: 2, x: 150, y: 40 },
    { type: 'up', pointerId: 2, x: 150, y: 40 },
    { type: 'up', pointerId: 1, x: 50, y: 120 },
  ]);
  assert.deepEqual(effects, [{ kind: 'tap', payload: MEAL }]);
});

test('a trip drags along the Shop rows', () => {
  const { effects } = feed([
    { type: 'down', pointerId: 1, button: 0, x: 20, y: 30, payload: TRIP },
    { type: 'move', pointerId: 1, x: 150, y: 40 },
    { type: 'up', pointerId: 1, x: 150, y: 40 },
  ]);
  assert.deepEqual(effects.at(-1), { kind: 'drop', payload: TRIP, target: shopKey(D(1)) });
});

test('a drop applied through the reducer moves the meal', () => {
  const s = planWith(7, add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  const edit = dropEdit(MEAL, cellKey(D(1), 'dinner'));
  assert.ok(edit);
  assert.equal(reduce(s, edit).draft.meals[0].date, D(1));
});

test('auto-scroll speeds up toward the edges and is still in the middle', () => {
  assert.equal(autoScrollDelta(400, 800), 0);
  assert.equal(autoScrollDelta(0, 800), -16);
  assert.equal(autoScrollDelta(24, 800), -8);
  assert.equal(autoScrollDelta(800, 800), 16);
  assert.equal(autoScrollDelta(776, 800), 8);
});

test('arrow keys walk the board and stop at its edges', () => {
  const w = { start_date: D(0), days: 14 };
  const slots = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
  const at = { date: D(0), slot: 'dinner' as const };
  assert.deepEqual(keyMove(at, 'ArrowRight', w, slots), { date: D(1), slot: 'dinner' });
  assert.equal(keyMove(at, 'ArrowLeft', w, slots), null);
  assert.deepEqual(keyMove(at, 'ArrowUp', w, slots), { date: D(0), slot: 'lunch' });
  assert.deepEqual(keyMove(at, 'ArrowDown', w, slots), { date: D(0), slot: 'snack' });
  assert.equal(keyMove({ ...at, slot: 'snack' }, 'ArrowDown', w, slots), null);
  assert.deepEqual(keyMove(at, 'PageDown', w, slots), { date: D(7), slot: 'dinner' });
  assert.equal(keyMove({ date: D(8), slot: 'dinner' }, 'PageDown', w, slots), null);
  assert.deepEqual(keyMove({ date: D(5), slot: 'dinner' }, 'End', w, slots), { date: D(13), slot: 'dinner' });
  assert.deepEqual(keyMove({ date: D(5), slot: 'dinner' }, 'Home', w, slots), at);
  assert.equal(keyMove(at, 'Home', w, slots), null);
  // Up and down skip the slots switched off.
  assert.deepEqual(keyMove(at, 'ArrowUp', w, ['breakfast', 'dinner']), { date: D(0), slot: 'breakfast' });
  assert.equal(keyMove(at, 'x', w, slots), null);
});

test('keys mean pick, place, cancel, tray, move, undo and redo, and nothing while typing', () => {
  const idle = { holding: false, inText: false };
  const holding = { holding: true, inText: false };
  assert.equal(keyIntent({ key: 'Enter' }, idle), 'pick');
  assert.equal(keyIntent({ key: ' ' }, idle), 'pick');
  assert.equal(keyIntent({ key: 'Enter' }, holding), 'place');
  assert.equal(keyIntent({ key: 'Escape' }, holding), 'cancel');
  assert.equal(keyIntent({ key: 'Escape' }, idle), null);
  assert.equal(keyIntent({ key: 'Delete' }, idle), 'tray');
  assert.equal(keyIntent({ key: 'ArrowLeft' }, holding), 'move');
  assert.equal(keyIntent({ key: 'z', ctrlKey: true }, idle), 'undo');
  assert.equal(keyIntent({ key: 'Z', metaKey: true, shiftKey: true }, idle), 'redo');
  assert.equal(keyIntent({ key: 'y', ctrlKey: true }, idle), 'redo');
  assert.equal(keyIntent({ key: 'z', ctrlKey: true }, { holding: false, inText: true }), null);
  assert.equal(keyIntent({ key: 'Enter' }, { holding: true, inText: true }), null);
  assert.equal(keyIntent({ key: 'Enter', altKey: true }, idle), null);
});

test('slot buttons say what pressing them does', () => {
  const cell = { date: '2026-10-16', slot: 'dinner' as const };
  assert.equal(slotLabel(cell, 'Chicken curry', []), 'Place Chicken curry in Dinner, Fri 16 Oct');
  assert.equal(slotLabel(cell, 'Chicken curry', ['Tomato penne']),
    'Place Chicken curry in Dinner, Fri 16 Oct, swapping with Tomato penne');
  assert.equal(slotLabel({ ...cell, slot: 'snack' }, 'Mango Milkshake', ['Mango Milkshake']),
    'Place Mango Milkshake in Snack, Fri 16 Oct', 'a snack slot holds two');
  assert.equal(slotLabel(cell, null, []), 'Dinner, Fri 16 Oct: empty');
  assert.equal(slotLabel(cell, null, ['Tomato penne']), 'Dinner, Fri 16 Oct: Tomato penne');
});
