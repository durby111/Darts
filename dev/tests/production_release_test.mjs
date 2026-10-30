/** Local production artifact/link/cache audit. No browser or real storage. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
let passed=0;const pass=t=>{passed++;console.log('PASS '+t);};
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const context=vm.createContext({}),modules=new Map();
function moduleFor(file){
 const name=path.resolve(file);if(modules.has(name))return modules.get(name);
 assert.ok(name.startsWith(root+path.sep)&&!name.startsWith(path.join(root,'dev')+path.sep),name);
 const mod=new vm.SourceTextModule(fs.readFileSync(name,'utf8'),{context,identifier:pathToFileURL(name).href});modules.set(name,mod);return mod;
}
for(const name of ['js/app.js','js/platform-nav.js','js/theme.js']){
 const mod=moduleFor(path.join(root,name));if(mod.status==='unlinked')await mod.link((s,ref)=>moduleFor(fileURLToPath(new URL(s,ref.identifier))));
}
pass(`${modules.size} actual production startup modules parse/link with all static exports and paths present`);
const html=read('index.html');assert.ok(!html.includes('class="dev-build"'));assert.ok(!html.includes('css/dev.css'));assert.ok(html.includes('<title>BlakeOut Darts</title>'));
for(const m of html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)"/g))assert.ok(fs.existsSync(path.join(root,m[1])),m[1]);
const manifest=JSON.parse(read('manifest.json'));assert.equal(manifest.name,'BlakeOut Darts');assert.equal(manifest.short_name,'BlakeOut');
assert.ok(!read('js/feature-availability.js').includes('FEATURE_TEST_ROUTES'));
assert.ok(read('dev/js/feature-availability.js').includes('FEATURE_TEST_ROUTES'));
assert.ok(read('js/feature-availability.js').includes('brackets: false'));assert.ok(read('js/feature-availability.js').includes('accounts: false'));
for(const feature of ['accounts','brackets']){
 const page=read(feature+'/index.html');assert.ok(page.includes('Coming soon'));
 assert.ok(!/<form\b|<template\b|accounts-page|brackets\/page|feature-page|dev-build|dev-badge/.test(page));
 assert.equal((page.match(/<button[^>]*disabled/g)||[]).length,2);
 assert.ok(!/href="(?!\.\.\/|\.\.\/css\/)[^\"]+"/.test(page));
}
pass('production identity retained; both direct feature routes are static disabled shells without account apps');
// BotBlake is DEV-only; pin released scorer source instead of requiring DEV parity.
for(const rel of ['js/state.js','js/app.js','js/setup.js','js/teams.js','js/x01.js','js/cricket.js']) assert.equal(read(rel),execFileSync('git',['show','e2a5a48:'+rel],{cwd:root,encoding:'utf8'}),rel);
assert.equal(read('js/scoring-records.js'),read('dev/js/scoring-records.js'));
// The isolated DEV backend now adds origin guards to its casual-recording path.
// Production must remain exactly the approved baseline, not acquire DEV transport.
assert.equal(read('js/casual-recording.js'),execFileSync('git',['show','bed1772:js/casual-recording.js'],{cwd:root,encoding:'utf8'}));
assert.ok(read('dev/js/casual-recording.js').includes('requireCurrentBackend(session)'));
assert.ok(!fs.existsSync(path.join(root,'js/platform.js')));assert.ok(!fs.existsSync(path.join(root,'js/account-email.js')));
// DEV now has a separately isolated device-local tournament mode. Preserve the
// released production files byte-for-byte instead of requiring new DEV parity.
for (const file of ['js/build-context.js','js/tournament-bridge.js','js/firebase.js']) {
 assert.equal(read(file),execFileSync('git',['show','8a1d7d7:'+file],{cwd:root,encoding:'utf8'}),file);
}
pass('released scorer modules preserved; intentionally divergent DEV tournament modules leave released production unchanged; account transport not promoted');
for(const build of ['','dev/']){
 const href='https://example.test/'+build+'sw.js';const ctx=vm.createContext({URL,self:{location:{href,origin:'https://example.test'},addEventListener(){}}});
 vm.runInContext(read(build+'sw.js')+'\nthis.audit={CACHE_NAME,ASSETS,isOwnCache,isOwnPath};',ctx);const a=ctx.audit;
 assert.ok(a.CACHE_NAME.startsWith(build?'blakeout-dev-':'blakeout-v'));
 for(const asset of a.ASSETS)assert.ok(fs.existsSync(path.resolve(root,build,asset)),`${build}:${asset}`);
 assert.equal(a.isOwnCache('blakeout-dev-v54-winner'),!!build);
 assert.equal(a.isOwnCache('blakeout-v38'),!build);assert.equal(a.isOwnCache('unrelated'),false);
 assert.equal(a.isOwnPath(new URL('https://example.test/dev/js/app.js')),!!build);
 assert.equal(a.isOwnPath(new URL('https://example.test/js/app.js')),!build);
 assert.match(read(build+'sw.js'), /caches\.open\(CACHE_NAME\)\.then\((?:async )?cache =>/);
 assert.ok(!read(build+'sw.js').includes('caches.match(request)')); // Never fall back across build cache families.
}
pass('both precaches complete; cache families, request paths and offline fallbacks isolated');
const changed=execFileSync('git',['diff','--name-only','HEAD'],{cwd:root,encoding:'utf8'}).trim().split('\n');
for(const file of ['manifest.json','firebase.json','firestore.rules','js/firebase.js','js/firebase-config.js'])assert.ok(!changed.includes(file),file);
assert.ok(!changed.some(p=>p.startsWith('dev/email-worker/')));
pass('production manifest, Firebase config/rules/transport and email infrastructure unchanged');
console.log(`\n${passed}/${passed} production artifact groups passed. Live browser, offline device behavior and deployment need separate checks.`);
