// The browser half of meal-plan dragging: pointer events in, mealplan/dnd.ts decides, and this
// hook carries out what it decided. Only a grip starts a drag (it is the one element with
// touch-action: none), so the page still scrolls and pinch-zooms everywhere else, and a press
// that moves less than 6 px is a tap: pick up, then tap a slot.
//
// - The pointer is captured on the grip, so moves keep arriving when the finger leaves it.
// - The ghost is moved by transform through a ref inside requestAnimationFrame; React renders
//   again only when the target under the pointer changes.
// - Hit-testing asks the browser what is under the point and walks up to the nearest
//   [data-drop]; the ghost has pointer-events: none, so it is never the answer.
// - Near the top or bottom edge the page scrolls by itself while dragging.
// - pointercancel, lost capture, Escape and the window losing focus all cancel.
// Listeners are added when a press starts and removed when it ends or the component unmounts,
// which StrictMode's double effects cannot leave behind.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

import { IDLE, autoScrollDelta, dragStep } from '../mealplan/dnd';
import type { DragEffect, DragInput, DragPayload, DragState } from '../mealplan/dnd';

export interface DragView {
  payload: DragPayload;
  over: string | null;
}

function hit(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  return el?.closest('[data-drop]')?.getAttribute('data-drop') ?? null;
}

export function usePointerDrag(onEffect: (effect: NonNullable<DragEffect>) => void) {
  const state = useRef<DragState>(IDLE);
  const ghost = useRef<HTMLDivElement | null>(null);
  const point = useRef({ x: 0, y: 0 });
  const frame = useRef(0);
  const detach = useRef<(() => void) | null>(null);
  const latest = useRef(onEffect);
  latest.current = onEffect;
  const [drag, setDrag] = useState<DragView | null>(null);

  // One frame: put the ghost under the pointer and scroll near the edges.
  const tick = useCallback(() => {
    frame.current = 0;
    if (state.current.phase !== 'dragging') return;
    const { x, y } = point.current;
    if (ghost.current) ghost.current.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
    const dy = autoScrollDelta(y, window.innerHeight);
    if (dy) {
      window.scrollBy(0, dy);
      frame.current = window.requestAnimationFrame(tick);
    }
  }, []);

  const feed = useCallback((input: DragInput) => {
    const { state: next, effect } = dragStep(state.current, input, hit);
    state.current = next;
    if (next.phase === 'idle') {
      detach.current?.();
      detach.current = null;
    }
    if (!effect) {
      if (next.phase === 'dragging' && !frame.current) frame.current = window.requestAnimationFrame(tick);
      return;
    }
    if (effect.kind === 'start') setDrag({ payload: effect.payload, over: effect.over });
    else if (effect.kind === 'over') setDrag((d) => (d ? { ...d, over: effect.over } : d));
    else setDrag(null);
    if (next.phase === 'dragging' && !frame.current) frame.current = window.requestAnimationFrame(tick);
    latest.current(effect);
  }, [tick]);

  useEffect(() => () => {
    detach.current?.();
    if (frame.current) window.cancelAnimationFrame(frame.current);
  }, []);

  // Spread on a grip: <span className="mp-grip" {...grip(payload)} />.
  const grip = useCallback((payload: DragPayload) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0 || state.current.phase !== 'idle') return;
      e.preventDefault();
      const el = e.currentTarget;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* the window listeners below still see the pointer */
      }
      point.current = { x: e.clientX, y: e.clientY };
      const move = (ev: PointerEvent) => {
        point.current = { x: ev.clientX, y: ev.clientY };
        feed({ type: 'move', pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY });
      };
      const up = (ev: PointerEvent) =>
        feed({ type: 'up', pointerId: ev.pointerId, x: ev.clientX, y: ev.clientY });
      const cancel = () => feed({ type: 'cancel' });
      const key = (ev: KeyboardEvent) => {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          cancel();
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('blur', cancel);
      window.addEventListener('keydown', key);
      el.addEventListener('lostpointercapture', cancel);
      detach.current = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        window.removeEventListener('blur', cancel);
        window.removeEventListener('keydown', key);
        el.removeEventListener('lostpointercapture', cancel);
      };
      feed({ type: 'down', pointerId: e.pointerId, button: e.button, x: e.clientX, y: e.clientY, payload });
    },
  }), [feed]);

  return { drag, grip, ghost };
}
