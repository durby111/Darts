import '../qr-seat/qr.js';
function el(tag,text,parent){const e=document.createElement(tag);if(text)e.textContent=text;if(parent)parent.append(e);return e;}
function control(label,type,parent,id){const wrap=el('label',label,parent),input=document.createElement('input');input.type=type;input.id=id;wrap.append(input);return input;}
function button(label,parent,action){const b=el('button',label,parent);b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){let s=document.querySelector('#desk-status');if(s)s.textContent=e.message;}finally{b.disabled=false;}};return b;}
export async function mountDesk(root,session){
  root.replaceChildren();const organizer=session.role==='organizer',api=session.api;
  el('p',session.label||'LOCAL EMULATOR · synthetic identities',root).className='eyebrow';el('h1',organizer?'Organizer results':'Tournament result desk',root);
  el('p',organizer?'Signed-in organizer entry. Changes are recorded under your organizer identity.':'Anyone may enter a completed match here. The audit records this shared device; the person tapping is unknown.',root);
  const status=el('p','',root);status.id='desk-status';status.setAttribute('role','status');
  const label=el('label','Tournament',root),select=el('select','',label);select.id='event-select';
  el('option','Choose a tournament',select).value='';for(const e of await api.list(organizer?'organizer':'board'))el('option',e.title,select).value=e.eventId;
  const panel=el('section','',root);select.onchange=()=>load(select.value);
  async function load(id){panel.replaceChildren();status.textContent='';if(!id)return;
    try{const {event,head,bracket}=await api.load(id);if(select.value!==id)return;el('h2',event.title,panel);el('p',`Tournament ${id} · Revision ${head.revision}`,panel);
      if(!event.active){el('p','Entry ended. Existing results and audit are retained.',panel);return;}
      const lab=el('label','Match',panel),matches=el('select','',lab);matches.id='match-select';
      el('option','Choose the match you played',matches).value='';
      for(const m of bracket.matches.filter(m=>['ready','complete'].includes(m.status)))el('option',`${m.code} · ${event.teams[m.teamA].name} vs ${event.teams[m.teamB].name}${m.status==='complete'?' · recorded':''}`,matches).value=m.id;
      const form=el('div','',panel),reviewPanel=el('div','',panel);
      matches.onchange=()=>{form.replaceChildren();reviewPanel.replaceChildren();const m=bracket.matches.find(x=>x.id===matches.value);if(!m)return;
        el('h3',`${m.code}: ${event.teams[m.teamA].name} vs ${event.teams[m.teamB].name}`,form);
        const names=[m.teamA,m.teamB].map(t=>event.teams[t].memberIds.map(r=>`${event.roster[r].label} [${r}]`).join(' + '));el('p',names.join(' versus '),form);
        const a=control(`${event.teams[m.teamA].name} legs won`,'number',form,'score-a'),b=control(`${event.teams[m.teamB].name} legs won`,'number',form,'score-b');a.min=b.min='0';a.value=m.scoreA??'';b.value=m.scoreB??'';
        const reason=control('Note / correction reason','text',form,'reason');reason.value=m.status==='complete'?'':'Match result reported';
        const review=async(input)=>{reviewPanel.replaceChildren();const r=await api.review(id,m.id,input,reason.value.trim());if(select.value!==id||matches.value!==m.id)return;
          el('h3',`Review ${r.input.operation==='undo'?'undo':'result'} · ${event.title} · ${m.code}`,reviewPanel);
          el('p',r.after?`${event.teams[m.teamA].name} ${r.after.scoreA} — ${r.after.scoreB} ${event.teams[m.teamB].name}`:'This removes the current result and recalculates waiting matches.',reviewPanel);
          for(const p of r.after?.players||[]){el('p',`${event.roster[p.registrationId].label} [${p.registrationId}] · ${p.uid?'linked UID '+p.uid:'unlinked; no account history attribution'}`,reviewPanel);}
          el('p','Affected matches: '+r.affected.join(', '),reviewPanel);
          el('p',organizer?'Audit actor: signed-in organizer.':'Audit actor: shared device; human unknown.',reviewPanel);
          const confirm=control('I confirm this tournament, match and result','checkbox',reviewPanel,'confirm-result');
          button('Confirm change',reviewPanel,async()=>{if(select.value!==id||matches.value!==m.id)throw Error('Selection changed; review again');if(!confirm.checked)throw Error('Confirm the selected tournament, match and result first');await api.submit(r);await load(id);status.textContent='Saved. Bracket updated and audit recorded.';});
        };
        button(m.status==='complete'?'Review correction':'Review result',form,()=>review({winnerId:Number(a.value)>Number(b.value)?m.teamA:m.teamB,scoreA:Number(a.value),scoreB:Number(b.value),forfeit:false}));
        if(m.status==='complete')button('Review undo',form,()=>review({operation:'undo'}));
      };
      button('Show audit',panel,async()=>{reviewPanel.replaceChildren();el('h3','Audit trail',reviewPanel);for(const x of await api.audit(id)){el('p',`Revision ${x.revision} · ${x.matchId} · ${x.operation} · ${x.source} · ${x.at.toDate().toISOString()} · ${x.reason}`,reviewPanel);el('pre',JSON.stringify({before:x.before,after:x.after},null,2),reviewPanel);}});
      const identities=el('details','',panel);el('summary','Optional player identity QR',identities);
      el('p','Results can be entered without linking accounts. Each player may separately confirm history attribution for this tournament.',identities);
      const roster=el('select','',identities);roster.id='roster-select';el('option','Choose a roster identity',roster).value='';
      for(const [r,p] of Object.entries(event.roster))if(p.expectedUid)el('option',`${p.label} · ${r}`,roster).value=r;
      const preview=el('div','',identities);roster.onchange=()=>{preview.replaceChildren();if(!roster.value)return;const url=session.identityLink?session.identityLink(id,roster.value):`${location.origin}/#event=${encodeURIComponent(id)}&registration=${encodeURIComponent(roster.value)}`;const qr=el('div','',preview);qr.id='roster-qr';qr.innerHTML=window.makeQR(url);const link=el('a',session.identityLink?'Open phone consent':'Open local phone consent',preview);link.id='roster-link';link.href=url;link.target='_blank';link.rel='noopener';if(!session.identityLink)el('p','Local emulator link. A separate physical phone cannot reach this loopback server.',preview);};
    }catch(e){status.textContent=e.message;}
  }
}
export async function mountConsent(root,session,eventId,registrationId){
  root.replaceChildren();const s=session.storeSDK,event=(await s.getDocFromServer(s.doc(session.db,'tdEvents',eventId))).data(),u=session.auth.currentUser;
  el('p','LOCAL EMULATOR · synthetic account',root).className='eyebrow';el('h1','Link your tournament identity',root);
  el('p',event.title+' · Tournament '+eventId,root);el('h2',event.roster[registrationId].label+' · '+registrationId,root);el('p','Signed-in UID: '+u.uid,root);
  if(event.roster[registrationId].expectedUid!==u.uid){el('p','This roster entry belongs to another account. Sign in as the intended player.',root);return;}
  el('p','Allow results entered by anyone at the shared tablet or by the organizer to be attributed to you for this named tournament. This does not mean you entered or approved each score. Revoking stops future attribution; recorded audit entries remain.',root);
  const confirm=control('This is my roster entry and I agree to tournament history attribution','checkbox',root,'confirm-identity');const status=el('p','',root);status.id='desk-status';status.setAttribute('role','status');
  button('Confirm tournament identity',root,async()=>{if(!confirm.checked)throw Error('Confirm your roster identity first');await session.api.consent(eventId,registrationId,u.uid);status.textContent='Identity linked for this tournament.';});
  button('Revoke future attribution',root,async()=>{await session.api.revokeConsent(eventId,registrationId);status.textContent='Future attribution revoked. Earlier audit entries retained.';});
}
export function mountConsentFromLocation(root,session){const q=new URLSearchParams(location.hash.slice(1));const event=q.get('event'),registration=q.get('registration');if(!event||!registration)throw Error('Invalid roster QR');return mountConsent(root,session,event,registration);}
