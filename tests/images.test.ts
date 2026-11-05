// The meal plan's pictures: which source a recipe's comes from and what its credit says, the
// plan's recipes' pictures from the last answers, and the names a product's picture is asked by.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { planPictures, productPictureNames, recipePicture, siteOf } from '../src/mealplan/images.ts';
import { docRef } from '../src/mealplan/model.ts';
import type { RecipeDoc, RecipeSource } from '../src/types.ts';
import { add, planWith, run } from './helpers/mealplan.ts';

const doc = (id: string, source: Partial<RecipeSource>): RecipeDoc => ({
  v: 1, key: `my:${id}`, title: id, servings: 2, servings_stated: true, servings_basis: 'source', yield_text: '',
  lines: [], warnings: [], source: { kind: 'web', method: 'jsonld', ...source },
} as RecipeDoc);

test('a recipe pantry-api names an article for has Wikipedia’s picture', () => {
  assert.deepEqual(recipePicture({ kind: 'wiki', title: ' Congee ' }),
    { via: 'wiki', title: 'Congee', credit: 'Wikipedia' });
  assert.equal(recipePicture({ kind: 'wiki', title: '  ' }), null, 'no article');
});

test('a picture on the web comes through the hub, credited to its site', () => {
  assert.deepEqual(recipePicture({ kind: 'url', url: 'https://www.seriouseats.com/img/dal.jpg' }),
    { via: 'remote', url: 'https://www.seriouseats.com/img/dal.jpg', credit: 'seriouseats.com' });
  for (const bad of ['javascript:alert(1)', 'ftp://x.org/a.jpg', '/local.png', 'https://a b.jpg', '']) {
    assert.equal(recipePicture({ kind: 'url', url: bad }), null, bad);
  }
});

test('no image, or none named, is the placeholder', () => {
  assert.equal(recipePicture(null), null);
  assert.equal(recipePicture(undefined), null);
});

test('the shopper’s own recipe shows the image its import kept, credited to its page or video', () => {
  const web = doc('dal', { url: 'https://www.bbcgoodfood.com/recipes/dal', site: 'bbcgoodfood.com',
    image_url: 'https://images.immediate.co.uk/dal.jpg' });
  assert.deepEqual(recipePicture({ kind: 'wiki', title: 'Dal' }, web),
    { via: 'remote', url: 'https://images.immediate.co.uk/dal.jpg', credit: 'bbcgoodfood.com' }, 'its own first');
  const video = doc('curry', { kind: 'youtube', method: 'youtube_description', url: 'https://www.youtube.com/watch?v=abc',
    site: 'youtube.com', image_url: 'https://i.ytimg.com/vi/abc/hqdefault.jpg' });
  assert.equal(recipePicture(null, video)?.credit, 'YouTube');
  const pasted = doc('soup', { kind: 'pasted', method: 'paste', image_url: 'https://cdn.example.org/soup.webp' });
  assert.equal(recipePicture(null, pasted)?.credit, 'cdn.example.org', 'nothing else to name: the picture’s host');
  // an older import has no image: pantry-api's, else none
  const old = doc('stew', { url: 'https://stew.example.com/r' });
  assert.deepEqual(recipePicture({ kind: 'wiki', title: 'Stew' }, old), { via: 'wiki', title: 'Stew', credit: 'Wikipedia' });
  assert.equal(recipePicture({ kind: 'url', url: 'https://img.example.net/s.jpg' }, old)?.credit, 'stew.example.com');
  assert.equal(recipePicture(null, old), null);
});

test('sites in words', () => {
  assert.equal(siteOf('https://www.allrecipes.com/x'), 'allrecipes.com');
  assert.equal(siteOf('https://youtu.be/abc'), 'YouTube');
  assert.equal(siteOf('not a url'), '');
  assert.equal(siteOf(null), '');
});

test('the plan’s recipes take the first answer naming them, and their own docs', () => {
  const mine = doc('dal', { image_url: 'https://example.org/dal.jpg' });
  let s = planWith(7, add('ginger_congee', 'Ginger Congee', 1, 'breakfast'), add('tuna_melt', 'Tuna Melt', 1, 'lunch'),
    add('pepperoni_pizza', 'Pepperoni Pizza', 1));
  s = run(s, { type: 'addRecipe', ref: docRef(mine), title: 'Dal', slot: 'dinner', wanted: 1 });
  const pics = planPictures(s.draft, [
    { key: 'starter:ginger_congee', image: { kind: 'wiki', title: 'Congee' } },
    { key: 'starter:tuna_melt', image: null },
    { key: 'starter:ginger_congee', image: { kind: 'wiki', title: 'Rice' } },
    { key: 'my:dal', image: null },
    { key: 'starter:gone', image: { kind: 'wiki', title: 'Gone' } },
  ]);
  assert.deepEqual([...pics.keys()], ['starter:ginger_congee', 'starter:tuna_melt', 'starter:pepperoni_pizza', 'my:dal']);
  assert.deepEqual(pics.get('starter:ginger_congee'), { via: 'wiki', title: 'Congee', credit: 'Wikipedia' },
    'the first answer wins');
  assert.equal(pics.get('starter:tuna_melt'), null);
  assert.equal(pics.get('starter:pepperoni_pizza'), null, 'not heard of yet');
  assert.equal((pics.get('my:dal') as { url: string }).url, 'https://example.org/dal.jpg');
});

test('a product’s picture is asked by its name, then the ingredient’s, each once', () => {
  assert.deepEqual(productPictureNames('Jasmine Rice', 'jasmine rice'), ['Jasmine Rice']);
  assert.deepEqual(productPictureNames('PantryCo Basmati', 'rice'), ['PantryCo Basmati', 'rice']);
  assert.deepEqual(productPictureNames(null, ' garlic '), ['garlic'], 'no product chosen');
  assert.deepEqual(productPictureNames('', ''), []);
});
