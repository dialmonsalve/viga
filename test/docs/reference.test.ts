import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';

const MODULES = [
  'config',
  'validation',
  'testing',
  'pagination',
  'i18n',
  'drizzle',
  'websocket',
  'health',
  'crypto',
  'events',
  'workers',
  'upload',
];

function declaredIn(file: string) {
  const names = new Set<string>();
  const source = readFileSync(file, 'utf8');

  for (const [, name] of source.matchAll(
    /^export (?:declare )?(?:abstract )?(?:class|function|const|interface|type) (\w+)/gm
  )) {
    if (name) names.add(name);
  }

  return names;
}

function exportsOf(file: string): Set<string> {
  const names = new Set<string>();
  const source = readFileSync(file, 'utf8');

  for (const [, target] of source.matchAll(/^export \* from '(.+)';/gm)) {
    if (!target) continue;
    const path = join(dirname(file), target);
    for (const name of [...declaredIn(path), ...exportsOf(path)]) names.add(name);
  }

  for (const [, list] of source.matchAll(/^export (?:type )?\{([^}]*)\}/gm)) {
    for (const item of (list ?? '').split(',')) {
      const name = item.trim().replace(/^type /, '');
      if (name) names.add(name);
    }
  }

  return names;
}

function sectionOf(page: string, module: string) {
  const start = page.indexOf(`\n## viga/${module}\n`);
  assert.notEqual(start, -1, `falta la sección viga/${module}`);

  const end = page.indexOf('\n## ', start + 1);
  return end === -1 ? page.slice(start) : page.slice(start, end);
}

function missing(names: Iterable<string>, text: string) {
  return [...names].filter((name) => !new RegExp(`\\b${name}\\b`).test(text));
}

const reference = (lang: string, page: string) => `docs/src/content/docs/${lang}/reference/${page}.md`;
const languages = ['es', 'en', 'pt'].filter((lang) => existsSync(reference(lang, 'core')));

describe('la referencia de la API', () => {
  for (const lang of languages) {
    it(`documenta todo lo que exporta viga (${lang})`, () => {
      const page = readFileSync(reference(lang, 'core'), 'utf8');
      assert.deepEqual(missing(exportsOf('src/index.ts'), page), []);
    });

    for (const module of MODULES) {
      it(`documenta todo lo que exporta viga/${module} (${lang})`, () => {
        const page = readFileSync(reference(lang, 'modules'), 'utf8');
        assert.deepEqual(missing(exportsOf(`src/${module}/index.ts`), sectionOf(page, module)), []);
      });
    }
  }

  it('cubre todos los módulos publicados', () => {
    const { exports } = JSON.parse(readFileSync('package.json', 'utf8'));
    const published = Object.keys(exports)
      .filter((path) => /^\.\/[a-z0-9-]+$/.test(path))
      .map((path) => path.slice(2));
    assert.deepEqual(published.sort(), [...MODULES].sort());
  });
});
