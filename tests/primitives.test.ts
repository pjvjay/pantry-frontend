// The shared primitives' decisions: when a box that scrolls inside itself is a stop for the
// keyboard and what it is called, how a figure's tone is drawn, and when a change of view fades.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STAT_TONES, overflows, scrollRegionProps, toastClearance, wantsViewTransition } from '../src/primitives.ts';

const box = (client: [number, number], scroll: [number, number]) => ({
  clientWidth: client[0], clientHeight: client[1], scrollWidth: scroll[0], scrollHeight: scroll[1],
});

test('a box overflows when its content is wider or taller than the box', () => {
  assert.equal(overflows(box([300, 200], [300, 200])), false);
  assert.equal(overflows(box([300, 200], [640, 200])), true, 'a wide table');
  assert.equal(overflows(box([300, 200], [300, 900])), true, 'a long list');
  assert.equal(overflows(box([300, 200], [640, 900])), true);
});

test('a pixel of rounding is not overflow', () => {
  assert.equal(overflows(box([300, 200], [301, 200])), false);
  assert.equal(overflows(box([300, 200], [300, 201])), false);
  assert.equal(overflows(box([300, 200], [302, 200])), true);
  assert.equal(overflows(box([300, 200], [304, 200]), 4), false, 'the slack can be given');
});

test('an empty or hidden box never overflows', () => {
  assert.equal(overflows(box([0, 0], [0, 0])), false);
});

test('while it overflows, a scroll region is a named keyboard stop', () => {
  assert.deepEqual(scrollRegionProps(true, { label: 'Recent turns' }),
    { tabIndex: 0, role: 'region', 'aria-label': 'Recent turns' });
});

test('a region named by something on the page points at it instead', () => {
  assert.deepEqual(scrollRegionProps(true, { label: 'ignored', labelledBy: 'sheet-title' }),
    { tabIndex: 0, role: 'region', 'aria-labelledby': 'sheet-title' });
});

test('while everything fits, a scroll region adds no stop and no landmark', () => {
  assert.deepEqual(scrollRegionProps(false, { label: 'Recent turns' }), {});
  assert.deepEqual(scrollRegionProps(false, { labelledBy: 'sheet-title' }), {});
});

test('a tone always brings a sign with its colour; a plain figure has neither', () => {
  assert.deepEqual(STAT_TONES.default, { className: 'stat-tile', icon: null });
  for (const tone of ['good', 'warn', 'danger'] as const) {
    assert.ok(STAT_TONES[tone].icon, `${tone} has no sign`);
    assert.equal(STAT_TONES[tone].className, `stat-tile stat-tile-${tone}`);
  }
});

test('a change of view fades only where the browser can and motion is welcome', () => {
  assert.equal(wantsViewTransition(true, false), true);
  assert.equal(wantsViewTransition(true, true), false, 'reduced motion: the view simply appears');
  assert.equal(wantsViewTransition(false, false), false, 'no View Transitions: the update just runs');
  assert.equal(wantsViewTransition(false, true), false);
});

test('a new toast moves the page only as far as clears the control that has focus', () => {
  const button = { top: 650, bottom: 700, left: 16, right: 374 };
  const stack = { top: 628, bottom: 688, left: 16, right: 374 };
  // Build a week for me on a phone, under the toast that answers it: up by its overlap and a gap
  assert.equal(toastClearance(button, stack, 0), 80);
  // already clear above the toast, or beside a narrow one: nothing moves
  assert.equal(toastClearance({ ...button, top: 560, bottom: 610 }, stack, 0), 0);
  assert.equal(toastClearance(button, { ...stack, left: 450, right: 830 }, 0), 0);
  // never up under a bar at the top of the screen
  assert.equal(toastClearance({ ...button, top: 120, bottom: 700 }, stack, 90), 30);
  assert.equal(toastClearance({ ...button, top: 60, bottom: 700 }, stack, 90), 0);
});
