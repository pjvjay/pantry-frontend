// Pure module: no React, DOM or import.meta.env, and sibling imports name their .ts file, so
// node --test runs it as it is (tests/pure-modules.test.ts checks all of this).
//
// pantry-api's errors, read into one class. FastAPI puts the reason in `detail`, which is a
// string for most routes, an object {error, detail, ...} for the meal plan's own refusals
// (422 slot_capacity, 413 too_large, 503 llm_budget_exhausted) and a list for a request that
// fails validation. The console shows `message` and branches on `code`.

export class ApiError extends Error {
  status: number;
  code: string | null;             // the meal plan's error code, when the server sent one
  detail: unknown;                 // the body's detail as sent
  retryAfterS: number | null;      // 429: when to try again

  constructor(status: number, message: string, code: string | null, detail: unknown,
    retryAfterS: number | null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.retryAfterS = retryAfterS;
  }
}

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

// One pydantic validation error, as "recipes.0.key: Field required".
function validationLine(e: unknown): string {
  if (!isObject(e)) return String(e);
  const where = Array.isArray(e.loc) ? e.loc.filter((p) => p !== 'body').join('.') : '';
  const msg = typeof e.msg === 'string' ? e.msg : 'invalid';
  return where ? `${where}: ${msg}` : msg;
}

// `body` is the parsed JSON body, or undefined when it was not JSON.
export function apiError(status: number, statusText: string, body: unknown,
  retryAfter: string | null = null): ApiError {
  const detail = isObject(body) ? body.detail : undefined;
  let message = `${status} ${statusText}`.trim();
  let code: string | null = null;
  if (typeof detail === 'string' && detail) {
    message = detail;
  } else if (isObject(detail)) {
    code = typeof detail.error === 'string' ? detail.error : null;
    if (typeof detail.detail === 'string' && detail.detail) message = detail.detail;
    else if (typeof detail.message === 'string' && detail.message) message = detail.message;
    else if (code) message = code;
  } else if (Array.isArray(detail) && detail.length) {
    message = detail.slice(0, 3).map(validationLine).join('; ');
  }
  const seconds = retryAfter !== null && /^\d+$/.test(retryAfter.trim())
    ? Number(retryAfter.trim()) : null;
  return new ApiError(status, message, code, detail, seconds);
}
