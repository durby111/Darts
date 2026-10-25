import * as engine from '../js/brackets/engine.js';
import {renderDiagram} from '../js/brackets/diagram.js';
import {diagramViewport} from '../js/brackets/viewport.js';
const host=document.querySelector('#host'),out=document.querySelector('#out'),button=document.querySelector('#run');
const wait=ms=>new Promise(r=>setTimeout(r,ms));let callbacks=0,states=[];
const NativeObserver=window.ResizeObserver;
window.ResizeObserver=class extends NativeObserver{constructor(fn){super((...args)=>{callbacks++;fn(...args);states.push([host.clientWidth,host.clientHeight,host.dataset.zoom].join('|'));});}};
let t=engine.createTournament({id:'synthetic-fit-regression',ownerId:'local',title:'Synthetic fit regression',date:'2026-10-25',gameType:'501',bestOf:3});
t=engine.saveRoster(t,Array.from({length:8},(_,i)=>({id:'p'+i,name:'Synthetic '+i,tag:String(Math.floor(i/2)+1),paid:true,checkedIn:true,standby:false})));t=engine.startTournament(t);renderDiagram(host,t,{preview:true});
const view=diagramViewport(host),assert=(condition,message)=>{if(!condition)throw Error(message);};
button.onclick=async()=>{
 button.disabled=true;const results=[];
 try{
  states=[];const before=callbacks;view.zoomTo('fit');await wait(2500);
  const fit={resizeCallbacks:callbacks-before,states:[...new Set(states)],scale:Number(host.dataset.zoom)};
  assert(fit.resizeCallbacks<=3,'Fit resize feedback loop');assert(host.dataset.fitMode==='true','Fit mode missing');assert(getComputedStyle(host).overflow==='hidden','Fit scrollbar guard missing');
  const canvas=host.querySelector('.diagram-canvas').getBoundingClientRect(),box=host.getBoundingClientRect();assert(canvas.width<=box.width&&canvas.height<=box.height,'Fit clips bracket');results.push({fit});
  view.zoomTo(.58);await wait(300);await new Promise(requestAnimationFrame);assert(Number(host.dataset.zoom)===.5,'Manual target did not snap');assert(host.dataset.fitMode==='false'&&getComputedStyle(host).overflow==='auto','Manual pan/scroll lost');results.push({manual:host.dataset.zoom});
  view.zoomTo(1.5);await wait(70);const intermediate=Number(host.dataset.zoom);view.zoomTo(.75);await wait(350);await new Promise(requestAnimationFrame);assert(Number(host.dataset.zoom)===.75,'Rapid reversal left a stale animation');results.push({reversal:{intermediate,settled:host.dataset.zoom,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches}});
  assert(host.querySelectorAll('.diagram-canvas').length===1&&host.querySelectorAll('svg').length===1,'Duplicate render layer');out.textContent='PASS '+JSON.stringify({dpr:devicePixelRatio,results},null,2);
 }catch(error){out.textContent='FAIL '+error.message+' '+JSON.stringify(results);}finally{button.disabled=false;}
};
