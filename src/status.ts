// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// The console's health as the shopper reads it. Three parts matter: the pantry API (it plans, and
// the whole meal plan works on it alone), the planner's model (demo mode or an LLM), and the demo
// hub (the Assistant, the Workshop's live tools, pictures, the map, address search and Google
// Calendar). The header says it in one dot and a few words ("Ready", "Hub paused", "API offline ·
// retrying", "Connecting…") and, opened, in one line per part. hub.ts says a failed hub call in
// the same plain words, so the header, the pages and the errors never disagree.

import type { Health, HubStatus, RuntimeSettings } from './types.ts';

export type ApiState = 'connecting' | 'ok' | 'offline';

// refused: the hub answered and said no (401 or 403: its guard, as on the public demo, where the
// hub is "paused" for this page); unreachable: nothing answered, or a proxy in front said there
// was nothing behind it.
export type HubState = 'connecting' | 'ok' | 'refused' | 'unreachable';

export const HUB_REFUSED = 'The demo hub is not open to this page';
export const HUB_DOWN = 'The demo hub is not running';

// How often the header asks the pantry API again (and says so while it is offline).
export const API_POLL_S = 15;

export const hubStateOf = (httpStatus: number): 'refused' | 'unreachable' =>
  (httpStatus === 401 || httpStatus === 403 ? 'refused' : 'unreachable');

// The plain words for a failed hub call that carried no reason of its own, or null to keep what
// the hub said. A route that refuses says why in `detail` (a recipe page that is not public, a
// sync already running, the simulations runner being down), and those words stay. The hub's
// guard (403 with only a `reason`), a proxy with no hub behind it (500, 502, 503, 504), a host
// with no hub at all (404) and no answer at all (status 0) are said plainly instead.
export function plainHubError(httpStatus: number, detail: unknown): string | null {
  if (detail !== null && detail !== undefined) return null;
  if (httpStatus === 401 || httpStatus === 403) return HUB_REFUSED;
  if (httpStatus === 0 || httpStatus === 404 || httpStatus >= 500) return HUB_DOWN;
  return null;
}

// What a page says when the hub is the reason something is off; '' while it answers (or before
// it has been asked).
export function hubMessage(state: HubState): string {
  if (state === 'refused') return HUB_REFUSED;
  if (state === 'unreachable') return HUB_DOWN;
  return '';
}

export type Tone = 'ok' | 'warn' | 'danger' | 'muted';

// The header's dot and words. The pantry API comes first: without it nothing plans. Then a part
// not heard from yet, then the hub, which only some pages need.
export function statusSummary(api: ApiState, hub: HubState): { words: string; tone: Tone } {
  if (api === 'offline') return { words: 'API offline · retrying', tone: 'danger' };
  if (api === 'connecting' || hub === 'connecting') return { words: 'Connecting…', tone: 'muted' };
  if (hub === 'refused') return { words: 'Hub paused', tone: 'warn' };
  if (hub === 'unreachable') return { words: 'Hub offline', tone: 'warn' };
  return { words: 'Ready', tone: 'ok' };
}

// ─── One line per part, for the opened status ────────────────

// "OK · cascade routing"
export function apiLine(state: ApiState, health: Health | null): string {
  if (state === 'offline') return `Not answering · trying again every ${API_POLL_S} s`;
  if (state === 'connecting' || !health) return 'Checking…';
  const said = health.status === 'ok' ? 'OK' : health.status;
  return `${said} · ${health.routing_strategy} routing`;
}

// "Demo mode: no LLM, deterministic stand-ins", or the model that chooses products. The runtime
// settings say what is switched on now; health only says how pantry-api started.
export function plannerLine(health: Health | null, runtime: RuntimeSettings | null): string {
  if (!health && !runtime) return 'Checking…';
  const demo = runtime ? runtime.demo_mode : Boolean(health?.demo_mode);
  if (demo) return 'Demo mode: no LLM, deterministic stand-ins';
  return `LLM: ${runtime?.models.selector_default ?? health?.default_model ?? 'unknown'}`;
}

// "Ready · Assistant on gemini:…", "Paused: not open to this page", "Not running".
export function hubLine(state: HubState, status: HubStatus | null): string {
  switch (state) {
    case 'ok':
      return status?.agent?.default_model ? `Ready · Assistant on ${status.agent.default_model}` : 'Ready';
    case 'refused':
      return 'Paused: not open to this page';
    case 'unreachable':
      return 'Not running';
    default:
      return 'Checking…';
  }
}
