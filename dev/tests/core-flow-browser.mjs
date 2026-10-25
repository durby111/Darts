import {prepareCasualRecording} from '../js/casual-recording.js';
import {confirmAction} from '../js/confirm-action.js';
import {diagramViewport} from '../js/brackets/viewport.js';
import {scenario} from './core-flow-mocks.mjs';
const $=id=>document.getElementById(id),drain=()=>new Promise(resolve=>setTimeout(resolve,30));
const assert=(condition,label)=>{if(!condition)throw Error(label);};
const select=(id,value)=>{$(id).value=value;$(id).dispatchEvent(new Event('change',{bubbles:true}));};
const launch=()=>prepareCasualRecording([{name:'Synthetic A'},{name:'Synthetic B'}],null);
$('run').onclick=async()=>{
 $('run').disabled=true;const passed=[];
 try{
  scenario.verified=false;let p=launch();await drain();assert($('casualLinkStart').disabled,'unverified disabled');$('casualLinkCancel').click();assert(await p===null,'cancel');passed.push('Unverified start disabled; Cancel preserves existing game');
  scenario.verified=true;p=launch();await drain();assert($('casualLinkStart').disabled,'guests disabled');$('casualLinkSkip').click();assert((await p).recording===null,'ordinary play');passed.push('All Guests disabled; Play without recording returns ordinary game');
  p=launch();await drain();select('casualLink0','synthetic-owner');assert(!$('casualLinkStart').disabled,'valid enabled');let release;scenario.hold=new Promise(r=>release=r);const calls=scenario.calls;$('casualLinkStart').click();$('casualLinkStart').click();await drain();assert(scenario.calls===calls+1,'one lookup');release();const recorded=await p;scenario.hold=null;assert(recorded.recording.ownerId==='synthetic-owner','verified started');passed.push('Verified player starts; repeated click performs one verification');
  select('gameType','minnesota');p=launch();await drain();select('casualLink0','synthetic-other');$('casualLinkStart').click();await drain();assert($('casualLinkStatus').textContent.includes('Confirm local recording'),'opt in required');$('casualLocalOnlyAck').checked=true;$('casualLinkStart').click();assert((await p).recording.teams[0].members[0].playerId==='synthetic-other','link preserved');passed.push('Local-only opt-in required; linked player retained');select('gameType','501');
  p=launch();await drain();select('casualLink0','synthetic-owner');scenario.offline=true;$('casualLocalOnlyAck').checked=true;$('casualLinkStart').click();await drain();assert($('casualLinkStatus').textContent.includes('Offline'),'offline reported');$('casualLinkCancel').click();assert(await p===null,'offline cancel');scenario.offline=false;passed.push('Offline verification fails visibly, even with local opt-in; Cancel works');
  p=launch();await drain();select('casualLink0','synthetic-owner');scenario.hold=new Promise(r=>release=r);$('casualLinkStart').click();await drain();$('casualLinkCancel').click();assert(await p===null,'cancel during request');release();await drain();scenario.hold=null;passed.push('Cancel while verification is pending cannot later start a game');
  $('results').textContent='PASS '+passed.length+' browser scenarios\n'+passed.join('\n');
 }catch(error){$('results').textContent='FAIL '+error.message+'\n'+passed.join('\n');}finally{$('run').disabled=false;}
};
$('confirm').onclick=async()=>{$('results').textContent=await confirmAction('Save this synthetic result? No account or cloud data will be sent.',{title:'Save match result?',confirmLabel:'Save result'})?'Confirmed':'Cancelled';};
const host=$('viewport'),canvas=document.createElement('div'),spacer=document.createElement('div');canvas.className='diagram-canvas';spacer.className='diagram-spacer';canvas.style.width='1076px';canvas.style.height='346px';canvas.textContent='Synthetic final layout: 1076 × 346';spacer.append(canvas);host.append(spacer);const view=diagramViewport(host);view.setContent(canvas,spacer,{width:1076,height:346},'synthetic');
$('measure').onclick=async()=>{const samples=[];for(let i=0;i<120;i++){await new Promise(requestAnimationFrame);samples.push([host.clientWidth,host.clientHeight,spacer.style.width,spacer.style.height,canvas.style.left,canvas.style.top].join(','));}const unique=[...new Set(samples)];$('results').textContent=JSON.stringify({frames:samples.length,unique:unique.length,transitions:samples.slice(1).filter((s,i)=>s!==samples[i]).length,geometry:unique},null,2);};
$('fractional').onclick=()=>{host.style.width='1423.6px';host.style.height='513.6px';$('measure').click();};
