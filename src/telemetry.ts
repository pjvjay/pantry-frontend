// What the browser itself measures, sent to the hub (POST /hub/telemetry) so frontend slowness
// shows on the Metrics page next to every other layer:
//   page: time to first byte, Largest Contentful Paint, Interaction to Next Paint (the slowest
//         interaction), Cumulative Layout Shift and long tasks (>50 ms blocking the main thread);
//   api:  every /hub and /pantry/api call: its duration and the hub's own time (Server-Timing);
//   chat: one Assistant turn's stream: time to first byte and to the first event, how late each
//         event arrived after the hub sent it, how long the page took to paint it.
// Nothing leaves the machine: the hub stores it next to the traces.
import { fromConsole } from './consoleRequest';

const ENDPOINT = '/hub/telemetry';
const FLUSH_MS = 15_000;

type ApiEntry = { path: string; method: string; status: number; ms: number; server_ms: number | null };

let apiQueue: ApiEntry[] = [];
let installed = false;

// The regular reports say they come from the console, like every other request that posts to
// the hub, so the hub's guard lets them in. The beacon (sent as the page is hidden) cannot carry
// a header at all: the guard has to allow it on this one route.
function send(record: Record<string, unknown>, beacon = false): void {
  const body = JSON.stringify(record);
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    void originalFetch(ENDPOINT, fromConsole({ method: 'POST', body, keepalive: true }))
      .catch(() => undefined);
  } catch {
    /* telemetry never breaks the page */
  }
}

// `hub;dur=12.3` -> 12.3
export function serverTiming(header: string | null): number | null {
  const m = header?.match(/dur=([\d.]+)/);
  return m ? Number(m[1]) : null;
}

const originalFetch: typeof fetch = window.fetch.bind(window);

function flushApi(beacon = false): void {
  if (apiQueue.length === 0) return;
  send({ kind: 'api', entries: apiQueue.slice(0, 200) }, beacon);
  apiQueue = [];
}

function pathOf(input: RequestInfo | URL): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, window.location.href);
  if (url.origin !== window.location.origin) return '';
  // ids and slugs collapse so the metrics group by route
  return url.pathname.replace(/\/tr-[0-9a-f]+/g, '/{trace}').replace(/\/plan\/(?!nl|week)[\w-]+/, '/plan/{slug}');
}

// Every same-origin API call is timed (the chat stream: until its headers arrive).
function installFetchTiming(): void {
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = pathOf(input);
    const timed = path && (path.startsWith('/hub/') || path.includes('/api/')) && path !== ENDPOINT;
    const started = performance.now();
    const res = await originalFetch(input, init);
    if (timed) {
      apiQueue.push({ path, method: (init?.method ?? 'GET').toUpperCase(), status: res.status,
        ms: Math.round(performance.now() - started),
        server_ms: serverTiming(res.headers.get('server-timing')) });
    }
    return res;
  };
}

// Web vitals without a library: the browser's own PerformanceObserver entries.
function observePage(): void {
  const page = { lcp_ms: 0, cls: 0, inp_ms: 0, long_tasks: 0, long_task_ms: 0 };
  // which elements moved, so a layout shift can be fixed rather than just counted
  const shifted = new Map<string, number>();
  const describe = (node: Node | null): string => {
    if (!(node instanceof Element)) return node?.nodeName.toLowerCase() ?? 'unknown';
    const cls = [...node.classList].slice(0, 2).join('.');
    return `${node.tagName.toLowerCase()}${cls ? `.${cls}` : ''}`;
  };
  const observe = (type: string, onEntry: (e: PerformanceEntry) => void, extra: object = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(onEntry))
        .observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    } catch {
      /* not supported in this browser */
    }
  };
  observe('largest-contentful-paint', (e) => { page.lcp_ms = Math.round(e.startTime); });
  observe('layout-shift', (e) => {
    const shift = e as PerformanceEntry & { value: number; hadRecentInput: boolean;
      sources?: { node: Node | null }[] };
    if (shift.hadRecentInput) return;
    page.cls += shift.value;
    for (const source of shift.sources ?? []) {
      const key = describe(source.node);
      shifted.set(key, (shifted.get(key) ?? 0) + shift.value);
    }
  });
  // Interaction to Next Paint: real interactions only (clicks, taps, keys carry an interactionId);
  // pointer moves while the page is busy are not something the shopper waited on.
  observe('event', (e) => {
    if ((e as PerformanceEntry & { interactionId?: number }).interactionId) {
      page.inp_ms = Math.max(page.inp_ms, Math.round(e.duration));
    }
  }, { durationThreshold: 40 });
  observe('longtask', (e) => { page.long_tasks += 1; page.long_task_ms += Math.round(e.duration); });
  // One id per page load: the page reports again whenever its numbers change (an interaction
  // late in a session counts too), and the hub keeps the last report of each load.
  const loadId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let last = '';
  const report = (beacon: boolean) => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const now = JSON.stringify({ ...page, n: shifted.size });
    if (now === last) return;
    last = now;
    send({
      kind: 'page', load_id: loadId, path: window.location.hash || '/',
      ttfb_ms: nav ? Math.round(nav.responseStart) : null,
      dom_ready_ms: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      load_ms: nav ? Math.round(nav.loadEventEnd) : null,
      ...page, cls: Math.round(page.cls * 1000) / 1000,
      cls_sources: [...shifted.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([node, value]) => ({ node, value: Math.round(value * 1000) / 1000 })),
    }, beacon);
  };
  window.setTimeout(() => report(false), 20_000);
  window.setInterval(() => report(false), 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { report(true); flushApi(true); }
  });
}

export function installTelemetry(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  installFetchTiming();
  observePage();
  window.setInterval(() => flushApi(false), FLUSH_MS);
}

const p95 = (xs: number[]) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)))]);
};

// One Assistant turn's stream, measured as it arrives; `finish` sends it, joined to its trace.
export class ChatMeter {
  private started = performance.now();
  private ttfb: number | null = null;
  private first: number | null = null;
  private lags: number[] = [];
  private renders: number[] = [];
  private events = 0;
  private model: string;
  traceId = '';

  constructor(model: string) { this.model = model; }

  opened(): void { this.ttfb = performance.now() - this.started; }

  event(e: { at?: number; trace_id?: string }): void {
    const received = performance.now();
    this.events += 1;
    if (this.first == null) this.first = received - this.started;
    if (e.trace_id) this.traceId = e.trace_id;
    if (typeof e.at === 'number') this.lags.push(Math.max(0, Date.now() - e.at));
    // the next frame after this event's state update: how long the page took to show it. A
    // hidden page paints nothing (frames wait until it is shown), so it measures nothing.
    if (document.visibilityState !== 'visible') return;
    requestAnimationFrame(() => {
      if (document.visibilityState === 'visible') this.renders.push(performance.now() - received);
    });
  }

  finish(outcome: string): void {
    if (!this.traceId) return;
    send({
      kind: 'chat', trace_id: this.traceId, model: this.model, outcome, events: this.events,
      ttfb_ms: this.ttfb == null ? null : Math.round(this.ttfb),
      first_event_ms: this.first == null ? null : Math.round(this.first),
      lag_p95_ms: p95(this.lags), lag_max_ms: this.lags.length ? Math.round(Math.max(...this.lags)) : null,
      render_p95_ms: p95(this.renders),
      total_ms: Math.round(performance.now() - this.started),
    });
  }
}
