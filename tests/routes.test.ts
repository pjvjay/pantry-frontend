// The console's addresses: each page's own, every old one still landing where it should with its
// query kept, and anything unknown at Home.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALIASES, PRIMARY, ROUTE_IDS, WORKSHOP_TABS, arrivalFor, canonicalHash, hrefFor, parseHash, sectionOf, titleFor,
} from '../src/routes.ts';
import type { Route } from '../src/routes.ts';
import { routedLinks } from '../src/alternatives.ts';

test('each page has one address, and reading it back gives the same page', () => {
  const pages: [string, Route][] = [
    ['#/home', { name: 'home' }],
    ['#/plan', { name: 'plan' }],
    ['#/plan?step=3', { name: 'plan', query: 'step=3' }],
    ['#/shop', { name: 'shop' }],
    ['#/shop/trip/2026-11-12', { name: 'trip', date: '2026-11-12' }],
    ['#/ask', { name: 'ask' }],
    ['#/workshop/catalog', { name: 'workshop', tab: 'catalog' }],
    ['#/workshop/provenance?product=5', { name: 'workshop', tab: 'provenance', query: 'product=5' }],
    ['#/workshop/metrics?trace=abc', { name: 'workshop', tab: 'metrics', query: 'trace=abc' }],
    ['#/workshop/about', { name: 'workshop', tab: 'about' }],
  ];
  for (const [hash, route] of pages) {
    assert.deepEqual(parseHash(hash), route, hash);
    assert.equal(hrefFor(route), hash);
    assert.equal(canonicalHash(hash), hash, `${hash} is already canonical: no rewrite`);
  }
  for (const { id } of WORKSHOP_TABS) {
    assert.equal(canonicalHash(`#/workshop/${id}`), `#/workshop/${id}`);
  }
});

test('Home is the start: an empty hash, the old Overview and anything unknown land there', () => {
  for (const hash of ['', '#', '#/', '#/overview', '#/nope', '#/nope?x=1', '#/Plan', '#/home/x',
    '#/plan/3', '#/ask/now', '#/workshop/catalog/extra', '#//']) {
    assert.equal(canonicalHash(hash), '#/home', JSON.stringify(hash));
  }
  // an old address keeps its query, even one Home does not read
  assert.equal(canonicalHash('#/overview?from=tour'), '#/home?from=tour');
});

test('the old Meal plan addresses open the plan, with every query key kept', () => {
  assert.equal(canonicalHash('#/mealplan'), '#/plan');
  assert.equal(canonicalHash('#/mealplan?step=2'), '#/plan?step=2');
  assert.equal(canonicalHash('#/mealplan?calendar=connected'), '#/plan?calendar=connected');
  assert.equal(canonicalHash('#/mealplan?calendar=error&reason=access_denied'),
    '#/plan?calendar=error&reason=access_denied');
  assert.equal(canonicalHash('#/mealplan?step=2&calendar=denied'), '#/plan?step=2&calendar=denied');
  // the query is kept exactly as written, encoding and all
  assert.equal(canonicalHash('#/mealplan?calendar=error&reason=no%20refresh+token'),
    '#/plan?calendar=error&reason=no%20refresh+token');
  // written without the slash, or with a trailing one
  assert.equal(canonicalHash('#mealplan?step=4'), '#/plan?step=4');
  assert.equal(canonicalHash('#/plan/'), '#/plan');
  assert.deepEqual(parseHash('#/mealplan?step=6'), { name: 'plan', query: 'step=6' });
});

test('the old tabs open in the Workshop or Ask, keeping ?product= and ?trace=', () => {
  assert.equal(canonicalHash('#/planner'), '#/workshop/planner');
  assert.equal(canonicalHash('#/assistant'), '#/ask');
  assert.equal(canonicalHash('#/catalog'), '#/workshop/catalog');
  assert.equal(canonicalHash('#/provenance?product=5'), '#/workshop/provenance?product=5');
  assert.equal(canonicalHash('#/mcp'), '#/workshop/mcp');
  assert.equal(canonicalHash('#/simulations'), '#/workshop/simulations');
  assert.equal(canonicalHash('#/metrics?trace=abc'), '#/workshop/metrics?trace=abc');
  assert.equal(canonicalHash('#/system'), '#/workshop/system');
  // the Workshop itself opens on its first tab; a tab it does not have, likewise
  assert.equal(canonicalHash('#/workshop'), '#/workshop/catalog');
  assert.equal(canonicalHash('#/workshop/nope?trace=1'), '#/workshop/catalog?trace=1');
  // Metrics reads ?trace= by splitting the hash on "?", which works the same before and after
  const traceOf = (hash: string) => new URLSearchParams(hash.split('?')[1] ?? '').get('trace');
  assert.equal(traceOf(canonicalHash('#/metrics?trace=abc')), 'abc');
});

test('a trip is a real date under Shop; anything else there is the shopping plan', () => {
  assert.deepEqual(parseHash('#/shop/trip/2026-11-12'), { name: 'trip', date: '2026-11-12' });
  for (const hash of ['#/shop/trip', '#/shop/trip/', '#/shop/trip/2026-02-30', '#/shop/trip/tomorrow',
    '#/shop/trip/2026-11-12/x', '#/shop/list']) {
    assert.equal(canonicalHash(hash), '#/shop', hash);
  }
  assert.equal(sectionOf(parseHash('#/shop/trip/2026-11-12')), 'shop');
});

test('every alias leads straight to a page (no alias of an alias), and rewriting twice changes nothing', () => {
  for (const [from, to] of Object.entries(ALIASES)) {
    assert.equal(canonicalHash(`#/${to}`), `#/${to}`, `${from} → ${to} is not a page's own address`);
    assert.notEqual(parseHash(`#/${from}`).name, undefined);
  }
  for (const hash of ['', '#/mealplan?calendar=connected', '#/provenance?product=5', '#/workshop', '#/x']) {
    const once = canonicalHash(hash);
    assert.equal(canonicalHash(once), once, hash);
  }
});

test("the Assistant's card links reach today's pages and the old ones the shell rewrites", () => {
  for (const id of ['home', 'plan', 'shop', 'ask', 'workshop', 'mealplan', 'metrics', 'assistant', 'catalog',
    'provenance', 'mcp', 'simulations', 'system', 'planner', 'overview']) {
    assert.ok(ROUTE_IDS.includes(id), id);
  }
  assert.ok(!ROUTE_IDS.includes(''));
  const links = [
    { label: 'Open in Meal plan', href: '#/mealplan?step=4' },
    { label: 'Open the plan', href: '#/plan?step=4' },
    { label: 'run details', href: '#/workshop/metrics?trace=t1' },
    { label: 'elsewhere', href: 'https://example.com/#/plan' },
    { label: 'gone', href: '#/recipes' },
  ];
  assert.deepEqual(routedLinks(links, ROUTE_IDS).map((l) => l.label),
    ['Open in Meal plan', 'Open the plan', 'run details']);
});

test('the navigation knows its place for each page, and the browser tab says where you are', () => {
  assert.deepEqual(PRIMARY.map((p) => p.label), ['Home', 'Plan', 'Shop', 'Ask']);
  assert.equal(sectionOf({ name: 'workshop', tab: 'mcp' }), 'workshop');
  assert.equal(sectionOf({ name: 'plan', query: 'step=2' }), 'plan');
  assert.equal(titleFor({ name: 'home' }), 'Home · Pantry Planner');
  assert.equal(titleFor({ name: 'ask' }), 'Ask · Pantry Planner');
  assert.equal(titleFor({ name: 'workshop', tab: 'planner' }), 'Planner lab · Workshop · Pantry Planner');
  assert.equal(titleFor({ name: 'trip', date: '2026-11-12' }), 'Trip on 2026-11-12 · Shop · Pantry Planner');
  assert.deepEqual(WORKSHOP_TABS.map((t) => t.label),
    ['Catalog', 'Provenance', 'MCP explorer', 'Simulations', 'Metrics', 'System', 'Planner lab', 'About']);
});

test('arriving at a page says its name and where it sits, in words a screen reader reads', () => {
  assert.equal(arrivalFor({ name: 'ask' }), 'Ask');
  assert.equal(arrivalFor({ name: 'plan', query: 'step=2' }), 'Plan');
  assert.equal(arrivalFor({ name: 'workshop', tab: 'system' }), 'System, Workshop');
  assert.equal(arrivalFor({ name: 'trip', date: '2026-11-12' }), 'Trip on 2026-11-12, Shop');
  // the same page as the title, without the console's name or the separators
  for (const route of [{ name: 'home' }, { name: 'shop' }, { name: 'workshop', tab: 'mcp' }] as const) {
    assert.equal(`${arrivalFor(route).replace(', ', ' · ')} · Pantry Planner`, titleFor(route));
  }
});
