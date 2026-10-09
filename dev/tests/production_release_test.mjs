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
assert.equal(read('js/feature-availability.js'),read('dev/js/feature-availability.js'));
assert.ok(read('js/feature-availability.js').includes('brackets: false'));assert.ok(read('js/feature-availability.js').includes('accounts: false'));
for(const feature of ['accounts','brackets']){
 const page=read(feature+'/index.html');assert.ok(page.includes('Coming soon'));
 assert.ok(!/<form\b|<template\b|accounts-page|brackets\/page|feature-page|dev-build|dev-badge/.test(page));
 assert.equal((page.match(/<button[^>]*disabled/g)||[]).length,2);
 assert.ok(!/href="(?!\.\.\/|\.\.\/css\/)[^\"]+"/.test(page));
}
pass('production identity retained; both direct feature routes are static disabled shells without account apps');
for(const rel of ['js/state.js','js/app.js','js/build-context.js','js/casual-recording.js','js/tournament-bridge.js','js/scoring-records.js'])assert.equal(read(rel),read('dev/'+rel),rel);
assert.ok(!fs.existsSync(path.join(root,'js/platform.js')));assert.ok(!fs.existsSync(path.join(root,'js/account-email.js')));
pass('tested scorer/build-isolation modules copied exactly; account transport not promoted');
for(const build of ['','dev/']){
 const href='https://example.test/'+build+'sw.js';const ctx=vm.createContext({URL,self:{location:{href,origin:'https://example.test'},addEventListener(){}}});
 vm.runInContext(read(build+'sw.js')+'\nthis.audit={CACHE_NAME,ASSETS,isOwnCache,isOwnPath};',ctx);const a=ctx.audit;
 assert.ok(a.CACHE_NAME.startsWith(build?'blakeout-dev-':'blakeout-v'));
 for(const asset of a.ASSETS)assert.ok(fs.existsSync(path.resolve(root,build,asset)),`${build}:${asset}`);
 assert.equal(a.isOwnCache('blakeout-dev-v54-winner'),!!build);
 assert.equal(a.isOwnCache('blakeout-v38'),!build);assert.equal(a.isOwnCache('unrelated'),false);
 assert.equal(a.isOwnPath(new URL('https://example.test/dev/js/app.js')),!!build);
 assert.equal(a.isOwnPath(new URL('https://example.test/js/app.js')),!build);
 assert.ok(read(build+'sw.js').includes('caches.open(CACHE_NAME).then(cache => cache.match(request))'));
}
pass('both precaches complete; cache families, request paths and offline fallbacks isolated');
const changed=execFileSync('git',['diff','--name-only','HEAD'],{cwd:root,encoding:'utf8'}).trim().split('\n');
for(const file of ['manifest.json','firebase.json','firestore.rules','js/firebase.js','js/firebase-config.js'])assert.ok(!changed.includes(file),file);
assert.ok(!changed.some(p=>p.startsWith('dev/email-worker/')));
pass('production manifest, Firebase config/rules/transport and email infrastructure unchanged');
console.log(`\n${passed}/${passed} production artifact groups passed. Live browser, offline device behavior and deployment need separate checks.`);
