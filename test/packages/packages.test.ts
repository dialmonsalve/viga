import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const SUBPATHS = ['validation', 'i18n', 'drizzle', 'config', 'pagination', 'websocket', 'testing', 'health', 'crypto', 'events', 'workers', 'upload'];
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const core = JSON.parse(read('package.json'));

describe('paquetes publicados', () => {
  for (const sub of SUBPATHS) {
    it(`@vigajs/${sub} reexporta su subruta con la misma versión`, () => {
      const pkg = JSON.parse(read(`packages/${sub}/package.json`));

      assert.equal(pkg.name, `@vigajs/${sub}`);
      assert.equal(pkg.version, core.version);
      assert.equal(pkg.peerDependencies['@vigajs/core'], `^${core.version}`);
      assert.ok(core.exports[`./${sub}`], `falta la subruta ./${sub} en @vigajs/core`);
      for (const file of ['index.js', 'index.d.ts']) {
        assert.equal(read(`packages/${sub}/${file}`), `export * from '@vigajs/core/${sub}';\n`);
      }
    });
  }

  it('@vigajs/create instala las versiones actuales', () => {
    assert.equal(JSON.parse(read('packages/create/package.json')).version, core.version);
    const source = read('packages/create/index.js');
    assert.ok(source.includes(`'@vigajs/core': '^${core.version}'`));
    assert.ok(source.includes(`'@vigajs/validation': '^${core.version}'`));
  });

  it('las dependencias opcionales de cada paquete coinciden con las de @vigajs/core', () => {
    for (const sub of ['drizzle', 'websocket', 'upload']) {
      const pkg = JSON.parse(read(`packages/${sub}/package.json`));
      for (const [name, range] of Object.entries(pkg.peerDependencies)) {
        if (name !== '@vigajs/core') assert.equal(range, core.peerDependencies[name], `${sub} ${name}`);
      }
    }
  });
});
