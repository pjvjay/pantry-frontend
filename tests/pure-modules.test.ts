// The rule for pure modules, enforced. A pure module holds logic that node --test runs as it is
// written, with no bundler in between, so it:
//   - starts with the "// Pure module:" header that states this rule where it is read;
//   - imports only other pure modules (or, for types only, src/types.ts), by relative path with
//     the .ts extension, which is the only form node resolves; no packages, so no React;
//   - uses no DOM global and no import.meta (import.meta.env exists only under Vite).
// Pure modules are every src/mealplan/*.ts, the other files the plan names, and any file in src
// that carries the header. Each one must also load under node, which proves nothing at module
// level reaches for the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const HEADER = '// Pure module:';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const NAMED = ['alternatives.ts', 'recipes.ts', 'nutritionFormat.ts', 'selectionPreview.ts']
  .map((f) => join(SRC, f));
// Types only: erased before node runs anything, so they may come from the shared type file.
const TYPE_SOURCES = new Set([join(SRC, 'types.ts')]);
const DOM_GLOBALS = new Set(['window', 'document', 'navigator', 'localStorage', 'sessionStorage',
  'requestAnimationFrame', 'matchMedia', 'getComputedStyle']);

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsFiles(path);
    return e.name.endsWith('.ts') && !e.name.endsWith('.d.ts') ? [path] : [];
  });
}

const mealplanDir = join(SRC, 'mealplan');
const pure = new Set([
  ...(existsSync(mealplanDir) ? readdirSync(mealplanDir).filter((f) => f.endsWith('.ts'))
    .map((f) => join(mealplanDir, f)) : []),
  ...NAMED.filter((f) => existsSync(f)),
  ...tsFiles(SRC).filter((f) => readFileSync(f, 'utf8').startsWith(HEADER)),
]);

const rel = (f: string) => relative(ROOT, f);

// Every way the rule can be broken in one file, as readable lines.
function problems(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  if (!text.startsWith(HEADER)) out.push(`does not start with "${HEADER}"`);
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const at = (node: ts.Node) => `line ${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const checkImport = (node: ts.Node, spec: string, typeOnly: boolean) => {
    if (!spec.startsWith('./') && !spec.startsWith('../')) {
      out.push(`${at(node)}: imports the package "${spec}"`);
      return;
    }
    if (spec.endsWith('.tsx')) {
      out.push(`${at(node)}: imports "${spec}", a React module`);
      return;
    }
    if (!spec.endsWith('.ts')) {
      out.push(`${at(node)}: "${spec}" must name its .ts file for node to resolve it`);
      return;
    }
    const target = resolve(dirname(file), spec);
    if (!existsSync(target)) out.push(`${at(node)}: "${spec}" does not exist`);
    else if (!pure.has(target) && !(typeOnly && TYPE_SOURCES.has(target))) {
      out.push(`${at(node)}: "${spec}" is not a pure module`);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      checkImport(node, node.moduleSpecifier.text, node.importClause?.isTypeOnly ?? false);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) {
      checkImport(node, node.moduleSpecifier.text, node.isTypeOnly);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) checkImport(node, arg.text, false);
      else out.push(`${at(node)}: import() of a computed path`);
    } else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
      out.push(`${at(node)}: uses import.meta`);
    } else if (ts.isIdentifier(node) && (DOM_GLOBALS.has(node.text) || /^HTML\w*Element$/.test(node.text))) {
      // `x.document` or `{ document: … }` name a property, not the browser's global
      const p = node.parent;
      const propertyName = (ts.isPropertyAccessExpression(p) && p.name === node)
        || ((ts.isPropertyAssignment(p) || ts.isPropertySignature(p)) && p.name === node);
      if (!propertyName) out.push(`${at(node)}: uses the DOM's ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return out;
}

test('the meal planner has pure modules to check', () => {
  assert.ok(pure.has(join(mealplanDir, 'dates.ts')) && pure.has(join(mealplanDir, 'model.ts')),
    [...pure].map(rel).join(', '));
});

for (const file of [...pure].sort()) {
  test(`${rel(file)} keeps the pure-module rule`, () => {
    assert.deepEqual(problems(file), []);
  });

  test(`${rel(file)} loads under node`, async () => {
    await import(pathToFileURL(file).href);
  });
}

// The checker itself: each kind of break is caught, so a clean result above means something.
test('the rule catches each way a module can break it', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'pure-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cases: [string, string, RegExp][] = [
    ['no-header.ts', 'export const x = 1;\n', /does not start with/],
    ['react.ts', `${HEADER} x\nimport { useState } from 'react';\nexport const x = useState;\n`,
      /imports the package "react"/],
    ['bare.ts', `${HEADER} x\nimport { x } from './sibling';\nexport const y = x;\n`,
      /must name its \.ts file/],
    ['tsx.ts', `${HEADER} x\nimport { x } from './view.tsx';\nexport const y = x;\n`,
      /a React module/],
    ['env.ts', `${HEADER} x\nexport const base = import.meta.env.BASE_URL;\n`, /import\.meta/],
    ['dom.ts', `${HEADER} x\nexport const w = () => window.innerWidth;\n`, /DOM's window/],
    ['el.ts', `${HEADER} x\nexport type E = HTMLDivElement;\n`, /DOM's HTMLDivElement/],
  ];
  for (const [name, body, expected] of cases) {
    const file = join(dir, name);
    writeFileSync(file, body);
    assert.match(problems(file).join('\n'), expected, name);
  }
  const fine = join(dir, 'fine.ts');
  writeFileSync(fine, `${HEADER} x\nexport const o = { document: 1, window: 2 };\n`
    + 'export const d = (x: { document: number }) => x.document;\n');
  assert.deepEqual(problems(fine), []);
});
