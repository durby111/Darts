import {mountHomeAccount} from '../js/home-account.js';
import {requestSharedPlayer} from '../js/shared-player-dialog.js';
let notify;
await mountHomeAccount(document,async()=>({initPlatform:async()=>{},subscribeAccount:fn=>{notify=fn;fn(null);return()=>{};}}),
 (doc, options)=>requestSharedPlayer(doc,{...options,create:async()=>({signIn:async()=>({id:'synthetic-player',name:'Synthetic Player',email:'synthetic@example.invalid',expiresAt:Date.now()+300000}),close:async()=>{}})}));
document.querySelector('#guest').onclick=()=>notify(null);
document.querySelector('#unverified').onclick=()=>notify({uid:'synthetic',emailVerified:false});
document.querySelector('#verified').onclick=()=>notify({uid:'synthetic',emailVerified:true});
