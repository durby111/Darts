// Release-specific artifact checks. No live data, cloud requests or storage writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const prior=p=>execFileSync('git',['show','9d630eb:'+p],{cwd:root,encoding:'utf8'});
const modules=new Map(),context=vm.createContext({});
function moduleFor(file){
 const name=path.resolve(file);if(modules.has(name))return modules.get(name);
 assert(name.startsWith(root+path.sep)&&!name.startsWith(root+'/dev/'),name);
 const module=new vm.SourceTextModule(fs.readFileSync(name,'utf8'),{context,identifier:pathToFileURL(name).href});modules.set(name,module);return module;
}
for(const file of ['js/app.js','js/platform-nav.js','local/brackets.js','local/platform.js','js/brackets/page.js']) {
 const mod=moduleFor(path.join(root,file));if(mod.status==='unlinked')await mod.link((specifier,ref)=>moduleFor(fileURLToPath(new URL(specifier,ref.identifier))));
}
console.log(`PASS ${modules.size} production scorer/local-tournament modules parse and link without DEV imports`);
for(const file of ['js/firebase.js','js/firebase-config.js','firestore.rules','js/teams.js','js/settings.js','js/casual-recording.js','js/state.js','js/registry.js']) assert.equal(read(file),prior(file),file+' baseline changed');
assert.equal(read('js/feature-availability.js'),prior('js/feature-availability.js'));
for(const feature of ['accounts','brackets'])assert.equal(read(feature+'/index.html'),prior(feature+'/index.html'));
assert(read('js/setup.js').includes("if (!LOCAL_TOURNAMENT) initFirebase()"));
assert(read('js/setup.js').includes("outcome !== 'saved'"));
assert(!fs.existsSync(path.join(root,'js/platform.js')));
console.log('PASS existing roster implementation, save keys, Bullshit registry and gated cloud routes preserved');
for(const [pathname,search,key] of [['/','', 'blakeout_active_game'],['/','?localTournament=1','blakeout_local_active_game'],['/local/brackets/','','blakeout_local_active_game']]){
 const ctx=vm.createContext({URL,location:{href:'https://blakeoutdarts.com'+pathname+search}});
 const mod=new vm.SourceTextModule(read('js/build-context.js'),{context:ctx,initializeImportMeta(meta){meta.url='https://blakeoutdarts.com/js/build-context.js'}});
 await mod.link(()=>{});await mod.evaluate();assert.equal(mod.namespace.BUILD_STORAGE.activeGame,key);
}
assert(read('local/platform.js').includes("'blakeout_local_tournaments_v1'"));
assert(read('dev/local/platform.js').includes("'blakeout_dev_local_tournaments_v1'"));
console.log('PASS ordinary, production-local and DEV-local data remain distinct');
const ctx=vm.createContext({URL,self:{location:{href:'https://blakeoutdarts.com/sw.js',origin:'https://blakeoutdarts.com'},addEventListener(){}}});
vm.runInContext(read('sw.js')+'\nthis.audit={CACHE_NAME,ASSETS,isOwnPath,isOwnCache};',ctx);
const a=ctx.audit;assert.notEqual(a.CACHE_NAME,prior('sw.js').match(/CACHE_NAME = '([^']+)'/)[1]);
for(const asset of a.ASSETS)assert(fs.existsSync(path.resolve(root,asset)),asset);
for(const name of modules.keys())assert(a.ASSETS.includes('./'+path.relative(root,name)),'Not precached: '+path.relative(root,name));
for(const name of ['./local/brackets/index.html','./local/brackets/template.html','./css/brackets.css'])assert(a.ASSETS.includes(name),'Not precached: '+name);
assert(!a.isOwnPath(new URL('https://blakeoutdarts.com/dev/')));assert(!a.isOwnCache('blakeout-dev-v70'));
console.log('PASS local dependencies precached, cache version updated, DEV cache scope excluded');
