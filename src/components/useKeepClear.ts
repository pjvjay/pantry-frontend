// The bars that stay on screen over the page, at its top or its bottom: the meal plan's budget bar
// (stuck at the top while the meals scroll under it), its action bar while something is being
// moved, and the Assistant's message box (stuck above the bottom bar). When the keyboard moves
// focus, the browser scrolls the control into view clear of the page's scroll-padding and no
// further, so without this a control could come to rest under one of them, out of sight.
//
// Each bar reports how far into the screen it reaches from its edge: its offset from that edge (a
// fixed or sticky bar's own top or bottom, the bottom bar included) plus its height, or nothing
// while it is hidden (the Assistant kept mounted on another page). The deepest at each edge
// becomes --top-cover or --bottom-cover on <html>, and the scroll padding in styles/shell.css
// keeps a focused control clear of it. A fixed bar at the bottom also counts in
// --bottom-fixed-cover, which the page's own bottom padding makes room for: at the end of the page
// there is nothing left to scroll, and the footer would stay under it. (A sticky bar needs no
// such room: at the end of the page it is back in its place in the flow.) useKeepClear returns a
// ref callback, so a bar that comes and goes (the action bar shows only while something is held)
// is counted only while it is there.
import { useCallback, useRef } from 'react';

type Edge = 'top' | 'bottom';

// Room for the focus ring above a control that comes to rest under a top bar (the bottom edge's
// scroll padding has its own gap in CSS).
const TOP_GAP = 8;

interface Reach { px: number; fixed: boolean }

const reach: Record<Edge, Map<HTMLElement, Reach>> = { top: new Map(), bottom: new Map() };

const deepest = (rs: Iterable<Reach>) => Math.max(0, ...[...rs].map((r) => r.px));

function publish(edge: Edge) {
  const root = document.documentElement.style;
  const all = deepest(reach[edge].values());
  root.setProperty(`--${edge}-cover`, `${Math.ceil(edge === 'top' && all > 0 ? all + TOP_GAP : all)}px`);
  if (edge === 'bottom') {
    root.setProperty('--bottom-fixed-cover', `${Math.ceil(deepest([...reach.bottom.values()].filter((r) => r.fixed)))}px`);
  }
}

function measure(el: HTMLElement, edge: Edge): Reach {
  const style = getComputedStyle(el);
  if (!el.offsetHeight) return { px: 0, fixed: false };
  const offset = parseFloat(style[edge]);
  return { px: (Number.isFinite(offset) ? offset : 0) + el.offsetHeight, fixed: style.position === 'fixed' };
}

export function useKeepClear(edge: Edge): (el: HTMLElement | null) => void {
  const release = useRef<(() => void) | null>(null);
  return useCallback((el: HTMLElement | null) => {
    release.current?.();
    release.current = null;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      reach[edge].set(el, measure(el, edge));
      publish(edge);
    };
    // Measured again when it changes size (wrapping onto another line, hiding: display: none
    // measures nothing) and when the window does (crossing 900px brings the bottom bar, which
    // moves a bar above it without resizing it).
    const observer = new ResizeObserver(update);
    observer.observe(el);
    window.addEventListener('resize', update);
    release.current = () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      reach[edge].delete(el);
      publish(edge);
    };
    update();
  }, [edge]);
}
