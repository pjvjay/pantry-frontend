import type {
  Health,
  OriginRanking,
  ParsedLines,
  PlanExecution,
  Recipe,
  RecipeDoc,
  ShoppingPlan,
  WeekPlan,
} from './types';
import { fromConsole } from './consoleRequest';

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, fromConsole(init));
  if (!res.ok) {
    let detail: unknown = null;
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-JSON error body — keep the status text */
    }
    if (res.status === 409 && detail && typeof detail === 'object' && 'aborted' in detail) {
      throw new PlanAbortError(detail as PlanExecution);
    }
    // /plan/spec refuses with {error, detail}: say its sentence; any other shape as JSON
    const said = detail && typeof detail === 'object' && typeof (detail as { detail?: unknown }).detail === 'string'
      ? (detail as { detail: string }).detail : detail;
    throw new Error(typeof said === 'string' ? said
      : said ? JSON.stringify(said) : `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

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
