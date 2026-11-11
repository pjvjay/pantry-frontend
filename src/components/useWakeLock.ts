// Keeps the screen on while in-store mode is open, so the list does not go dark between aisles
// (the Screen Wake Lock API). Asked for when the page opens and again whenever it comes back into
// view, since the browser lets the lock go when the tab is hidden; let go when the page closes.
// Where the browser has no such thing, or refuses it (low battery, a page not in view, a browser
// that asks first), nothing happens and the screen sleeps as it always does. `held` says whether
// the screen is being kept on now, for a page that wants to say so.
import { useEffect, useState } from 'react';

export function useWakeLock(active: boolean): { held: boolean } {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return undefined;
    let live = true;
    let lock: WakeLockSentinel | null = null;
    const ask = async () => {
      if (lock || document.visibilityState !== 'visible') return;
      try {
        const got = await navigator.wakeLock.request('screen');
        if (!live) {
          void got.release().catch(() => undefined);
          return;
        }
        lock = got;
        setHeld(true);
        got.addEventListener('release', () => {
          if (lock === got) lock = null;
          if (live) setHeld(false);
        });
      } catch {
        // refused: the screen sleeps as usual
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void ask();
    };
    void ask();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
      const was = lock;
      lock = null;
      if (was) void was.release().catch(() => undefined);
      setHeld(false);
    };
  }, [active]);
  return { held };
}
