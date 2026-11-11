// The console's health in the shopper's words: the header's dot and words, a line per part, and
// a failed hub call said plainly unless the hub gave its own reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HUB_DOWN, HUB_REFUSED, apiLine, hubLine, hubMessage, hubStateOf, plainHubError, plannerLine,
  statusSummary,
} from '../src/status.ts';
import type { Health, HubStatus, RuntimeSettings } from '../src/types.ts';

const HEALTH: Health = { status: 'ok', routing_strategy: 'cascade', default_model: 'claude-haiku-4-5',
  escalation_model: 'claude-sonnet-4-6', confidence_threshold: 0.8, demo_mode: true };
const RUNTIME: RuntimeSettings = { demo_mode: false, models: { selector_default: 'gemini:flash' } };
const STATUS = { services: [], keys: {}, agent: { default_model: 'gemini:gemini-3-flash-preview' } } satisfies HubStatus;

test('the header says the most important thing first: the API, then waiting, then the hub', () => {
  assert.deepEqual(statusSummary('ok', 'ok'), { words: 'Ready', tone: 'ok' });
  assert.deepEqual(statusSummary('offline', 'ok'), { words: 'API offline · retrying', tone: 'danger' });
  assert.deepEqual(statusSummary('offline', 'refused'), { words: 'API offline · retrying', tone: 'danger' });
  assert.deepEqual(statusSummary('connecting', 'ok'), { words: 'Connecting…', tone: 'muted' });
  assert.deepEqual(statusSummary('ok', 'connecting'), { words: 'Connecting…', tone: 'muted' });
  assert.deepEqual(statusSummary('ok', 'refused'), { words: 'Hub paused', tone: 'warn' });
  assert.deepEqual(statusSummary('ok', 'unreachable'), { words: 'Hub offline', tone: 'warn' });
});

test('a refusal is the hub saying no; anything else is the hub not being there', () => {
  assert.equal(hubStateOf(401), 'refused');
  assert.equal(hubStateOf(403), 'refused');
  for (const s of [0, 404, 500, 502, 503, 504]) assert.equal(hubStateOf(s), 'unreachable', String(s));
  assert.equal(hubMessage('refused'), HUB_REFUSED);
  assert.equal(hubMessage('unreachable'), HUB_DOWN);
  assert.equal(hubMessage('ok'), '');
  assert.equal(hubMessage('connecting'), '');
});

test('a failed hub call is said plainly, unless the route said why itself', () => {
  assert.equal(plainHubError(403, null), 'The demo hub is not open to this page');
  assert.equal(plainHubError(401, undefined), HUB_REFUSED);
  assert.equal(plainHubError(0, null), 'The demo hub is not running');
  for (const s of [404, 500, 502, 503, 504]) assert.equal(plainHubError(s, null), HUB_DOWN, String(s));
  // a route's own refusal keeps its words: a recipe page that is not public, the runner being down
  assert.equal(plainHubError(403, { code: 'not_public', message: 'x is not a public address' }), null);
  assert.equal(plainHubError(502, 'the mcp-sim runner is not reachable'), null);
  // and the ordinary refusals of a request are not about the hub at all
  for (const s of [400, 409, 413, 415, 422, 429]) assert.equal(plainHubError(s, null), null, String(s));
});

test('opened, the status names each part in a line', () => {
  assert.equal(apiLine('ok', HEALTH), 'OK · cascade routing');
  assert.equal(apiLine('ok', { ...HEALTH, status: 'degraded' }), 'degraded · cascade routing');
  assert.equal(apiLine('offline', HEALTH), 'Not answering · trying again every 15 s');
  assert.equal(apiLine('connecting', null), 'Checking…');

  assert.equal(plannerLine(HEALTH, null), 'Demo mode: no LLM, deterministic stand-ins');
  // what is switched on now wins over how pantry-api started
  assert.equal(plannerLine(HEALTH, RUNTIME), 'LLM: gemini:flash');
  assert.equal(plannerLine({ ...HEALTH, demo_mode: false }, null), 'LLM: claude-haiku-4-5');
  assert.equal(plannerLine(null, null), 'Checking…');

  assert.equal(hubLine('ok', STATUS), 'Ready · Assistant on gemini:gemini-3-flash-preview');
  assert.equal(hubLine('refused', null), 'Paused: not open to this page');
  assert.equal(hubLine('unreachable', null), 'Not running');
  assert.equal(hubLine('connecting', null), 'Checking…');
});
