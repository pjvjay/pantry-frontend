import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fromConsole } from '../src/consoleRequest.ts';

const headersOf = (init: RequestInit) => new Headers(init.headers);

test('a request that changes something says it is from the console, as JSON', () => {
  for (const method of ['POST', 'post', 'PUT', 'PATCH', 'DELETE']) {
    const h = headersOf(fromConsole({ method, body: '{}' }));
    assert.equal(h.get('x-pantry-console'), '1', method);
    assert.equal(h.get('content-type'), 'application/json', method);
  }
});

test('a POST with no body still says JSON, as the hub requires of every non-GET', () => {
  assert.equal(headersOf(fromConsole({ method: 'POST' })).get('content-type'), 'application/json');
});

test('reads are left as they are', () => {
  const init = { cache: 'no-store' as const };
  assert.equal(fromConsole(init), init);
  assert.equal(fromConsole({ method: 'HEAD' }).headers, undefined);
  assert.deepEqual(fromConsole(), {});
});

test("the caller's own headers, body and signal are kept", () => {
  const signal = new AbortController().signal;
  const init = fromConsole({ method: 'POST', body: 'x', signal,
    headers: [['Content-Type', 'application/json; charset=utf-8'], ['Accept', 'text/event-stream']] });
  const h = headersOf(init);
  assert.equal(h.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(h.get('accept'), 'text/event-stream');
  assert.equal(init.body, 'x');
  assert.equal(init.signal, signal);
});
