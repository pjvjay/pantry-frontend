// The Workshop: the parts under the hood, for the curious and for whoever runs the demo. One row
// of tabs (on a phone it scrolls sideways and never wraps) over the page it names: the Catalog,
// Provenance, the MCP explorer, Simulations, Metrics, System, the Planner lab (the one-off
// planner) and About (how it all fits).
//
// While the demo hub is refusing or not there, the pages that need it show one panel at the top
// (OfflinePanel: what that turns off here, what still works, Retry, Open System) instead of a red
// banner from every call that failed; their own banners stay for failures with the hub up. When
// the hub answers again, the page under the tabs is drawn afresh, so what it could not load, it
// loads now. The Planner lab and About need no hub and show no panel.
import { useEffect, useRef, useState } from 'react';
import type { FocusEvent } from 'react';

import { Icon } from '../components/icons';
import { OfflinePanel } from '../components/ui';
import { useHubStatus } from '../hubStatus';
import { WORKSHOP_TABS, hrefFor } from '../routes';
import type { WorkshopTab } from '../routes';
import AboutView from './AboutView';
import CatalogView from './CatalogView';
import McpView from './McpView';
import MetricsView from './MetricsView';
import PlannerView from './PlannerView';
import ProvenanceView from './ProvenanceView';
import SimulationsView from './SimulationsView';
import SystemView from './SystemView';

// What each page cannot do without the hub, and what it still can.
const NEEDS_HUB: Partial<Record<WorkshopTab, { off: string; works: string }>> = {
  catalog: {
    off: 'The planner’s lookup and each product’s details come through the demo hub, so they are off here.',
    works: 'the catalog table and its filters, and the Planner lab.',
  },
  provenance: {
    off: 'Origin coverage, label readings, the review queue and triage go through the demo hub, so they are off here.',
    works: 'ranking the catalog by origin, at the bottom of this page.',
  },
  mcp: {
    off: 'The MCP explorer reaches the servers through the demo hub, so it is off here.',
    works: 'the catalog table and the Planner lab, which call the pantry API directly.',
  },
  simulations: {
    off: 'Simulations are run and kept by the demo hub, so they are off here.',
    works: 'the meal plan, the catalog table and the Planner lab.',
  },
  metrics: {
    off: 'The demo hub records the Assistant’s runs, so metrics are off here.',
    works: 'the meal plan, the catalog table and the Planner lab.',
  },
  system: {
    off: 'The list of services comes from the demo hub, so it is off here.',
    works: 'the planner’s LLM switch below, which talks to the pantry API.',
  },
};

export default function WorkshopView({ tab, query }: { tab: WorkshopTab; query: string }) {
  const hub = useHubStatus();
  const product = Number(new URLSearchParams(query).get('product')) || null;
  const bar = useRef<HTMLElement>(null);
  const current = useRef<HTMLAnchorElement>(null);

  // The open tab in view in the bar, scrolling the bar sideways only (never the page).
  useEffect(() => {
    const b = bar.current;
    const t = current.current;
    if (!b || !t) return;
    if (t.offsetLeft < b.scrollLeft || t.offsetLeft + t.offsetWidth > b.scrollLeft + b.clientWidth) {
      b.scrollLeft = Math.max(0, t.offsetLeft - 16);
    }
  }, [tab]);

  // A tab the keyboard reaches comes fully into view in the bar, its focus ring too (the bar's
  // scroll-padding leaves room for it): the browser itself leaves a tab that is half out of the
  // bar where it is, cut at the edge.
  const showFocused = (e: FocusEvent<HTMLElement>) => {
    if (e.target instanceof HTMLElement && e.target.classList.contains('ws-tab')) {
      e.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  };

  // Drawn afresh each time the hub comes back, so a page that failed to load loads now.
  const [generation, setGeneration] = useState(0);
  const wasOff = useRef(false);
  useEffect(() => {
    if (hub.state === 'refused' || hub.state === 'unreachable') wasOff.current = true;
    else if (hub.state === 'ok' && wasOff.current) {
      wasOff.current = false;
      setGeneration((g) => g + 1);
    }
  }, [hub.state]);

  const needs = NEEDS_HUB[tab];
  const toProvenance = (id: number) => {
    window.location.hash = hrefFor({ name: 'workshop', tab: 'provenance', query: `product=${id}` });
  };

  return (
    <div className="workshop">
      <div className="ws-head">
        <h2 className="ws-title"><Icon name="wrench" />Workshop</h2>
        <p className="ws-sub">How the planner works under the hood, and the tools that run the demo.</p>
      </div>
      <nav ref={bar} className="ws-tabs" aria-label="Workshop" onFocus={showFocused}>
        <ul>
          {WORKSHOP_TABS.map((t) => (
            <li key={t.id}>
              <a ref={t.id === tab ? current : undefined} className="ws-tab"
                 href={hrefFor({ name: 'workshop', tab: t.id })} aria-current={t.id === tab ? 'page' : undefined}>
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      {needs && <OfflinePanel off={needs.off} works={needs.works} systemLink={tab !== 'system'} />}
      <div key={generation}>
        {tab === 'catalog' && <CatalogView onLabel={toProvenance} />}
        {tab === 'provenance' && <ProvenanceView initialProduct={product} />}
        {tab === 'mcp' && <McpView />}
        {tab === 'simulations' && <SimulationsView />}
        {tab === 'metrics' && <MetricsView />}
        {tab === 'system' && <SystemView />}
        {tab === 'planner' && <PlannerView />}
        {tab === 'about' && <AboutView />}
      </div>
    </div>
  );
}
