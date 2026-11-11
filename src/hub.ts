// The demo hub (pantry-platform/demo-hub) and the pantry endpoints only the demo console uses.
// The hub serves this app, proxies /pantry/api to pantry-api, and adds /hub/* for the MCP
// explorer, the Assistant, the simulations and the system page. Secrets stay in the hub.
import type {
  AgentEvent,
  AgentOptions,
  AlternativeRanking,
  CalendarApplyResult,
  CalendarDiff,
  CalendarDisconnectResult,
  CalendarSyncRequest,
  CalendarSyncStatus,
  GeocodeAnswer,
  HubStatus,
  ImportResult,
  McpCatalog,
  McpTarget,
  Metrics,
  PlanExecution,
  Product,
  RecipeDoc,
  RunDetail,
  RuntimeSettings,
  ShoppingPlan,
  SwapResult,
  ToolResult,
  Trace,
  TraceSummary,
  WeekPlan,
} from './types';
import { PlanAbortError } from './api';
import type { MealPlanContext } from './mealplan/chatDraft';
import { fromConsole } from './consoleRequest';
import { HUB_DOWN, HUB_REFUSED, plainHubError } from './status';

const API = `${import.meta.env.BASE_URL}api`;
const HUB = '/hub';

// A refusal from the hub, with the status and the detail as sent: routes that name a reason
// send {code, message, ...}, which the caller can switch on (recipe import does). The message is
// the route's own words when it gave some, and otherwise plain ones (status.ts): "The demo hub is
// not open to this page" for the hub's guard (401 or 403), "The demo hub is not running" when
// nothing answered (status 0) or a proxy found no hub behind it. `reason` is the guard's own
// sentence, kept for whoever shows the details (the status in the header does).
export class HubError extends Error {
  status: number;
  detail: unknown;
  reason: string | null;

  constructor(message: string, status: number, detail: unknown, reason: string | null = null) {
    super(message);
    this.name = 'HubError';
    this.status = status;
    this.detail = detail;
    this.reason = reason;
  }
}

// Told whenever a call to the hub fails in a way that says the hub itself is refusing or not
// there, so the shared status (hubStatus.tsx) checks again now rather than at its next poll, and
// every page agrees with the header. The status call itself does not tell: it is the check.
const troubleListeners = new Set<() => void>();
export function onHubTrouble(listener: () => void): () => void {
  troubleListeners.add(listener);
  return () => { troubleListeners.delete(listener); };
}
function hubTrouble(url: string) {
  if (url.startsWith(`${HUB}/`) && !url.startsWith(`${HUB}/status`)) troubleListeners.forEach((f) => f());
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

// A request; a hub that does not answer at all is a HubError with status 0, in plain words.
async function send(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, fromConsole(init));
  } catch (e) {
    if (isAbort(e) || !url.startsWith(`${HUB}/`)) throw e;
    hubTrouble(url);
    throw new HubError(HUB_DOWN, 0, null);
  }
}

// A failed answer's HubError. The hub's guard answers 403 {reason} for /hub/* and for
// /pantry/api/* alike where the hub stands in front of pantry-api; a route answers {detail}.
async function failure(url: string, res: Response): Promise<Error> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error body */
  }
  const b = body && typeof body === 'object' ? body as { detail?: unknown; reason?: unknown } : {};
  const detail = b.detail === '' ? null : b.detail ?? null;
  const reason = typeof b.reason === 'string' ? b.reason : null;
  if (res.status === 409 && detail && typeof detail === 'object' && 'aborted' in detail) {
    return new PlanAbortError(detail as PlanExecution);
  }
  const plain = url.startsWith(`${HUB}/`) ? plainHubError(res.status, detail)
    : (res.status === 401 || res.status === 403) && reason ? HUB_REFUSED : null;
  if (plain) hubTrouble(url);
  return new HubError(said(detail) ?? plain ?? `${res.status} ${res.statusText}`, res.status, detail, reason);
}

// A detail as words: a string as it is, anything else (a {code, message} refusal) as its JSON.
function said(detail: unknown): string | null {
  if (detail === null || detail === undefined) return null;
  return typeof detail === 'string' ? detail : JSON.stringify(detail);
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await send(url, init);
  if (!res.ok) throw await failure(url, res);
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

// signal: the caller can stop waiting (Build a week for me, when its page goes).
export const planWeekWith = (o: WeekOptions, signal?: AbortSignal) =>
  json<WeekPlan>(`${API}/plan/week`, { ...post(o), signal });

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

export const getStatus = (signal?: AbortSignal) => json<HubStatus>(`${HUB}/status`, { signal });

// An address to places (OpenStreetMap through the hub). Only ever on the shopper's search, never
// as they type: Nominatim's policy forbids autocomplete.
export const geocode = (q: string, signal?: AbortSignal) =>
  json<GeocodeAnswer>(`${HUB}/geocode?q=${encodeURIComponent(q)}`, { signal });
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
// `recipe_doc`: a recipe the shopper reviewed in the import sheet, every line confirmed; the hub
// keeps it as the conversation's next imp:N and the model plans exactly those lines.
// `meal_plan`: the shopper's Meal plan in brief (mealplan/chatDraft.contextOf), which a meal-plan
// draft is made against; the hub keeps it in memory only.
export async function agentChat(
  body: { message: string; conversation_id?: string | null; model: string; target: string;
          disclosure?: string; recipe_doc?: RecipeDoc; meal_plan?: MealPlanContext },
  onEvent: (e: AgentEvent) => void,
  signal?: AbortSignal,
  onOpen?: () => void,
): Promise<void> {
  const res = await send(`${HUB}/agent/chat`, { ...post(body), signal });
  onOpen?.();
  if (!res.ok || !res.body) {
    const err = await failure(`${HUB}/agent/chat`, res);
    // a refusal of a reviewed recipe is {code, message}: say the message, not the JSON
    if (err instanceof HubError && err.detail && typeof err.detail === 'object' && 'message' in err.detail) {
      throw new HubError(String((err.detail as { message: unknown }).message), err.status, err.detail, err.reason);
    }
    throw err;
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

// A chat cart's line: the other products that could fill it, ranked by pantry from the plan the
// hub holds (the browser never sends the plan). `ref` names the card's plan. Read-only: no model
// call, and it works while the assistant is answering.
export const agentAlternatives = (conversationId: string,
                                  body: { ref: number; line_no: number; limit?: number }) =>
  json<AlternativeRanking>(
    `${HUB}/agent/conversations/${encodeURIComponent(conversationId)}/alternatives`, post(body));

// The shopper's choice for a line: the hub re-prices the plan with it (no model call) and the
// model hears about it with the next message. product_id null puts the planner's pick back.
export const agentSwap = (conversationId: string,
                          body: { ref: number; line_no: number; product_id: number | null }) =>
  json<SwapResult>(
    `${HUB}/agent/conversations/${encodeURIComponent(conversationId)}/swap`, post(body));

// Recipe import: the hub reads a recipe page or a YouTube link (a guarded fetch on the shopper's
// own machine; pantry-api never fetches) into a RecipeDoc for the shopper to review. No model is
// called. A refusal is a HubError whose detail is {code, message, ...}.
export const importRecipe = (url: string) =>
  json<ImportResult>(`${HUB}/recipes/import`, post({ url }));

// Gemini watches a public video for its ingredient lines: only on the shopper's click, which is
// the consent the hub requires. Every line comes back unconfirmed until the shopper ticks it.
// duration_s is the length the sheet shows: the YouTube Data API's, or the shopper's estimate.
// The hub reads the length itself when it can, and needs this when it cannot (422
// needs_duration), as when its key is refused between the link import and the click.
export const importVideo = (body: { video_id: string; duration_s?: number | null }) =>
  json<ImportResult>(`${HUB}/recipes/import/video`, post({
    video_id: body.video_id, consent: true,
    ...(body.duration_s != null ? { duration_s: body.duration_s } : {}),
  }));

// Google Calendar sync (opt-in, local hub only; demo-hub docs/google-calendar.md). The hub holds
// the OAuth client and token; the console only ever sees booleans and labels. connect answers
// Google's consent URL, which the console opens; preview writes nothing; apply writes exactly
// the reviewed diff (409 preview_stale when anything changed since). A refusal is a HubError
// whose detail is {code, message}.
export const calendarSyncStatus = () => json<CalendarSyncStatus>(`${HUB}/calendar/status`);
export const calendarConnect = (return_to: string) =>
  json<{ auth_url: string }>(`${HUB}/calendar/connect`, post({ return_to }));
export const calendarSyncPreview = (body: CalendarSyncRequest) =>
  json<CalendarDiff>(`${HUB}/calendar/sync/preview`, post(body));
export const calendarSyncApply = (body: CalendarSyncRequest) =>
  json<CalendarApplyResult>(`${HUB}/calendar/sync/apply`, post(body));
export const calendarDisconnect = (delete_calendar: boolean) =>
  json<CalendarDisconnectResult>(`${HUB}/calendar/disconnect`, post({ delete_calendar }));

// Traces of Assistant turns and the metrics rolled up from them (every layer, the browser's too).
export const traceList = (limit = 50) => json<TraceSummary[]>(`${HUB}/traces?limit=${limit}`);
export const traceDetail = (id: string) => json<Trace>(`${HUB}/traces/${encodeURIComponent(id)}`);
export const getMetrics = () => json<Metrics>(`${HUB}/metrics`);
export const runDetail = (id: string) => json<RunDetail>(`${HUB}/runs/${encodeURIComponent(id)}`);

// Pictures, fetched once by the hub and served from its cache: an ingredient's Wikipedia
// thumbnail, an image from a recipe page, and a Wikipedia article's lead image (404 when it has
// none).
export const ingredientImage = (name: string) =>
  `${HUB}/images/ingredient?name=${encodeURIComponent(name)}`;
export const remoteImage = (url: string) => `${HUB}/images/remote?url=${encodeURIComponent(url)}`;
export const wikiImage = (title: string) => `${HUB}/images/wiki?title=${encodeURIComponent(title)}`;

// OpenStreetMap's map tiles through the hub (its cache, and the attribution and fair use the
// tile policy asks for); 503 while the hub has them off (HubStatus.tiles).
export const tileImage = (z: number, x: number, y: number) => `${HUB}/tiles/${z}/${x}/${y}.png`;

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
