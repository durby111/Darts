import fs from 'node:fs/promises';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pairingAdapter} from './adapter.mjs';
assert.throws(()=>pairingAdapter({db:{app:{options:{projectId:'blakeout-darts-dev'}}},auth:{},sdk:{}}),/Emulator candidate/);
assert.throws(()=>pairingAdapter({db:{app:{options:{projectId:'demo-blakeout-adapter-task3'}}},auth:{app:{}},sdk:{}}),/Emulator candidate/);
console.log('PASS adapter rejects live project and mismatched Auth/Firestore apps before use');
const require=createRequire(import.meta.url),{chromium}=require(process.env.BLAKEOUT_QA_PLAYWRIGHT);
const out=process.env.QR_EVIDENCE,project='demo-blakeout-adapter-task3';
const store='http://127.0.0.1:18085',auth='http://127.0.0.1:19099';
async function local(url,data,method='POST',admin=false){assert([store,auth].includes(new URL(url).origin));const r=await fetch(url,{method,headers:{'Content-Type':'application/json',...(admin?{Authorization:'Bearer owner'}:{})},body:JSON.stringify(data)});const j=await r.json();assert(r.ok,JSON.stringify(j));return j;}
const original=await fs.readFile(out+'/candidate.rules','utf8');
async function rules(boards=[],players=[],pilots=[]){let s=original.replace('function qrBoardUids() { return []; }',`function qrBoardUids() { return ${JSON.stringify(boards)}; }`).replace('function qrPlayerUids() { return []; }',`function qrPlayerUids() { return ${JSON.stringify(players)}; }`).replace(/(function devPilotUids\(\)\s*\{[^}]*return )\[[^\]]*\];/,'$1'+JSON.stringify(pilots)+';');await local(store+`/emulator/v1/projects/${project}:securityRules`,{rules:{files:[{name:'qr-candidate.rules',content:s}]}},'PUT');}
await rules();console.log('PASS empty-role merged rules compile');
const bundle=await fs.readFile(out+'/sdk.js');
const server=http.createServer((req,res)=>{if(req.url==='/sdk.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(bundle);}else{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><title>QR emulator integration</title><h1>Local emulator test</h1>');}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.BLAKEOUT_QA_CHROME,headless:true,args:['--no-sandbox','--disable-background-networking']});
const errors=[],blocked=[];
async function device(role,name,verified=true){const c=await browser.newContext({serviceWorkers:'block'});await c.route('**/*',r=>[base,store,auth].includes(new URL(r.request().url()).origin)?r.continue():(blocked.push(r.request().url()),r.abort()));const p=await c.newPage();p.on('pageerror',e=>errors.push(String(e)));await p.goto(base);
 await p.evaluate(async({role,name})=>{const m=await import('/sdk.js');window.session=await m.emulatorSession(role,name);window.api=session.adapter;window.email=name+'@example.test';window.password='Synthetic-only-123!';await session.authSDK.createUserWithEmailAndPassword(session.auth,email,password);},{role,name});
 const uid=await p.evaluate(()=>session.auth.currentUser.uid);
 if(verified){await local(auth+'/identitytoolkit.googleapis.com/v1/accounts:update?key=demo-key',{localId:uid,emailVerified:true},'POST',true);await p.evaluate(async()=>{await session.signOut();await session.signIn(email,password);});assert(await p.evaluate(()=>session.auth.currentUser.emailVerified));}
 return {p,uid,c};}
async function denied(label,p,fn,arg){const result=await p.evaluate(async({source,arg})=>{try{await (0,eval)('('+source+')')(arg);return 'ALLOWED'}catch(e){return e.code||e.message;}},{source:String(fn),arg});assert.equal(result,label==='account confirmation mismatch'?'Confirm the current verified identity':'permission-denied',label);console.log('PASS deny '+label+' ['+result+']');}
async function rawClaim(p,x){return p.evaluate(async x=>{const s=session.storeSDK,r=(...v)=>s.doc(session.db,...v);const b=s.writeBatch(session.db);b.update(r('qrInvites',x.handle),{status:'claimed',uid:x.uid});b.set(r('qrGames',x.game,'grants',x.seat),{uid:x.uid,handle:x.handle,code:x.code,expires:s.Timestamp.fromMillis(Date.now()+600000)});b.set(r('qrGames',x.game,'members',x.uid),{seat:x.seat,handle:x.handle});try{await b.commit();return 'ALLOWED';}catch(e){return e.code;}},x);}
async function rawDenied(label,p,x){assert.equal(await rawClaim(p,x),'permission-denied',label);console.log('PASS deny '+label);}
try{
 const board=await device('board','board'),otherBoard=await device('board','otherboard'),a=await device('phone','alex'),b=await device('phone','sam'),unverified=await device('phone','unverified',false),outsider=await device('phone','outsider');
 const boardTraffic=[],pendingBodies=[];
 board.p.on('request',r=>boardTraffic.push(r.url()+JSON.stringify(r.headers())+(r.postData()||'')));
 board.p.on('response',r=>{pendingBodies.push(r.text().then(body=>boardTraffic.push(body)).catch(()=>{}));});
 await denied('empty roles board creation',board.p,()=>api.createGame());
 // Deliberately put board UID in old pilot list too: explicit exclusion must win.
 await rules([board.uid,otherBoard.uid],[a.uid,b.uid,unverified.uid],[board.uid,a.uid,b.uid]);
 const game=await board.p.evaluate(()=>api.createGame());
 const pair=async(seat='1',g=game)=>board.p.evaluate(({g,seat})=>api.pair(g,seat),{g,seat});
 const claim=async(d,p=a)=>p.p.evaluate(x=>api.claim(x),{...d,confirmedUid:p.uid});
 const invite=await pair();assert.equal((await a.p.evaluate(h=>api.inspect(h),invite.handle)).seat,'1');
 await denied('phone lists invitations',a.p,()=>session.storeSDK.getDocs(session.storeSDK.collection(session.db,'qrInvites')));
 await denied('board forges player claim',board.p,async x=>{const s=session.storeSDK;await s.updateDoc(s.doc(session.db,'qrInvites',x.handle),{status:'claimed',uid:x.uid});},{...invite,uid:a.uid});
 await denied('player secret read',a.p,h=>session.storeSDK.getDocFromServer(session.storeSDK.doc(session.db,'qrSecrets',h)),invite.handle);
 await denied('unlisted player inspect',outsider.p,h=>api.inspect(h),invite.handle);
 await denied('unverified player raw claim',unverified.p,async x=>{const s=session.storeSDK;await s.updateDoc(s.doc(session.db,'qrInvites',x.handle),{status:'claimed',uid:session.auth.currentUser.uid});},invite);
 await denied('phone creates board game',a.p,()=>api.createGame());
 await denied('other board rotates game',otherBoard.p,x=>api.pair(x,'1'),game);
 await rawDenied('UID impersonation',a.p,{...invite,uid:b.uid});
 await rawDenied('wrong seat',a.p,{...invite,seat:'2',uid:a.uid});
 await rawDenied('wrong game',a.p,{...invite,game:await otherBoard.p.evaluate(()=>api.createGame()),uid:a.uid});
 await rawDenied('wrong code',a.p,{...invite,code:'bad',uid:a.uid});
 await denied('account confirmation mismatch',a.p,x=>api.claim({...x,confirmedUid:'someone-else'}),invite);
 await denied('incomplete claim batch',a.p,x=>session.storeSDK.updateDoc(session.storeSDK.doc(session.db,'qrInvites',x.handle),{status:'claimed',uid:session.auth.currentUser.uid}),invite);
 const wins=await Promise.allSettled(Array.from({length:8},(_,i)=>claim(invite,i%2?a:b)));assert.equal(wins.filter(x=>x.status==='fulfilled').length,1);console.log('PASS eight concurrent SDK transactions: exactly one winner');
 const winner=wins.find(x=>x.status==='fulfilled').value.uid===a.uid?a:b,loser=winner===a?b:a;
 await rawDenied('replay consumed handle',winner.p,{...invite,uid:winner.uid});
 assert((await winner.p.evaluate(({game})=>api.participation(game,'1'),{game})).active);
 await winner.p.evaluate(x=>api.checkIn(x),invite);console.log('PASS current grant permits narrowly scoped server check-in');
 await denied('wrong seat check-in',winner.p,x=>api.checkIn({...x,seat:'2'}),invite);
 await denied('other phone check-in',loser.p,x=>api.checkIn(x),invite);
 await denied('other phone reads player grant',loser.p,x=>api.participation(x,'1'),game);
 const second=await pair('2');await rawDenied('same UID occupies second seat',winner.p,{...second,uid:winner.uid});
 await denied('other phone revokes seat',loser.p,g=>api.revoke(g,'1'),game);
 await board.p.evaluate(g=>api.revoke(g,'1'),game);assert.equal((await winner.p.evaluate(g=>api.participation(g,'1'),game)).active,false);console.log('PASS board revoke deletes grant and member atomically');
 await denied('revoked grant check-in',winner.p,x=>api.checkIn(x),invite);
 await rawDenied('replay after revoke',winner.p,{...invite,uid:winner.uid});
 const old=await pair('1'),fresh=await pair('1');await rawDenied('rotated invitation',a.p,{...old,uid:a.uid});
 await claim(fresh,a);await a.p.evaluate(g=>api.revoke(g,'1'),game);console.log('PASS player leaves own seat');
 const expired=await pair('1');await local(store+`/v1/projects/${project}/databases/(default)/documents/qrInvites/${expired.handle}?updateMask.fieldPaths=expires`,{fields:{expires:{timestampValue:'2000-01-01T00:00:00Z'}}},'PATCH',true);await rawDenied('server-time expired invitation',a.p,{...expired,uid:a.uid});
 const last=await pair('1');await claim(last,a);await board.p.evaluate(g=>api.end(g),game);assert.equal((await a.p.evaluate(g=>api.participation(g,'1'),game)).active,false);await rawDenied('pending invitation after end',b.p,{...second,uid:b.uid});await denied('board reopens ended game',board.p,g=>session.storeSDK.updateDoc(session.storeSDK.doc(session.db,'qrGames',g),{active:true}),game);console.log('PASS end invalidates active grants and pending claims');
 await denied('ended game check-in',a.p,x=>api.checkIn(x),last);
 const game2=await board.p.evaluate(()=>api.createGame());const next=await pair('1',game2);await claim(next,a);assert((await a.p.evaluate(g=>api.participation(g,'1'),game2)).active);await rawDenied('prior-game handle used in new game',b.p,{...last,game:game2,uid:b.uid});console.log('PASS same stable UID across separate games with independent grants');
 await a.p.evaluate(x=>api.checkIn(x),next);
 await local(store+`/v1/projects/${project}/databases/(default)/documents/qrGames/${game2}/grants/1?updateMask.fieldPaths=expires`,{fields:{expires:{timestampValue:'2000-01-01T00:00:00Z'}}},'PATCH',true);
 await denied('server-time expired grant check-in',a.p,x=>api.checkIn(x),next);
 for(const collection of ['blakeoutDevProfiles','blakeoutDevTournaments','blakeoutDevRosterPrivate','blakeoutDevSignupState','blakeoutDevResults','blakeoutDevCasualResults','blakeoutDevCasualReceipts']){
  await local(store+`/v1/projects/${project}/databases/(default)/documents/${collection}/fixture`,{fields:{ownerId:{stringValue:board.uid},name:{stringValue:'Synthetic'}}},'PATCH',true);
  await denied('board read '+collection,board.p,c=>session.storeSDK.getDocFromServer(session.storeSDK.doc(session.db,c,'fixture')),collection);
  await denied('board write '+collection,board.p,c=>session.storeSDK.setDoc(session.storeSDK.doc(session.db,c,session.auth.currentUser.uid),{name:'Synthetic'}),collection);
 }
 await denied('board signup read',board.p,()=>session.storeSDK.getDocFromServer(session.storeSDK.doc(session.db,'blakeoutDevSignups','fixture','players',session.auth.currentUser.uid)));
 await denied('board signup write',board.p,()=>session.storeSDK.setDoc(session.storeSDK.doc(session.db,'blakeoutDevSignups','fixture','players',session.auth.currentUser.uid),{name:'Synthetic'}));
 // Positive account control ensures the merged rules did not merely deny everyone.
 await a.p.evaluate(async()=>{const s=session.storeSDK,r=s.doc(session.db,'blakeoutDevProfiles',session.auth.currentUser.uid);await s.setDoc(r,{name:'Alex'});await s.getDocFromServer(r);});console.log('PASS existing authorized phone profile behavior retained');
 const token=await a.p.evaluate(()=>session.auth.currentUser.getIdToken());const boardDump=await board.p.evaluate(async g=>{const s=session.storeSDK;return JSON.stringify({grant:(await s.getDocFromServer(s.doc(session.db,'qrGames',g,'grants','1'))).data(),local:{...localStorage},session:{...sessionStorage}});},game2);assert(!boardDump.includes(token));assert(!/refreshToken|accessToken|idToken/.test(boardDump));
 // WebChannel streaming responses may stay open; inspect completed bodies and
 // all observed requests, plus the actual deserialized grant above.
 assert(!boardTraffic.join('\n').includes(token));console.log('PASS board grant/storage and observed traffic have no phone Auth token');
 await rules([board.uid,otherBoard.uid],[b.uid],[board.uid,a.uid,b.uid]);await denied('player role revoked in same session',a.p,g=>api.participation(g,'1'),game2);
 assert.deepEqual(errors,[]);console.log('PASS real Auth/Firestore emulator SDK integration; zero page errors; external probes blocked: '+blocked.length);
 await fs.writeFile(out+'/browser.json',JSON.stringify({errors,blocked,contexts:6},null,2));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
