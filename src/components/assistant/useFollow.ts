// Where the Ask page scrolls while an answer streams in. Never against the reader: the page keeps
// up with the newest line only while the reader is at it, within about 80px of the end of the
// transcript (the end measured to the top of the message box, which covers the bottom of the
// screen). Scrolled further up, they are reading something, and the page stays exactly where it
// is; a "New reply" pill appears instead, which takes them down when they want.
//
// Only what the stream adds is followed. The reader's own changes (opening a run's steps, a cart
// line's Options, a swap redrawing its card) move nothing: after a press in the transcript the
// page measures again where the reader now is, and a swap's redraw is marked beforehand as theirs
// (hold). Sending a question is the reader's own act too: the page goes to it (stick). Nothing
// moves while the page is hidden (the Assistant stays mounted on other pages), and coming back to
// it measures again instead of jumping.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const NEAR = 80;

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function useFollow({ active, end, composer, content }: {
  active: boolean;
  // the transcript's last element, and the message box
  end: RefObject<HTMLElement>;
  composer: RefObject<HTMLElement>;
  // what the stream changes (the turns): a new value is new content
  content: unknown;
}) {
  const following = useRef(true);
  const held = useRef(false);
  const seen = useRef(false);
  const lastEnd = useRef(0);
  const [pill, setPill] = useState(false);

  // How far the end of the transcript is below the top of the message box (negative: above it).
  const gap = useCallback(() => {
    const e = end.current;
    const c = composer.current;
    if (!e || !c) return 0;
    return e.getBoundingClientRect().top - c.getBoundingClientRect().top;
  }, [end, composer]);
  const endY = useCallback(() => (end.current ? end.current.getBoundingClientRect().top + window.scrollY : 0), [end]);

  const measure = useCallback(() => {
    following.current = gap() <= NEAR;
    if (following.current) setPill(false);
  }, [gap]);

  useEffect(() => {
    if (!active) return undefined;
    // back on the page: where the reader is now, after the shell has put the page at its top
    const frame = requestAnimationFrame(() => {
      measure();
      lastEnd.current = endY();
    });
    window.addEventListener('scroll', measure, { passive: true });
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', measure);
      window.removeEventListener('resize', measure);
    };
  }, [active, measure, endY]);

  // New content from the stream: follow it, or offer the pill. Measured before paint, so a
  // followed line never flashes below the box first.
  useLayoutEffect(() => {
    if (!active) return;
    const y = endY();
    const grew = y > lastEnd.current + 1;
    lastEnd.current = y;
    // the page as it opened is where it starts, not something new to go down to
    if (!seen.current) {
      seen.current = true;
      return;
    }
    if (held.current) {
      held.current = false;
      return;
    }
    if (!grew) return;
    if (following.current) end.current?.scrollIntoView({ block: 'end' });
    else setPill(true);
    // `content` is the stream's state: each new value is what this follows
  }, [content]);

  return {
    pill,
    // a press in the transcript changed it (opened something): measure where the reader is
    recheck: useCallback(() => {
      requestAnimationFrame(() => {
        measure();
        lastEnd.current = endY();
      });
    }, [measure, endY]),
    // the next change is the reader's own (a swap redrawing its card): follow nothing for it
    hold: useCallback(() => { held.current = true; }, []),
    // the reader sent a question: go to it, and keep up from there
    stick: useCallback(() => {
      following.current = true;
      setPill(false);
    }, []),
    // the pill: down to the newest line
    jump: useCallback(() => {
      following.current = true;
      setPill(false);
      end.current?.scrollIntoView({ block: 'end', behavior: reduced() ? 'auto' : 'smooth' });
    }, [end]),
  };
}
