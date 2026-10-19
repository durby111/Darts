import {openDevHistorySession} from './session.mjs';
import {mountHistoryView} from './views.mjs';
const root=document.querySelector('main');
try {
 const q=new URLSearchParams(location.hash.slice(1));
 const view=q.get('view')||'history',role=view==='desk'?(q.get('role')||'board'):'phone';
 const session=await openDevHistorySession(role),initial=session.auth.currentUser;
 session.subscribe(user=>{if(user!==initial)root.textContent='Account changed. Reload to continue.';});
 await mountHistoryView(root,session,{view,hash:location.hash});
}catch(error){root.textContent=error.message;}
