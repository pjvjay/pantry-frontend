// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// Every request from this console that changes something says so, as JSON. The demo hub's guard
// refuses a non-GET /hub/* or /pantry/api/* request without X-Pantry-Console: a page on another
// site cannot add that header without a CORS preflight, and the hub answers none.
//
// pantry-api ignores the header, and it can never cost a preflight: the console reaches pantry-api
// on its own origin in every deployment (the AKS ingress, nginx in compose, demo_server, the hub's
// proxy, Vite's proxy), and a custom header needs a preflight only across origins.
export const CONSOLE_HEADER = 'X-Pantry-Console';

export function fromConsole(init: RequestInit = {}): RequestInit {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return init;
  const headers = new Headers(init.headers);
  headers.set(CONSOLE_HEADER, '1');
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return { ...init, headers };
}
