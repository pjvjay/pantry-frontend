import type { Health, PlanExecution, Recipe, ShoppingPlan, WeekPlan } from './types';

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
  const res = await fetch(`${API}${path}`, init);
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
    throw new Error(detail ? String(detail) : `${res.status} ${res.statusText}`);
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
