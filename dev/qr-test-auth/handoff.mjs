import {DESTINATION,APP_ORIGIN,accept,packet} from './protocol.mjs';
const $=id=>document.getElementById(id),parent=window.opener;
const api='https://identitytoolkit.googleapis.com/v1/accounts:',key='AIzaSyAPip90ScJRofSNWSiO-pXvqBYy4-bLFe0';
let challenge,expires=0,phase='waiting';
const send=(type,extra)=>parent.postMessage(packet(type,challenge,extra),DESTINATION);
const status=text=>{$('status').textContent=text;};
function clear(){ $('password').value='';$('signin').disabled=true;$('board').disabled=true;phase='closed'; }
async function firebase(action,body){
 const r=await fetch(api+action+'?key='+key,{method:'POST',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'strict-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,returnSecureToken:true}),signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok||typeof data.idToken!=='string'||!data.localId)throw Error();
 // Never retain or transfer the returned refresh token.
 const result={token:data.idToken,uid:data.localId};data.idToken='';data.refreshToken='';return result;
}
addEventListener('message',event=>{
 if(location.origin!==APP_ORIGIN||!accept(event,parent,DESTINATION,challenge))return;
 const data=event.data;
 if(data.type==='init'&&phase==='waiting'&&/^[a-f0-9]{64}$/.test(data.challenge)){
  challenge=data.challenge;expires=Date.now()+240000;phase='signin';$('signin').disabled=false;status('Sign in with your existing Firebase DEV account.');
 }else if(data.type==='permit'&&phase==='operator-sent'&&Date.now()<expires){phase='board';$('board').disabled=false;status('Fresh identity checked. Create the single temporary board only when ready to finish the test.');}
 else if(data.type==='result'){clear();status(data.ok?'Test finished and cleanup verified. You may close this window.':'Test stopped. Keep the private test window open for the operator to verify cleanup.');}
});
$('signin').onclick=async()=>{
 if(phase!=='signin'||Date.now()>=expires)return;phase='signing';$('signin').disabled=true;
 let credentials;
 try{credentials=await firebase('signInWithPassword',{email:$('email').value.trim(),password:$('password').value});$('password').value='';phase='operator-sent';send('operator',{token:credentials.token});status('Checking fresh identity in the private harness.');}
 catch{phase='signin';$('signin').disabled=false;status('Sign-in failed. No board was created. Check your existing DEV credentials.');}
 finally{$('password').value='';if(credentials)credentials.token='';}
};
$('board').onclick=async()=>{
 if(phase!=='board'||Date.now()>=expires)return;phase='creating';$('board').disabled=true;
 let credentials;
 try{credentials=await firebase('signUp',{});phase='sent';send('board',{token:credentials.token});status('Board sent to private harness. Wait for test and cleanup. Do not close either window.');}
 catch{phase='uncertain';status('Board creation outcome requires operator review. Do not retry.');send('uncertain');}
 finally{if(credentials)credentials.token='';}
};
addEventListener('pagehide',clear);
setInterval(()=>{if(expires&&Date.now()>=expires&&!['creating','sent','closed','uncertain'].includes(phase)){clear();status('Sign-in window expired. No further board creation is allowed.');}},1000);
if(location.origin===APP_ORIGIN&&parent)send('ready');else status('Open this page from the approved private test harness.');
