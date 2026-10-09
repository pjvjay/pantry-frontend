import type {
  CalendarExportRequest,
  CalendarFile,
  CalendarPreview,
  CookDaysProposal,
  Health,
  MealPlanDraft,
  MealSchedule,
  MealStarter,
  OriginRanking,
  ParsedLines,
  PlanExecution,
  Recipe,
  RecipeDoc,
  ResolveRequest,
  ResolveResponse,
  SelectionParseRequest,
  SelectionParseResult,
  ShelfLife,
  ShoppingPlan,
  TripLineOptions,
  TripLineOptionsRequest,
  WeekPlan,
} from './types';
import { apiError } from './apiError';
import { icsFileName } from './calendar';
import { fromConsole } from './consoleRequest';

export { ApiError } from './apiError';

// BASE_URL is '/pantry/' (vite.config.ts `base`). Building URLs from it
// keeps fetches correct regardless of how the current page path looks.
const API = `${import.meta.env.BASE_URL}api`;

// A query-plan gate fired (HTTP 409): carries the alert + step trace so the
// UI can render the abort card and the timeline up to the failed step.
export class PlanAbortError extends Error {
  execution: PlanExecution;

  constructor(execution: PlanExecution) {
    super(execution.aborted?.message ?? 'Plan aborted');
    this.name = 'PlanAbortError';
    this.execution = execution;
  }
}

async function request<T>(path: string, init?: RequestInit,
  read: (res: Response) => Promise<T> = (res) => res.json() as Promise<T>): Promise<T> {
  const res = await fetch(`${API}${path}`, fromConsole(init));
  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body — keep the status text */
    }
    const detail = (body as { detail?: unknown } | undefined)?.detail;
    if (res.status === 409 && detail && typeof detail === 'object' && 'aborted' in detail) {
      throw new PlanAbortError(detail as PlanExecution);
    }
    // An ApiError is an Error whose message is the server's reason, so callers that show
    // err.message keep working; the meal plan also reads its status and code.
    throw apiError(res.status, res.statusText, body, res.headers.get('Retry-After'));
  }
  return read(res);
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  request<T>(path, { method: 'POST', body: JSON.stringify(body), signal });

export const getHealth = () => request<Health>('/health');
export const getRecipes = () => request<Recipe[]>('/recipes');
export const planRecipe = (slug: string) =>
  request<ShoppingPlan>(`/plan/${slug}`, { method: 'POST' });
export const planNL = (recipeText: string) =>
  request<ShoppingPlan>('/plan/nl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe_text: recipeText }),
  });
export const planWeek = (days: number, maxTotalBudget: number | null) =>
  request<WeekPlan>('/plan/week', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ days, max_total_budget: maxTotalBudget }),
  });

export const rankByOrigin = (preference: string[], exclude: string[]) =>
  request<OriginRanking>('/origins/rank', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preference, exclude }),
  });

// Ingredient lines read with no LLM and no URL (a paste, or a page's list the hub extracted):
// each line's name, amount and unit, for the shopper to review before anything is planned.
export const parseLines = (body: { title?: string | null; yield_text?: string | null;
                                   lines: string[]; origin?: 'paste' | 'page' }) =>
  request<ParsedLines>('/recipes/parse-lines', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// A reviewed recipe planned exactly as reviewed: no parse, the selector still picks products.
// Where there is no hub, "Plan this now" in the import sheet comes here instead of the chat.
export interface SpecOptions {
  lat?: number | null;
  lon?: number | null;
  max_km?: number | null;
  exclude_origin?: string[];
  preference?: string[];
  allow_partial?: boolean;
}

export const planSpec = (doc: RecipeDoc, o: SpecOptions = {}) =>
  request<ShoppingPlan>('/plan/spec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ doc, ...o }),
  });
// ─── meal plan ───────────────────────────────────────────────
// No LLM call except resolve, which runs once per recipe as it enters the tray (6 a minute per
// client, and 503 llm_budget_exhausted above the daily cap). schedule and suggest-cook-days
// take the whole draft (at most 256 KB, otherwise 413).

export const resolveRecipes = (body: ResolveRequest, signal?: AbortSignal) =>
  post<ResolveResponse>('/mealplan/resolve', body, signal);

export const scheduleMealPlan = (draft: MealPlanDraft, signal?: AbortSignal) =>
  post<MealSchedule>('/mealplan/schedule', draft, signal);

export const parseSelection = (body: SelectionParseRequest, signal?: AbortSignal) =>
  post<SelectionParseResult>('/mealplan/selection/parse', body, signal);

export const suggestCookDays = (draft: MealPlanDraft, signal?: AbortSignal) =>
  post<CookDaysProposal>('/mealplan/suggest-cook-days', draft, signal);

// Options for one trip line: no LLM; one re-schedule per candidate, so slower than schedule.
export const tripLineOptions = (body: TripLineOptionsRequest, signal?: AbortSignal) =>
  post<TripLineOptions>('/mealplan/alternatives', body, signal);

export const getMealStarters = (signal?: AbortSignal) =>
  request<MealStarter[]>('/mealplan/starters', { signal });

// Cited storage and thaw times for the products named, or for every product.
export function getShelfLife(productIds: number[] = [], signal?: AbortSignal) {
  const q = new URLSearchParams();
  for (const id of productIds) q.append('product_id', String(id));
  const query = q.toString();
  return request<ShelfLife>(`/shelf-life${query ? `?${query}` : ''}`, { signal });
}

// ─── calendar export ─────────────────────────────────────────
// No LLM and no credentials: pantry-api builds the events from the approved_schedule the schedule
// answer carries, posted back as it came. 409 while a trip needs review or lost a product.

export const previewCalendar = (body: CalendarExportRequest, signal?: AbortSignal) =>
  post<CalendarPreview>('/calendar/preview', body, signal);

export const downloadCalendar = (body: CalendarExportRequest, signal?: AbortSignal) =>
  request<CalendarFile>('/calendar/ics', { method: 'POST', body: JSON.stringify(body), signal },
    async (res) => ({ blob: await res.blob(),
      filename: icsFileName(res.headers.get('Content-Disposition')) }));
