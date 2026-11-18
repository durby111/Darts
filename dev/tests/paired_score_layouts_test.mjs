// Scorer presentation packaging contract. Browser tests are separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=path=>fs.readFileSync(new URL(path,root),'utf8');
for(const prefix of ['', 'dev/']){
 const html=read(prefix+'index.html'),prefs=read(prefix+'js/score-appearance.js'),sw=read(prefix+'sw.js');
 assert.match(prefs,/const DEFAULT_SKIN = 'modern'/);
 for(const [id,file] of [['fable','fable'],['astra','astra-flight-deck']]){
  assert.equal(prefs.split("id: '"+id+"'").length,2);
  assert.equal(html.split('href="css/'+file+'.css"').length,2);
  assert.equal(sw.split('./css/'+file+'.css').length,2);
  assert.equal(read('css/'+file+'.css'),read('dev/css/'+file+'.css'));
 }
 const astra=read(prefix+'css/astra-flight-deck.css').replace(/\/\*[\s\S]*?\*\//g,'');
 const gate=':root[data-scoreboard-mode="astra"] #gameScreen[data-scoreboard-family="x01"]';
 for(const line of astra.trim().split('\n').map(s=>s.trim()).filter(s=>s&&s!=='}')){
  assert.ok(line.startsWith(gate)||line.startsWith('@media'),line);
 }
 assert.ok(!/@import|url\(/.test(astra));
 assert.ok(astra.includes('min-height:44px')&&astra.includes('ON THROW'));
 console.log('PASS '+(prefix||'production')+': registered once, Modern default, precached, paired CSS parity, no external assets or cross-game Astra selectors');
}
