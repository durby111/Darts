/** Actual module tests with DOM fixtures; not a browser certification. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const dev=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(dev,p),'utf8');
let passed=0; const pass=t=>{passed++;console.log('PASS '+t);};
class Node {
    constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.dataset={};this.disabled=false;this.className='';this.classList={add:c=>{this.className+=' '+c;}};}
    setAttribute(k,v){this.attrs[k]=v;}
    append(...nodes){this.children.push(...nodes);}
    cloneNode(deep){const n=new Node(this.tag);for(const k of ['textContent','type','href','disabled','className'])if(k in this)n[k]=this[k];n.attrs={...this.attrs};n.dataset={...this.dataset};if(deep)n.children=this.children.map(c=>c.cloneNode(true));return n;}
}
const attached=[];const menu=new Node('menu');
const context=vm.createContext({URL,document:{createElement:t=>new Node(t),querySelector:s=>s==='.setup-header'?{after:n=>attached.push(n)}:s==='#gameMenuModal .modal-content'?menu:null}});
const flags=new vm.SourceTextModule(read('js/feature-availability.js'),{context});await flags.link(()=>{});await flags.evaluate();
for(const f of ['accounts','brackets','unknown'])assert.equal(flags.namespace.isFeatureAvailable(f),false);
assert.equal(Object.isFrozen(flags.namespace.FEATURE_AVAILABILITY),true);
assert.equal(flags.namespace.featureTestPath('brackets'),'preview/brackets/');
assert.equal(flags.namespace.featureTestPath('accounts'),'preview/accounts/');
assert.equal(flags.namespace.featureTestPath('unknown'),null);
pass('real providers remain off; explicit sample test routes are available without bypasses');
const nav=new vm.SourceTextModule(read('js/platform-nav.js'),{context,initializeImportMeta:m=>{m.url='https://example.test/dev/js/platform-nav.js';}});
await nav.link(s=>{assert.equal(s,'./feature-availability.js');return flags;});await nav.evaluate();
for(const row of [attached[0],menu.children[0]]){
    assert.equal(row.children.length,3);
    assert.equal(row.children[0].tag,'a');assert.equal(row.children[0].href,'https://example.test/dev/');
    for(const [i,f] of [[1,'brackets'],[2,'accounts']]){
        const b=row.children[i];assert.equal(b.tag,'a');assert.equal(b.disabled,false);
        assert.equal(b.dataset.appFeature,f);assert.equal(b.href,`https://example.test/dev/preview/${f}/`);
        assert.equal(b.children[0].textContent,'Sample');

    }
}
pass('setup and cloned Game Menu expose active, clearly labeled sample links');
for(const feature of ['accounts','brackets','unknown']){
    let dynamic=0,domAccess=0; const destinations=[];
    const ctx=vm.createContext({URL,location:{replace:url=>destinations.push(url)},document:{body:{dataset:{appFeature:feature}},getElementById(){domAccess++;throw Error('Locked page touched live feature DOM');}}});
    const flag=new vm.SourceTextModule(read('js/feature-availability.js'),{context:ctx});await flag.link(()=>{});await flag.evaluate();
    const theme=new vm.SyntheticModule([],()=>{},{context:ctx});await theme.link(()=>{});await theme.evaluate();
    const boot=new vm.SourceTextModule(read('js/feature-page.js'),{context:ctx,initializeImportMeta:m=>{m.url='https://example.test/dev/js/feature-page.js';},importModuleDynamically:()=>{dynamic++;throw Error('Feature initialized');}});
    await boot.link(s=>s==='./feature-availability.js'?flag:theme);await boot.evaluate();
    assert.equal(dynamic,0);assert.equal(domAccess,0);
    assert.deepEqual(destinations,feature==='unknown'?[]:[`https://example.test/dev/preview/${feature}/`]);
}
pass('direct routes enter samples without importing providers or consuming real action tokens');
const htmlResult=execFileSync('python3',['-c',String.raw`
from html.parser import HTMLParser
from pathlib import Path
import json,sys
class Audit(HTMLParser):
 def __init__(self): super().__init__();self.depth=0;self.forms=0;self.scripts=[];self.links=[];self.buttons=[];self.template=False
 def handle_starttag(self,t,a):
  a=dict(a)
  if t=='template': self.depth+=1;self.template=True;return
  if self.depth:return
  if t=='form':self.forms+=1
  if t=='script':self.scripts.append(a.get('src'))
  if t=='a':self.links.append(a.get('href'))
  if t=='button':self.buttons.append('disabled' in a)
 def handle_endtag(self,t):
  if t=='template':self.depth-=1
root=Path(sys.argv[1])
for feature in ['accounts','brackets']:
 s=(root/feature/'index.html').read_text();p=Audit();p.feed(s)
 assert p.template and p.depth==0
 assert p.forms==0,(feature,'live form')
 assert p.scripts==['../js/feature-page.js'],p.scripts
 assert p.links and all(h in ['../','../preview/accounts/','../preview/brackets/'] for h in p.links),p.links
 assert '../preview/'+feature+'/' in p.links
 assert 'Coming soon' not in s
 assert p.buttons==[],p.buttons
 assert 'data-app-feature="'+feature+'"' in s
print(json.dumps({'routes':['accounts/','accounts/index.html','brackets/','brackets/index.html'],'forms':0,'sample_feature_links':3}))
`,dev],{encoding:'utf8'});
console.log(htmlResult.trim());pass('static fallback offers working sample links; real-provider markup stays inert');
const sw=read('sw.js');for(const asset of ['./js/feature-availability.js','./js/feature-page.js','./css/feature-availability.css','./js/build-context.js'])assert.ok(sw.includes("'"+asset+"'"));
assert.ok(read('js/firebase.js').includes('getRosterId'));
pass('gate/build assets precached; ordinary roster module retained');
console.log(`\n${passed}/${passed} availability groups passed. Pointer, keyboard, navigation/cache runtime and backend permissions require separate verification.`);
