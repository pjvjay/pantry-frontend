// A change of view that cross-fades: the meal plan's stages (and anything else that names the part
// that changes). withViewTransition(update) runs the update inside document.startViewTransition
// where the browser has it and the shopper has not asked for less motion; anywhere else it just
// runs the update, and the new view simply appears. Only what carries .vt-stage fades (styles/ui.css,
// "View transitions"), over --dur-2, so the header, the stepper and the bars stay where they are.
//
// The browser photographs the old view, calls the update, then fades to the new one, so the update
// must have drawn the new view by the time it returns: a React state change is flushed at once
// (flushSync) rather than left for React's next render, which would come after the photograph of
// the "new" view and fade from the old view to itself.
//
//   withViewTransition(() => setStage(next));
import { flushSync } from 'react-dom';

import { wantsViewTransition } from '../primitives';

export function withViewTransition(update: () => void): void {
  const browserCan = typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
  const reduced = typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  if (!wantsViewTransition(browserCan, reduced)) {
    update();
    return;
  }
  document.startViewTransition(() => { flushSync(update); });
}
