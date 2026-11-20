import assert from 'node:assert/strict';
import fs from 'node:fs';
const read = f => fs.readFileSync(new URL('../'+f, import.meta.url),'utf8');
const html=read('index.html'), app=read('js/app.js'), worker=read('sw.js');
const styles=[...app.matchAll(/registerMenuStyle\('([^']+)', '([^']+)'\)/g)];
assert.ok(styles.length && new Set(styles.map(x=>x[1])).size===styles.length);
for (const [, id,label] of styles) {
    assert.ok(['astra62','fable52','neon'].includes(id));
    assert.equal(label,{astra62:'Astra 6.2',fable52:'Fable 5.2',neon:'Neon'}[id]);
    const filename='css/menu-'+id+'.css';
    assert.ok(html.includes('href="'+filename+'"'), filename);
    assert.ok(worker.includes("'./"+filename+"'"), filename);
    assert.ok(read(filename).includes('[data-menu-style="'+id+'"]'),filename);
}
for (const file of ['js/menu-style.js','css/menu-style-picker.css']) assert.ok(worker.includes("'./"+file+"'"),file);
assert.ok(html.includes('href="css/menu-style-picker.css"'));
console.log('PASS registered styles shipped and precached:',styles.map(x=>x[2]).join(', '));
