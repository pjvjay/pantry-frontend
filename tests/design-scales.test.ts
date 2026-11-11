// The type and corner scales, held where they are used: every font-size in the stylesheets is one
// of the seven --fs-* tokens, and every corner one of the radius tokens, round (50%) or square (0).
// So a new rule cannot bring back a size or a corner of its own; styles/tokens.css is the one
// place where the values are set, and says how to choose one for an old size.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const TOKENS = join(SRC, 'styles', 'tokens.css');

function files(dir: string, ext: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path, ext);
    return e.name.endsWith(ext) ? [path] : [];
  });
}

const uncommented = (path: string) => readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const where = (path: string) => relative(ROOT, path);
const STYLESHEETS = files(SRC, '.css').filter((f) => f !== TOKENS);
const tokens = uncommented(TOKENS);

// a declaration's values in a stylesheet: [property, value]
function declarations(text: string, property: RegExp): [string, string][] {
  const re = new RegExp(`(?<![-\\w])(${property.source})\\s*:\\s*([^;}]+)`, 'g');
  return [...text.matchAll(re)].map((m) => [m[1], m[2].replace(/!important/, '').trim()]);
}

const SIZES = ['--fs-chrome', '--fs-label', '--fs-compact', '--fs-body', '--fs-title', '--fs-section', '--fs-page'];

test('the type scale is the six roles and the chrome size, each set once in px', () => {
  for (const name of SIZES) {
    const set = [...tokens.matchAll(new RegExp(`${name}\\s*:\\s*([^;]+);`, 'g'))].map((m) => m[1].trim());
    assert.equal(set.length, 1, `${name} is set ${set.length} times`);
    assert.match(set[0], /^\d+px$/, `${name}: ${set[0]}`);
  }
  const all = new Set([...tokens.matchAll(/(--fs-[\w-]+)\s*:/g)].map((m) => m[1]));
  assert.deepEqual([...all].sort(), [...SIZES].sort(), 'a size token outside the scale');
});

test('every font-size in the stylesheets is a type token', () => {
  for (const file of STYLESHEETS) {
    for (const [, value] of declarations(uncommented(file), /font-size/)) {
      const token = /^var\((--fs-[\w-]+)\)$/.exec(value);
      assert.ok(token && SIZES.includes(token[1]), `${where(file)}: font-size: ${value}`);
    }
  }
});

test('a font shorthand names its size by a token too', () => {
  for (const file of STYLESHEETS) {
    for (const [, value] of declarations(uncommented(file), /font/)) {
      const size = value.split('/')[0];
      assert.ok(!/(^|\s)[\d.]+(px|pt|rem|em|%)(\s|$)/.test(size), `${where(file)}: font: ${value}`);
    }
  }
});

const CORNERS = ['var(--radius-1)', 'var(--radius-2)', 'var(--radius-3)', 'var(--radius-4)', 'var(--radius-pill)', '50%', '0'];
// a corner of its own, just inside an edge: a token less a pixel or two
const INSIDE = /^calc\(var\(--radius-[1-4]\) - \d+px\)$/;

test('every corner is a radius token, round or square', () => {
  for (const file of STYLESHEETS) {
    for (const [property, value] of declarations(uncommented(file), /border(?:-[a-z]+)*-radius/)) {
      if (property === 'border-radius') {
        assert.ok(CORNERS.includes(value),
          `${where(file)}: border-radius: ${value} (one value, from the scale; a corner of its own takes the longhand)`);
      } else {
        assert.ok(CORNERS.includes(value) || INSIDE.test(value), `${where(file)}: ${property}: ${value}`);
      }
    }
  }
});

test('no page sets a font size or a corner inline', () => {
  for (const file of files(SRC, '.tsx')) {
    const text = readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\b(fontSize|borderRadius)\s*:/, `${where(file)} sets one in a style prop`);
  }
});
