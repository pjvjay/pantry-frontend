import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  THEME_CHOICES, THEME_KEY, parseThemeChoice, storedTheme, themeAttribute,
} from '../src/theme.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('a kept light or dark is read back; anything else follows the system', () => {
  assert.equal(parseThemeChoice('light'), 'light');
  assert.equal(parseThemeChoice('dark'), 'dark');
  for (const raw of [null, undefined, '', 'system', 'Dark', 'sepia', '"dark"']) {
    assert.equal(parseThemeChoice(raw), 'system', `${String(raw)} should follow the system`);
  }
});

test('following the system sets no attribute and keeps nothing', () => {
  assert.equal(themeAttribute('system'), null);
  assert.equal(storedTheme('system'), null);
  assert.equal(themeAttribute('light'), 'light');
  assert.equal(themeAttribute('dark'), 'dark');
});

test('every choice survives being kept and read back', () => {
  for (const c of THEME_CHOICES) assert.equal(parseThemeChoice(storedTheme(c)), c);
  assert.deepEqual([...THEME_CHOICES], ['system', 'light', 'dark']);
});

// index.html sets the kept theme before the app's code loads, with its own few lines; they must
// read the same key and accept the same values as src/theme.ts, or a choice would flash or be lost.
test('the page applies the kept theme before first paint with the same key and values', () => {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const head = html.slice(0, html.indexOf('</head>'));
  const inline = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  assert.ok(inline.includes(`localStorage.getItem('${THEME_KEY}')`), 'the inline script reads another key');
  assert.match(inline, /=== 'light' \|\| \w+ === 'dark'/);
  assert.match(inline, /document\.documentElement\.dataset\.theme = /);
  assert.match(inline, /try \{[\s\S]*\} catch/, 'storage can throw; the script must not');
  // and it runs before the app's module and the stylesheets that read data-theme
  assert.ok(head.indexOf('<script>') < head.indexOf('stylesheet'));
});
