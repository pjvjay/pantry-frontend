// The console: the shell (components/nav.tsx) around the page the address names (routes.ts).
//
//   #/home          Home
//   #/plan          the meal plan's six stages
//   #/shop          the shopping plan on its own (#/shop/trip/<date>: one trip; it shows the
//                   shopping plan until in-store mode exists)
//   #/ask           the Assistant
//   #/workshop/…    the Workshop: the Catalog, Provenance, the MCP explorer, Simulations, Metrics,
//                   System, the Planner lab and About
//
// An old address (#/mealplan, #/assistant, #/catalog, …) or one the console does not know is
// rewritten in place to the page's own, so the browser's Back never lands on it again.
//
// Above every page, so nothing is lost by moving between them: the toasts, the demo hub's one
// shared status, and the meal plan with its undo (the Planner lab and the Assistant both open a
// week in it, and Shop is the same plan).
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import { PrimaryNav, ShellFooter, ShellHeader } from './components/nav';
import { Notice, Skeleton, ToastProvider } from './components/ui';
import { HubStatusProvider } from './hubStatus';
import { MealPlanProvider } from './mealplan/store';
import { ROUTE_IDS, arrivalFor, hrefFor, parseHash, sectionOf, titleFor } from './routes';
import type { Route } from './routes';
import AssistantView from './views/AssistantView';
import HomeView from './views/HomeView';
import WorkshopView from './views/WorkshopView';

// The meal plan's views load when Plan or Shop is first opened; its plan and store are above
// every page.
const MealPlanView = lazy(() => import('./views/MealPlanView'));

// The page the address names. An old or unknown address becomes the page's own in place
// (replaceState: no history entry, and no hashchange, so what reads the hash after this reads
// the new one).
function readRoute(): Route {
  const hash = window.location.hash;
  const route = parseHash(hash);
  const href = hrefFor(route);
  if (href !== hash) window.history.replaceState(window.history.state, '', href);
  return route;
}

// The bundle this page runs. After a rebuild, an open tab keeps running the old code until it is
// reloaded, so the page compares this with the bundle the hub now serves and offers a reload.
const BUNDLE_RE = /\/assets\/index-([\w-]+)\.js/;
const BUNDLE_MATCH = BUNDLE_RE.exec(
  document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src ?? '');
const BUNDLE = BUNDLE_MATCH?.[0] ?? '';
// What the footer calls this build: its bundle's hash, or the dev server's.
const BUILD = BUNDLE_MATCH ? `build ${BUNDLE_MATCH[1]}` : 'development build';

function useNewBuild() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!BUNDLE) return;   // the Vite dev server reloads by itself
    const check = () => {
      fetch(import.meta.env.BASE_URL, { cache: 'no-store' })
        .then((r) => r.text())
        .then((page) => {
          const served = BUNDLE_RE.exec(page)?.[0];
          if (served && served !== BUNDLE) setStale(true);
        })
        .catch(() => undefined);
    };
    const id = window.setInterval(check, 30000);
    window.addEventListener('focus', check);
    return () => { window.clearInterval(id); window.removeEventListener('focus', check); };
  }, []);
  return stale;
}

function Loading({ what }: { what: string }) {
  return <div className="view"><Skeleton kind="card" count={3} label={`Loading ${what}`} /></div>;
}

export default function App() {
  const [route, setRoute] = useState(readRoute);
  const stale = useNewBuild();
  // The Assistant stays mounted once opened: its conversation survives a trip to another page
  // (a meal-plan card's "Open in Meal plan", say) and back. Never opened, it is not mounted, so
  // a local model is not asked to warm up for a page nobody used.
  const [assistantOpened, setAssistantOpened] = useState(route.name === 'ask');
  useEffect(() => { if (route.name === 'ask') setAssistantOpened(true); }, [route.name]);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => { document.title = titleFor(route); }, [route]);

  // A new place opens at its top, and a screen reader hears where it now is ("System, Workshop"):
  // focus stays on the link that was pressed, which is there on every page, and most screen
  // readers do not read out a new title. A change within a place (a stage, a trace) leaves the
  // page where it is, and the view moves focus itself where it needs to.
  const place = route.name === 'workshop' ? `workshop/${route.tab}` : sectionOf(route);
  const shownPlace = useRef(place);
  const [arrived, setArrived] = useState('');
  useEffect(() => {
    if (shownPlace.current === place) return;
    shownPlace.current = place;
    window.scrollTo(0, 0);
    setArrived(arrivalFor(route));
    // the route of this place is the one just drawn; `place` is what changes
  }, [place]);

  const skip = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById('main')?.focus();
  };

  return (
    <ToastProvider>
      <HubStatusProvider>
        <MealPlanProvider>
          <div className="app">
            <a className="skip-link" href="#main" onClick={skip}>Skip to content</a>
            {/* on the page from the start, so a change of place is heard (a polite live region) */}
            <p className="sr-only" role="status">{arrived}</p>
            <ShellHeader route={route} />
            <PrimaryNav route={route} />
            {stale && (
              <Notice tone="info" title="A newer build of this console is out"
                      actions={[{ label: 'Reload', icon: 'refresh', onClick: () => window.location.reload() }]}>
                This tab is still running the old one.
              </Notice>
            )}
            <main id="main" className="shell-main" tabIndex={-1}>
              {route.name === 'home' && <HomeView />}
              {route.name === 'plan' && (
                <Suspense fallback={<Loading what="the meal plan" />}>
                  <MealPlanView mode="plan" />
                </Suspense>
              )}
              {sectionOf(route) === 'shop' && (
                <Suspense fallback={<Loading what="the shopping plan" />}>
                  <MealPlanView mode="shop" />
                </Suspense>
              )}
              {assistantOpened && (
                <div hidden={route.name !== 'ask'}>
                  <AssistantView routes={ROUTE_IDS} active={route.name === 'ask'} />
                </div>
              )}
              {route.name === 'workshop' && <WorkshopView tab={route.tab} query={route.query ?? ''} />}
            </main>
            <ShellFooter build={BUILD} />
          </div>
        </MealPlanProvider>
      </HubStatusProvider>
    </ToastProvider>
  );
}
