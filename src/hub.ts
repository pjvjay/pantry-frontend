// The demo hub (pantry-platform/demo-hub) and the pantry endpoints only the demo console uses.
// The hub serves this app, proxies /pantry/api to pantry-api, and adds /hub/* for the MCP
// explorer, the Assistant, the simulations and the system page. Secrets stay in the hub.
import type {
  AgentEvent,
  AgentOptions,
  HubStatus,
  McpCatalog,
  McpTarget,
  Metrics,
  PlanExecution,
  Product,
  RunDetail,
  RuntimeSettings,
  ShoppingPlan,
  ToolResult,
  Trace,
  TraceSummary,
  WeekPlan,
} from './types';
import { PlanAbortError } from './api';
import { fromConsole } from './consoleRequest';

const API = `${import.meta.env.BASE_URL}api`;
const HUB = '/hub';

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, fromConsole(init));
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 409 && detail && typeof detail === 'object' && 'aborted' in detail) {
      throw new PlanAbortError(detail as PlanExecution);
    }
    const text = typeof detail === 'string' ? detail
      : detail ? JSON.stringify(detail) : `${res.status} ${res.statusText}`;
    throw new Error(text);
  }
  return res.json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

// ─── pantry REST, with every option the API takes ─────────────

export interface NLOptions {
  lat?: number | null;
  lon?: number | null;
  max_km?: number | null;
  allow_partial?: boolean;
  exclude_origin?: string[];
  preference?: string[];
}

export const planNLWith = (recipe_text: string, o: NLOptions) =>
  json<ShoppingPlan>(`${API}/plan/nl`, post({ recipe_text, ...o }));

export interface WeekOptions {
  days: number;
  max_total_budget?: number | null;
  exclude_tags?: string[];
  max_distance_km?: number | null;
  exclude_origin?: string[];
  preference?: string[];
}

export const planWeekWith = (o: WeekOptions) => json<WeekPlan>(`${API}/plan/week`, post(o));

export const planRecipeWith = (slug: string, exclude: string[], preference: string[],
                               location: { lat: number | null; lon: number | null; max_km: number | null } = { lat: null, lon: null, max_km: null }) => {
  const q = new URLSearchParams();
  exclude.forEach((c) => q.append('exclude_origin', c));
  preference.forEach((c) => q.append('preference', c));
  // Any of these makes the plan store-aware: each line at its cheapest store in range, plus trips.
  if (location.lat != null) q.set('lat', String(location.lat));
  if (location.lon != null) q.set('lon', String(location.lon));
  if (location.max_km != null) q.set('max_km', String(location.max_km));
  const qs = q.toString();
  return json<ShoppingPlan>(`${API}/plan/${slug}${qs ? `?${qs}` : ''}`, { method: 'POST' });
};

export const getProducts = () => json<Product[]>(`${API}/products`);
export const getRuntime = () => json<RuntimeSettings>(`${API}/settings/runtime`);
export const setRuntime = (patch: Partial<Pick<RuntimeSettings, 'demo_mode' | 'models'>>) =>
  json<RuntimeSettings>(`${API}/settings/runtime`, post(patch));

// ─── hub ──────────────────────────────────────────────────────

export const getStatus = () => json<HubStatus>(`${HUB}/status`);
export const resetDemo = () => json<{ ok: boolean; output: string }>(`${HUB}/demo/reset`,
  { method: 'POST' });

export const mcpTargets = () => json<McpTarget[]>(`${HUB}/mcp/targets`);
export const mcpCatalog = (target: string) => json<McpCatalog>(`${HUB}/mcp/${target}/catalog`);
export const mcpCall = (target: string, tool: string, args: Record<string, unknown>) =>
  json<ToolResult>(`${HUB}/mcp/${target}/call`, post({ tool, arguments: args }));
export const mcpRead = (target: string, uri: string) =>
  json<{ uri: string; contents: { uri: string; text?: string; mimeType?: string }[] }>(
    `${HUB}/mcp/${target}/read`, post({ uri }));
export const mcpPrompt = (target: string, name: string, args: Record<string, string>) =>
  json<{ description?: string; messages: { role: string; content: { type: string; text?: string } }[] }>(
    `${HUB}/mcp/${target}/prompt`, post({ name, arguments: args }));

// A pantry tool's structured result; throws with the tool's own message when it failed.
export async function pantryTool<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await mcpCall('pantry', tool, args);
  if (r.is_error) throw new Error(r.text || `${tool} failed`);
  return r.structured as T;
}

export const agentOptions = () => json<AgentOptions>(`${HUB}/agent/options`);

// A local model reads the Assistant's instructions and first tools now, while the shopper types,
// so the first step reads only the question. Resolves when it has (minutes on a CPU).
export interface WarmResult { model?: string; wall_s?: number; prompt_tokens?: number;
  prompt_s?: number; load_s?: number; skipped?: string }
export const agentWarm = (body: { model: string; target: string; disclosure?: string }) =>
  json<WarmResult>(`${HUB}/agent/warm`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });

// One Assistant turn, streamed: the hub answers with server-sent events (one JSON per event).
export async function agentChat(
  body: { message: string; conversation_id?: string | null; model: string; target: string;
          disclosure?: string },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
  onOpen?: () => void,
): Promise<void> {
  const res = await fetch(`${HUB}/agent/chat`, fromConsole({ ...post(body), signal }));
  onOpen?.();
  if (!res.ok || !res.body) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* keep the status */
    }
    throw new Error(detail);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (line) onEvent(JSON.parse(line.slice(6)) as AgentEvent);
    }
  }
}

// Traces of Assistant turns and the metrics rolled up from them (every layer, the browser's too).
export const traceList = (limit = 50) => json<TraceSummary[]>(`${HUB}/traces?limit=${limit}`);
export const traceDetail = (id: string) => json<Trace>(`${HUB}/traces/${encodeURIComponent(id)}`);
export const getMetrics = () => json<Metrics>(`${HUB}/metrics`);
export const runDetail = (id: string) => json<RunDetail>(`${HUB}/runs/${encodeURIComponent(id)}`);

// Pictures, fetched once by the hub and served from its cache: an ingredient's Wikipedia
// thumbnail, and an image from a recipe page.
export const ingredientImage = (name: string) =>
  `${HUB}/images/ingredient?name=${encodeURIComponent(name)}`;
export const remoteImage = (url: string) => `${HUB}/images/remote?url=${encodeURIComponent(url)}`;

export const simPresets = () =>
  json<{ presets: Record<string, { label: string; models: Record<string, string> }>;
         runner_url: string }>(`${HUB}/sims/presets`);
export const simScenarios = () => json<{ scenarios: Record<string, unknown>[];
  categories: { name: string; total: number; counts: Record<string, number> }[] }>(
  `${HUB}/sims/scenarios`);
export const simScenario = (name: string) => json<Record<string, unknown>>(
  `${HUB}/sims/scenarios/${encodeURIComponent(name)}`);
export const simRun = (name: string, runId: string) => json<Record<string, unknown>>(
  `${HUB}/sims/runs/${encodeURIComponent(name)}/${encodeURIComponent(runId)}`);
export const simTranscript = (name: string, runId: string, file: string) =>
  json<Record<string, unknown>>(`${HUB}/sims/runs/${encodeURIComponent(name)}/`
    + `${encodeURIComponent(runId)}/transcripts/${encodeURIComponent(file)}`);
export const simStart = (scenarios: string[] | 'all', preset: string) =>
  json<{ job_id: string; scenarios: string[] }>(`${HUB}/sims/run`, post({ scenarios, preset }));
export const simJob = (id: string) => json<Record<string, unknown>>(`${HUB}/sims/jobs/${id}`);
export const simCancel = (id: string) => json<Record<string, unknown>>(
  `${HUB}/sims/jobs/${id}/cancel`, { method: 'POST' });
