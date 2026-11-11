// The console's frame, which App.tsx puts around every page (styles/shell.css):
//
//   ShellHeader  the wordmark (home), the way into the Workshop, the status of the services behind
//                the page as one dot and a few words that open into a line per service, and the
//                theme menu. On a phone it is one row: the wordmark (its cart alone when the row
//                has no room for its name), the Workshop's wrench, the dot with a short word, and
//                the theme as one button that opens its list.
//   PrimaryNav   the household's four places, Home, Plan, Shop and Ask: a row under the header on
//                a wide screen, a bar along the bottom of a phone's screen (its height is
//                --bottom-nav-h, which everything fixed or sticky at the bottom keeps clear of).
//                Shop carries the number of approved trips once there is one.
//   ShellFooter  where the plan is kept, which build this is, and how the console works.
//
// The current place is marked with aria-current="page", and shown by more than colour: weight
// and an underline in the row, weight and a filled pill behind the icon in the bar.
import { useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent } from 'react';

import { getHealth } from '../api';
import { getRuntime } from '../hub';
import { useHubStatus } from '../hubStatus';
import { useMealPlan } from '../mealplan/store';
import { PRIMARY, hrefFor, sectionOf } from '../routes';
import type { Route, Section } from '../routes';
import { API_POLL_S, apiLine, hubLine, plannerLine, statusSummary } from '../status';
import type { ApiState } from '../status';
import type { Health, RuntimeSettings } from '../types';
import { Icon } from './icons';
import type { IconName } from './icons';
import { ThemeMenu } from './ThemeMenu';

const PLACE_ICONS: Record<Exclude<Section, 'workshop'>, IconName> = {
  home: 'home', plan: 'plan', shop: 'bag', ask: 'chat',
};

// pantry-api's health and the planner's runtime settings, asked when the page opens and every
// 15 s after, whatever page is showing (never again on each page change). A failure after an
// answer keeps that answer for the details, and says the API is offline until it answers again.
function useApiHealth(): { state: ApiState; health: Health | null; runtime: RuntimeSettings | null } {
  const [health, setHealth] = useState<Health | null>(null);
  const [offline, setOffline] = useState(false);
  const [runtime, setRuntime] = useState<RuntimeSettings | null>(null);
  useEffect(() => {
    let live = true;
    const refresh = () => {
      getHealth()
        .then((h) => { if (live) { setHealth(h); setOffline(false); } })
        .catch(() => { if (live) setOffline(true); });
      getRuntime()
        .then((r) => { if (live) setRuntime(r); })
        .catch(() => { if (live) setRuntime(null); });
    };
    refresh();
    const id = window.setInterval(refresh, API_POLL_S * 1000);
    return () => { live = false; window.clearInterval(id); };
  }, []);
  return { state: offline ? 'offline' : health ? 'ok' : 'connecting', health, runtime };
}

// One dot and a few words; pressed, a line for each service and the way to Workshop › System.
// It is a disclosure: the lines follow the button, so Tab goes through them in order. The lines
// lie over the page, so they close as soon as they could hide what the shopper moves on to: when
// focus leaves them for anything else, on a press anywhere else, and on a change of page. Escape
// closes them too, and brings focus back to the button only when focus was inside them; from
// anywhere else it leaves focus where it is.
function StatusCluster() {
  const api = useApiHealth();
  const hub = useHubStatus();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const { words, short, tone } = statusSummary(api.state, hub.state);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const inside = box.current?.contains(document.activeElement) ?? false;
      setOpen(false);
      if (inside) button.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onPlace = () => setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('hashchange', onPlace);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('hashchange', onPlace);
    };
  }, [open]);

  // Focus moved on to something outside (Tab, Shift+Tab, a page moving focus itself). A blur with
  // nowhere to go (a press on the panel's own words, the window losing focus) is not leaving: a
  // press outside is the pointer handler's.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (next instanceof Node && !e.currentTarget.contains(next)) setOpen(false);
  };

  // The panel and its link go as System opens, so the keyboard starts at the top of the page it
  // opened instead of nowhere.
  const openSystem = () => {
    setOpen(false);
    document.getElementById('main')?.focus({ preventScroll: true });
  };

  return (
    <div className="status" ref={box} onBlur={onBlur}>
      <button ref={button} type="button" className="btn btn-secondary btn-sm status-btn"
              aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <span className={`status-dot status-dot-${tone}`} aria-hidden="true" />
        <span className="sr-only">Status: </span>
        {/* a phone shows the short word, which is part of the words a screen reader hears */}
        <span className="status-words">{words}</span>
        <span className="status-short" aria-hidden="true">{short}</span>
        <Icon name="chevron-down" size={16} className="status-chev" />
      </button>
      <div id={panelId} className="status-pop" hidden={!open}>
        <dl className="status-lines">
          <div className="status-line">
            <dt>Pantry API</dt>
            <dd>{apiLine(api.state, api.health)}</dd>
          </div>
          <div className="status-line">
            <dt>Planner</dt>
            <dd>{plannerLine(api.health, api.runtime)}</dd>
          </div>
          <div className="status-line">
            <dt>Demo hub</dt>
            <dd>
              {hubLine(hub.state, hub.status)}
              {hub.reason && <span className="status-why">{hub.reason}</span>}
            </dd>
          </div>
        </dl>
        <div className="status-foot">
          <p>The meal plan needs only the pantry API; the Assistant and the Workshop’s live tools need the demo hub.</p>
          <a className="btn btn-secondary btn-sm" href={hrefFor({ name: 'workshop', tab: 'system' })} onClick={openSystem}>
            <Icon name="wrench" size={16} />Open System
          </a>
        </div>
      </div>
    </div>
  );
}

// In the order it is read and tabbed through at every width (styles/shell.css moves nothing out of
// it): the wordmark and the Workshop, the two places, then the status and the theme menu.
export function ShellHeader({ route }: { route: Route }) {
  const inWorkshop = route.name === 'workshop';
  return (
    <header className="shell-head">
      <h1 className="wordmark">
        <a className="wordmark-link" href={hrefFor({ name: 'home' })}>
          <Icon name="cart" size={28} /><span className="wordmark-word">Pantry Planner</span>
        </a>
      </h1>
      <a className="ws-link" href={hrefFor({ name: 'workshop', tab: 'catalog' })}
         aria-current={inWorkshop ? 'page' : undefined}>
        <Icon name="wrench" size={20} />
        <span className="ws-link-word">Workshop</span>
      </a>
      <StatusCluster />
      <ThemeMenu />
    </header>
  );
}

export function PrimaryNav({ route }: { route: Route }) {
  const mp = useMealPlan();
  const trips = mp.state.draft.trips.length;
  const here = sectionOf(route);
  return (
    <nav className="pnav" aria-label="Main">
      <ul className="pnav-list">
        {PRIMARY.map(({ section, label }) => (
          <li key={section}>
            <a className="pnav-link" href={hrefFor({ name: section })}
               aria-current={here === section ? 'page' : undefined}>
              <span className="pnav-icon"><Icon name={PLACE_ICONS[section]} size={22} /></span>
              <span className="pnav-label">{label}</span>
              {section === 'shop' && trips > 0 && (
                <span className="pnav-badge">
                  <span aria-hidden="true">{trips}</span>
                  <span className="sr-only">, {trips} approved {trips === 1 ? 'trip' : 'trips'}</span>
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function ShellFooter({ build }: { build: string }) {
  return (
    <footer className="shell-foot">
      Saved in this browser only · {build} ·{' '}
      <a href={hrefFor({ name: 'workshop', tab: 'about' })}>How this works</a>
    </footer>
  );
}
