// Validate the precached ES-module graph before a first offline reload.
// Run: node --experimental-vm-modules dev/tests/offline_module_graph_test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = 'https://offline.example/dev/';
const context = vm.createContext({
    URL,
    self: { location: new URL('sw.js', base), addEventListener() {} },
});
vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8')
    + '\nglobalThis.precache = ASSETS;', context);
const assets = new Set(context.precache.map(asset => new URL(asset, base).href));
const missing = [];
let modules = 0;
for (const url of assets) {
    if (!url.endsWith('.js')) continue;
    const relative = url.slice(base.length);
    const module = new vm.SourceTextModule(fs.readFileSync(path.join(root, relative), 'utf8'));
    modules++;
    for (const dependency of module.dependencySpecifiers) {
        if (!dependency.startsWith('.')) continue;
        const resolved = new URL(dependency, url).href;
        if (!assets.has(resolved)) missing.push(`${relative} -> ${dependency}`);
    }
}
assert.deepEqual(missing, [], 'Every static local dependency of a precached module must be precached');
console.log(`PASS ${modules} precached modules: every static local dependency is available on first offline reload`);
