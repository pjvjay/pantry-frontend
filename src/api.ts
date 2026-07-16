import type { Health, Recipe, ShoppingPlan } from './types';

// BASE_URL is '/pantry/' (vite.config.ts `base`). Building URLs from it
// keeps fetches correct regardless of how the current page path looks.
const API = `${import.meta.env.BASE_URL}api`;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.detail) detail = String(body.detail);
    } catch {
      /* non-JSON error body — keep the status text */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const getHealth = () => request<Health>('/health');
export const getRecipes = () => request<Recipe[]>('/recipes');
export const planRecipe = (slug: string) =>
  request<ShoppingPlan>(`/plan/${slug}`, { method: 'POST' });
