// A newly scanned pairing must start a fresh review, including same-tab hash navigation.
window.addEventListener('hashchange', () => location.reload());
const app = document.querySelector('#app'), status = document.querySelector('#status');
const phone = location.hash.startsWith('#pair=');
const handle = phone ? location.hash.slice(6) : '';
let board = JSON.parse(sessionStorage.getItem('qr-demo-board') || 'null');
let identity = JSON.parse(sessionStorage.getItem('qr-demo-phone') || 'null');
let context, grant = JSON.parse(sessionStorage.getItem('qr-demo-grant') || 'null');
let pairing = null, lastState = '';
async function api(action, data={}, token='') {
  const response = await fetch(`/api/${action}`, {method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || 'Connection failed.');
  return result;
}
function button(label, action, secondary=false) {
  const b = document.createElement('button'); b.textContent=label;
  if(secondary)b.className='secondary';
  b.onclick=async()=>{ b.disabled=true; status.textContent='';try{await action();}catch(e){status.textContent=e.message;}finally{b.disabled=false;} };return b;
}
function text(tag,value,parent=app){const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;}
async function renderBoard() {
  if(!board){app.innerHTML='<h1>Your board. Your players.</h1><p>Everyone can play as a guest. Pair a phone only when you want to attach a verified identity to a seat.</p>';app.append(button('Start local demo',async()=>{board=await api('display');sessionStorage.setItem('qr-demo-board',JSON.stringify(board));await renderBoard();}));return;}
  const state=await api('state',{game:board.game},board.token);
  const key=JSON.stringify([state,pairing]); if(key===lastState)return; lastState=key;
  app.replaceChildren();text('h1',state.title);text('p',`${state.display} · Game ${state.game.slice(0,8)}`);
  if(state.ended){text('h2','Game ended · all seat access removed');app.append(button('New local game',async()=>{board=null;pairing=null;lastState='';sessionStorage.removeItem('qr-demo-board');await renderBoard();}));return;}
  text('p','Guest play is ready. Pairing is optional; this demo does not save scores or history.');
  const seats=document.createElement('div');seats.className='seats';app.append(seats);
  Object.entries(state.seats).forEach(([seat,player])=>{
    const card=document.createElement('section');card.className='card';seats.append(card);
    text('h2',`Seat ${seat}`,card);text('p',player?`${player.name} · verified demo player`:'Guest · no account needed',card);
    if(player){text('p','Linked for this game only',card);card.append(button('Remove player',async()=>{await api('remove',{game:board.game,seat},board.token);await renderBoard();},true));}
    else card.append(button('Pair phone',async()=>{pairing=await api('pair',{game:board.game,seat},board.token);await renderBoard();}));
    if(pairing?.seat===seat&&!player){
      text('h3','Scan, choose account, confirm',card);
      const url=`${location.origin}/#pair=${pairing.handle}`;
      const qr=document.createElement('div');qr.className='qr';qr.innerHTML=window.makeQR(url);card.append(qr);
      const code=text('p',pairing.code,card);code.className='code';
      const expiry=text('p','',card);expiry.dataset.expires=pairing.expires;
      const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.textContent='Open simulated phone';card.append(link);
      text('p','Loopback QR: use the simulated phone on this computer. A physical phone cannot reach this local server.',card).className='muted';
    }
  });
  app.append(button('End game & remove access',async()=>{await api('end',{game:board.game},board.token);pairing=null;await renderBoard();},true));
}
async function renderPhone(){
  app.className='phone';app.replaceChildren();
  if(grant && grant.handle===handle && identity){
    const result=await api('participation',grant,identity.token);
    text('h1',result.active?'You’re in.':'Seat access removed');
    text('p',`${identity.account.name} · Seat ${grant.seat}`);
    text('p',result.active?'Your phone keeps your identity. The board only has participation access for this game.':'You can still play as a guest. Ask the board for a new QR to link again.');
    if(result.active)app.append(button('Leave this game',async()=>{await api('leave',grant,identity.token);await renderPhone();},true));
    return;
  }
  context=await api('inspect',{handle});
  text('h1',`Join seat ${context.seat}`);text('p',`${context.display} · ${context.title} · Game ${context.game.slice(0,8)}`);
  text('p','Choose who is playing. Only your identity is used for game history—no inbox or payment access.');
  text('p','DEMO: these choices simulate sign-in. No real Google or email credentials are requested.').className='muted';
  const label=text('label','Demo identity');label.htmlFor='account';
  const select=document.createElement('select');select.id='account';
  for(const [value,name] of [['','Choose an account…'],['alex','Alex · verified'],['sam','Sam · verified'],['unverified','Unverified · test rejection']]){const o=document.createElement('option');o.value=value;o.textContent=name;select.append(o);}app.append(select);
  for(const provider of ['Google','Email'])app.append(button(`Continue with ${provider} (demo)`,async()=>{
    if(!select.value)throw Error('Choose an account explicitly.');
    if(identity)await api('logout',{},identity.token);
    identity=await api('login',{account:select.value,provider});sessionStorage.setItem('qr-demo-phone',JSON.stringify(identity));await confirmPhone();
  }));
  app.append(button('Play as guest',()=>{app.replaceChildren();text('h1','You’re ready to play as a guest.');text('p','No sign-in or account history. Tell the board which seat you’re playing.');},true));
}
async function confirmPhone(){
  context=await api('inspect',{handle});app.replaceChildren();
  text('h1',`Join as ${identity.account.name}?`);
  text('p',`${identity.account.provider} demo · ${identity.account.uid}`);
  text('h2',`${context.display} · Seat ${context.seat}`);
  text('p',`${context.title} · Game ${context.game.slice(0,8)}`);
  const label=text('label','Enter the 6-digit code shown beside this seat’s QR');label.htmlFor='code';
  const code=document.createElement('input');code.id='code';code.inputMode='numeric';code.maxLength=6;code.autocomplete='off';app.append(code);
  text('p','Confirm only if this account, board and seat are yours.');
  app.append(button(`Confirm ${identity.account.name} for seat ${context.seat}`,async()=>{
    grant=await api('claim',{handle,...context,uid:identity.account.uid,code:code.value.trim()},identity.token);
    grant.handle=handle;sessionStorage.setItem('qr-demo-grant',JSON.stringify(grant));await renderPhone();
  }));
  app.append(button('Use a different account',async()=>{await api('logout',{},identity.token);identity=null;sessionStorage.removeItem('qr-demo-phone');await renderPhone();},true));
}
async function refresh(){try{
  if(!phone)await renderBoard();
  else if(grant?.handle===handle&&identity)await renderPhone();
  document.querySelectorAll('[data-expires]').forEach(e=>{const left=Math.max(0,Math.ceil(+e.dataset.expires-Date.now()/1000));e.textContent=left?`Expires in ${left}s`:'Expired · select Pair phone for a new code';});
}catch(e){status.textContent=e.message;}}
try{if(phone)await renderPhone();else await renderBoard();}catch(e){status.textContent=e.message;}
setInterval(refresh,1500);
