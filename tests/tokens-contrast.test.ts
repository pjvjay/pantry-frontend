// The design tokens' contrast, checked where the colours are set. tokens.css holds a light set
// (:root) and a dark set written twice, once under the system's dark preference and once for a
// chosen dark theme. This reads the file as text, works out each colour (following var() inside
// a set, and falling back to light for a token dark does not redefine), and holds every pair the
// tokens document to its WCAG 2 ratio in both sets. A failure means a token is wrong, not this
// test: change the colour until the pair passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TOKENS = join(ROOT, 'src', 'styles', 'tokens.css');
const css = readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// The body of the block that opens at `open` (the index of its "{"), braces balanced.
function blockAt(text: string, open: number): string {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i);
  }
  throw new Error('unbalanced braces');
}

function bodyOf(text: string, selector: string, from = 0): string {
  const at = text.indexOf(selector, from);
  assert.notEqual(at, -1, `tokens.css has no ${selector} block`);
  return blockAt(text, text.indexOf('{', at));
}

function declarations(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

// The first top-level :root block is the light set.
const lightAt = css.search(/^:root\s*\{/m);
assert.notEqual(lightAt, -1, 'tokens.css has no top-level :root block');
const lightBody = blockAt(css, css.indexOf('{', lightAt));
const light = declarations(lightBody);
const darkMedia = bodyOf(css, '@media (prefers-color-scheme: dark)');
const darkSystem = declarations(bodyOf(darkMedia, ':root:not([data-theme="light"])'));
const darkChosen = declarations(bodyOf(css, ':root[data-theme="dark"]'));

// A set: light's tokens with dark's on top, as the cascade gives them.
const SETS: Record<string, Map<string, string>> = {
  light,
  dark: new Map([...light, ...darkSystem]),
};

function resolveIn(set: Map<string, string>, name: string, seen: string[] = []): string {
  const value = set.get(name);
  assert.ok(value !== undefined, `--${name.replace(/^--/, '')} is not defined`);
  const ref = /^var\((--[\w-]+)\)$/.exec(value);
  if (!ref) return value;
  assert.ok(!seen.includes(ref[1]), `var() cycle through ${ref[1]}`);
  return resolveIn(set, ref[1], [...seen, name]);
}

function rgbOf(value: string): [number, number, number] {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  assert.ok(hex, `${value} is not an opaque hex colour`);
  const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

// WCAG 2 relative luminance and contrast ratio.
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(rgbOf(a)), luminance(rgbOf(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// What each token is documented to sit on, and the ratio it needs there.
const TEXT = 4.5;
const EDGE = 3;
const PAIRS: [fg: string, bgs: string[], need: number, why: string][] = [
  ['--text', ['--bg', '--panel', '--surface-2', '--popover', '--accent-soft'], TEXT, 'body text'],
  ['--muted', ['--bg', '--panel', '--surface-2', '--popover'], TEXT, 'secondary text at 12-13px'],
  // a Notice and the OfflinePanel (styles/ui.css) write their words and hints on the soft fills
  ['--text', ['--danger-soft', '--warn-soft', '--info-soft'], TEXT, "a notice's words"],
  ['--muted', ['--danger-soft', '--warn-soft', '--info-soft', '--accent-soft'], TEXT, "a notice's hint"],
  ['--accent-soft-fg', ['--accent-soft'], TEXT, 'words on a soft accent tag or chip'],
  ['--danger-fg', ['--danger-soft', '--panel', '--bg'], TEXT, 'an error said in words'],
  ['--warn', ['--bg', '--panel', '--surface-2', '--warn-soft'], TEXT, 'a warning said in words'],
  ['--info', ['--info-soft'], TEXT, 'an info tag'],
  ['--accent', ['--bg', '--panel'], TEXT, 'links'],
  ['--on-accent', ['--accent', '--accent-hover'], TEXT, 'a primary button, at rest and hovered'],
  ['--on-danger', ['--danger', '--danger-fg'], TEXT, 'a danger button, at rest and hovered'],
  ['--line-strong', ['--panel', '--bg'], EDGE, 'drop zones and the selected row'],
  ['--border-ui', ['--panel', '--bg'], EDGE, 'the edge of a control'],
  ['--accent', ['--panel', '--bg'], EDGE, 'accent marks and outlines'],
  ['--accent', ['--accent-soft'], EDGE, "a success notice's edge"],
  ['--danger', ['--panel', '--danger-soft'], EDGE, "the status dot when the API is offline, a danger notice's edge"],
  ['--focus', ['--panel', '--bg'], EDGE, 'the focus ring'],
];

for (const [setName, set] of Object.entries(SETS)) {
  for (const [fg, bgs, need, why] of PAIRS) {
    for (const bg of bgs) {
      test(`${setName}: ${fg} on ${bg} is at least ${need}:1 (${why})`, () => {
        const ratio = contrast(resolveIn(set, fg), resolveIn(set, bg));
        assert.ok(ratio >= need,
          `${fg} ${resolveIn(set, fg)} on ${bg} ${resolveIn(set, bg)} is ${ratio.toFixed(2)}:1, under ${need}:1`);
      });
    }
  }
}

test('the ratio is computed as WCAG defines it', () => {
  assert.equal(contrast('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrast('#777777', '#ffffff').toFixed(2), '4.48');
  assert.equal(contrast('#ffffff', '#ffffff'), 1);
});

test('the chosen dark theme is the same set as the system dark one', () => {
  assert.deepEqual([...darkChosen].sort(), [...darkSystem].sort());
});

test('dark redefines no token that light lacks, and names a colour scheme in each set', () => {
  for (const name of darkSystem.keys()) assert.ok(light.has(name), `${name} is defined only in dark`);
  assert.match(lightBody, /color-scheme:\s*light\s*;/);
  assert.match(bodyOf(darkMedia, ':root:not([data-theme="light"])'), /color-scheme:\s*dark\s*;/);
  assert.match(bodyOf(css, ':root[data-theme="dark"]'), /color-scheme:\s*dark\s*;/);
});

test('reduced motion sets every duration token to zero', () => {
  const reduced = declarations(bodyOf(bodyOf(css, '@media (prefers-reduced-motion: reduce)'), ':root'));
  const durations = [...light.keys()].filter((k) => k.startsWith('--dur-'));
  assert.ok(durations.length >= 4);
  for (const d of durations) assert.equal(reduced.get(d), '0ms', `${d} is not zeroed`);
});

// The theme menu sets data-theme on <html>; a dark rule keyed only to the system's preference
// would ignore it. So in every stylesheet, a rule under prefers-color-scheme: dark applies only
// when the shopper has not chosen light, and the same rule exists for a chosen dark.
function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return cssFiles(path);
    return e.name.endsWith('.css') ? [path] : [];
  });
}

test('every dark-mode rule in the stylesheets follows the theme choice', () => {
  for (const file of cssFiles(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    let from = 0;
    for (;;) {
      const at = text.indexOf('@media (prefers-color-scheme: dark)', from);
      if (at === -1) break;
      const body = blockAt(text, text.indexOf('{', at));
      for (const m of body.matchAll(/([^{}]+)\{/g)) {
        for (const sel of m[1].split(',').map((s) => s.trim())) {
          assert.ok(sel.startsWith(':root:not([data-theme="light"])'),
            `${file}: "${sel}" under prefers-color-scheme: dark ignores a chosen light theme`);
          const chosen = sel.replace(':root:not([data-theme="light"])', ':root[data-theme="dark"]');
          assert.ok(text.includes(chosen), `${file}: no "${chosen}" rule for a chosen dark theme`);
        }
      }
      from = at + 1;
    }
  }
});

// Colours live in tokens.css. Elsewhere a rule names a token, except where a token cannot reach:
// the printed list (always black on white) and a dialog's ::backdrop (older browsers do not pass
// custom properties into it).
test('no stylesheet but tokens.css writes a raw colour', () => {
  for (const file of cssFiles(join(ROOT, 'src')).filter((f) => f !== TOKENS)) {
    let text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (;;) {
      const at = text.indexOf('@media print');
      if (at === -1) break;
      const open = text.indexOf('{', at);
      text = text.slice(0, at) + text.slice(open + blockAt(text, open).length + 2);
    }
    text = text.replace(/[^{}]*::backdrop\s*\{[^}]*\}/g, '');
    const raw = text.match(/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\(/gi) ?? [];
    assert.deepEqual(raw, [], `${file} writes raw colours: ${raw.join(', ')}`);
  }
});
