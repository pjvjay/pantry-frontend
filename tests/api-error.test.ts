import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ApiError, apiError } from '../src/apiError.ts';

test("a string detail is the message, as before", () => {
  const e = apiError(404, 'Not Found', { detail: "no library recipe 'x'" });
  assert.ok(e instanceof ApiError && e instanceof Error);
  assert.equal(e.message, "no library recipe 'x'");
  assert.equal(e.status, 404);
  assert.equal(e.code, null);
});

test("the meal plan's refusals keep their code and their words", () => {
  const e = apiError(422, 'Unprocessable Entity', { detail: {
    error: 'invalid_dates', detail: 'fixed date 2027-01-01 is outside the plan (2026-10-09, 14 days)',
  } });
  assert.equal(e.code, 'invalid_dates');
  assert.match(e.message, /outside the plan/);

  const big = apiError(413, 'Payload Too Large', { detail: { error: 'too_large',
    detail: 'A meal plan is at most 262144 bytes.' } });
  assert.equal(big.code, 'too_large');
  assert.equal(big.status, 413);
});

test('a rate limit says when to retry', () => {
  const e = apiError(429, 'Too Many Requests', { detail: { error: 'rate_limited',
    detail: 'Too many requests to /mealplan/resolve; retry in 7 s' } }, '7');
  assert.equal(e.code, 'rate_limited');
  assert.equal(e.retryAfterS, 7);
  assert.equal(apiError(429, 'Too Many Requests', undefined, 'soon').retryAfterS, null);
});

test('a validation failure names the fields, not [object Object]', () => {
  const e = apiError(422, 'Unprocessable Entity', { detail: [
    { loc: ['body', 'recipes', 0, 'key'], msg: 'Field required', type: 'missing' },
    { loc: ['body', 'days'], msg: 'Input should be less than or equal to 14' },
  ] });
  assert.equal(e.message,
    'recipes.0.key: Field required; days: Input should be less than or equal to 14');
  assert.equal(e.code, null);
});

test('a body that is not JSON falls back to the status line', () => {
  assert.equal(apiError(502, 'Bad Gateway', undefined).message, '502 Bad Gateway');
  assert.equal(apiError(500, '', { detail: null }).message, '500');
});
