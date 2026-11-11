// The demo hub's status, asked once for the whole console: when the page opens, every 30 s while
// the page is in view, when the window gets focus again, and at once after a hub call failed as
// if the hub were down (hub.ts onHubTrouble). Never per page or tab change. The header, the
// Workshop, the Assistant, address search, the stores map, recipe import and the System page all
// read this one answer through useHubStatus, so they never disagree with each other.
//
// It is `connecting` until the first answer, then `ok`, `refused` (401 or 403: the hub's guard
// said no, as on the public demo, where the header says "Hub paused") or `unreachable` (nothing
// answered, or a proxy found nothing behind it). While a check runs, the last state stays on
// screen, so a page never flickers back to "Connecting…".
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { HubError, getStatus, onHubTrouble } from './hub';
import { hubMessage, hubStateOf } from './status';
import type { HubState } from './status';
import type { HubStatus } from './types';

const POLL_MS = 30_000;
// Several hub calls failing together (a page loading) ask for one check, not one each.
const TROUBLE_GAP_MS = 3_000;

export interface HubStatusApi {
  state: HubState;
  ok: boolean;
  // the hub's last answer; null until it answers and whenever it does not
  status: HubStatus | null;
  // plain words when the hub is refusing or not there; '' otherwise
  message: string;
  // what the hub itself said (its guard's sentence), or the HTTP status: for the details
  reason: string | null;
  checking: boolean;
  checkedAt: number | null;
  // check now; resolves with the state it found
  refresh: () => Promise<HubState>;
}

interface Seen {
  state: HubState;
  status: HubStatus | null;
  reason: string | null;
  checkedAt: number | null;
}

const HubStatusContext = createContext<HubStatusApi | null>(null);

export function useHubStatus(): HubStatusApi {
  const api = useContext(HubStatusContext);
  if (!api) throw new Error('useHubStatus needs a <HubStatusProvider> above it');
  return api;
}

// What a failed check says: refused or unreachable, and in whose words.
function failed(e: unknown): Omit<Seen, 'checkedAt'> {
  if (e instanceof HubError) {
    return { state: hubStateOf(e.status), status: null,
      reason: e.reason ?? (e.status ? `HTTP ${e.status}` : 'No answer') };
  }
  // an answer that is not the hub's (a static host answering every path with its own page)
  return { state: 'unreachable', status: null, reason: 'The answer was not from a demo hub' };
}

export function HubStatusProvider({ children }: { children: ReactNode }) {
  const [seen, setSeen] = useState<Seen>({ state: 'connecting', status: null, reason: null, checkedAt: null });
  const [checking, setChecking] = useState(false);
  const inFlight = useRef<Promise<HubState> | null>(null);
  const lastCheck = useRef(0);

  const refresh = useCallback((): Promise<HubState> => {
    if (inFlight.current) return inFlight.current;
    lastCheck.current = Date.now();
    setChecking(true);
    const check = getStatus()
      .then((status): Omit<Seen, 'checkedAt'> => ({ state: 'ok', status, reason: null }), failed)
      .then((next) => {
        setSeen((prev) => ({
          ...next,
          // the same answer keeps its identity, so what depends on it does not run again
          status: next.status && prev.status && JSON.stringify(next.status) === JSON.stringify(prev.status)
            ? prev.status : next.status,
          checkedAt: Date.now(),
        }));
        return next.state;
      })
      .finally(() => {
        inFlight.current = null;
        setChecking(false);
      });
    inFlight.current = check;
    return check;
  }, []);

  useEffect(() => {
    void refresh();
    const poll = window.setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    const off = onHubTrouble(() => {
      if (Date.now() - lastCheck.current > TROUBLE_GAP_MS) void refresh();
    });
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', onFocus);
      off();
    };
  }, [refresh]);

  const api = useMemo<HubStatusApi>(() => ({
    ...seen, ok: seen.state === 'ok', message: hubMessage(seen.state), checking, refresh,
  }), [seen, checking, refresh]);

  return <HubStatusContext.Provider value={api}>{children}</HubStatusContext.Provider>;
}
