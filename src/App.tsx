import { useEffect, useState } from 'react';
import { getHealth } from './api';
import { getRuntime } from './hub';
import type { Health, RuntimeSettings } from './types';
import AssistantView from './views/AssistantView';
import CatalogView from './views/CatalogView';
import McpView from './views/McpView';
import MetricsView from './views/MetricsView';
import OverviewView from './views/OverviewView';
import PlannerView from './views/PlannerView';
import ProvenanceView from './views/ProvenanceView';
import SimulationsView from './views/SimulationsView';
import SystemView from './views/SystemView';

export type Tab = 'overview' | 'planner' | 'assistant' | 'catalog' | 'provenance' | 'mcp'
  | 'simulations' | 'metrics' | 'system';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'planner', label: 'Planner' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'catalog', label: 'Catalog' },
  { id: 'provenance', label: 'Provenance' },
  { id: 'mcp', label: 'MCP explorer' },
  { id: 'simulations', label: 'Simulations' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'system', label: 'System' },
];

// `#/<tab>` or `#/<tab>?product=<id>`; the hash keeps a tab bookmarkable and survives reloads.
function readHash(): { tab: Tab; product: number | null } {
  const [path, query] = window.location.hash.replace(/^#\/?/, '').split('?');
  const tab = (TABS.find((t) => t.id === path)?.id ?? 'overview') as Tab;
  const product = new URLSearchParams(query ?? '').get('product');
  return { tab, product: product ? Number(product) : null };
}

function HealthChips({ health, runtime }: { health: Health | null; runtime: RuntimeSettings | null }) {
  if (!health) return <span className="chip chip-muted">api: connecting…</span>;
  const demo = runtime ? runtime.demo_mode : health.demo_mode;
  return (
    <span className="health-chips">
      <span className="chip chip-ok" title={`default: ${health.default_model} · escalation: ${health.escalation_model}`}>
        api: {health.status} · {health.routing_strategy}
      </span>
      {demo ? (
        <span className="chip chip-warn" title="Deterministic stand-ins replace the parse & selection LLM calls; switch on the System tab.">
          planner: demo mode — no LLM
        </span>
      ) : (
        <span className="chip model-gemini" title="The planner's LLM; change it on the System tab.">
          planner: {runtime?.models.selector_default ?? health.default_model}
        </span>
      )}
    </span>
  );
}

// The bundle this page runs. After a rebuild, an open tab keeps running the old code until it is
// reloaded, so the page compares this with the bundle the hub now serves and offers a reload.
const BUNDLE_RE = /\/assets\/index-[\w-]+\.js/;
const BUNDLE = BUNDLE_RE.exec(
  document.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/"]')?.src ?? '')?.[0] ?? '';

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

export default function App() {
  const [{ tab, product }, setRoute] = useState(readHash);
  const [health, setHealth] = useState<Health | null>(null);
  const [runtime, setRuntime] = useState<RuntimeSettings | null>(null);
  const stale = useNewBuild();

  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const refresh = () => {
      getHealth().then(setHealth).catch(() => setHealth(null));
      getRuntime().then(setRuntime).catch(() => setRuntime(null));
    };
    refresh();
    const id = window.setInterval(refresh, 15000);
    return () => window.clearInterval(id);
  }, [tab]);

  const go = (t: Tab, query = '') => { window.location.hash = `#/${t}${query}`; };

  return (
    <div className="app">
      <header>
        <div>
          <h1>🥫 Pantry Planner</h1>
          <p className="tagline">
            Agentic grocery planning over MCP —{' '}
            <a href="https://github.com/pjvjay/pantry-platform" target="_blank" rel="noreferrer">how this runs</a>
          </p>
        </div>
        <HealthChips health={health} runtime={runtime} />
      </header>
      <nav className="tabs">
        {TABS.map((t) => (
          <a key={t.id} href={`#/${t.id}`} className={`tab ${tab === t.id ? 'tab-active' : ''}`}>{t.label}</a>
        ))}
      </nav>
      {stale && (
        <div className="banner banner-update">
          A newer build of this console is being served; this tab is still running the old one.{' '}
          <button className="mini" onClick={() => window.location.reload()}>Reload</button>
        </div>
      )}
      {tab === 'overview' && <OverviewView go={(t) => go(t)} />}
      {tab === 'planner' && <PlannerView />}
      {tab === 'assistant' && <AssistantView />}
      {tab === 'catalog' && <CatalogView onLabel={(id) => go('provenance', `?product=${id}`)} />}
      {tab === 'provenance' && <ProvenanceView initialProduct={product} />}
      {tab === 'mcp' && <McpView />}
      {tab === 'simulations' && <SimulationsView />}
      {tab === 'metrics' && <MetricsView />}
      {tab === 'system' && <SystemView />}
      <footer>
        pantry-platform · React → demo hub → pantry API, ContextForge, mcp-sim ·{' '}
        <a href="https://github.com/pjvjay/pantry-gitops" target="_blank" rel="noreferrer">pantry-gitops</a>
      </footer>
    </div>
  );
}
