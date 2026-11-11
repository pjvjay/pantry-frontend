// How long something has been going on, in whole seconds, for the "0:04" beside the words of a
// wait (Build a week for me, Next waiting on a check): counted from when `active` turned true,
// once a second, and 0 while it is not. mealplan/wizard.ts clockText writes it as a clock.
import { useEffect, useState } from 'react';

export function useElapsed(active: boolean): number {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) {
      setSince(null);
      return undefined;
    }
    const start = Date.now();
    setSince(start);
    setNow(start);
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return active && since !== null ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}
