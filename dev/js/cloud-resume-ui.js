import { cloudResumeAvailable } from './cloud-resume-codec.js';
import { game, snapshotActiveGame, restoreActiveGame, saveActiveGame, setActiveGameOwner } from './state.js';
import { BUILD_STORAGE, LOCAL_TOURNAMENT } from './build-context.js';
// Disabled outside local synthetic tests. No provider is initialized for guests
// on the deployed build. Cloud continuation does not change result authorization.
export async function initCloudResume() {
    if (!cloudResumeAvailable() || LOCAL_TOURNAMENT) return;
    const api = await import('./platform.js');
    const panel=document.createElement('section'); panel.id='cloudResumePanel';
    const label=document.createElement('p'); label.id='cloudResumeStatus'; label.setAttribute('role','status');
    const refresh=document.createElement('button'); refresh.id='cloudResumeRefresh';refresh.textContent='Find my cloud games';
    const list=document.createElement('div'); list.id='cloudResumeList';panel.append(label,refresh,list);
    panel.className='setup-section setup-panel';
    document.getElementById('playSection').before(panel);
    const status=document.createElement('p');status.id='cloudGameStatus';status.setAttribute('role','status');
    document.getElementById('gameScreen').prepend(status);
    let revision=-1, queued=null, busy=false, conflict=false, owner=null, last='', retry=null;
    const say=text=>{label.textContent=text;status.textContent=text;};
    async function drain() {
        if (busy || (!queued && !retry) || conflict || api.getAccount()?.uid!==owner) return;
        busy=true;
        const job=retry || {snapshot:queued, operationId:crypto.randomUUID(), expected:revision};
        if(!retry) queued=null;
        const current=()=>owner===job.snapshot.cloudResume.ownerId && game.cloudResume?.id===job.snapshot.cloudResume.id;
        try {
            const savedRevision=await api.saveCloudGame(job.snapshot.cloudResume.id,job.expected,job.operationId,job.snapshot);
            if(!current()) return;
            revision=savedRevision;retry=null;say(queued ? 'Saving latest active game…' : 'Cloud saved. Safe to resume this game on another device.');
        } catch(e) {
            if(!current()) return;
            retry=job;
            if(e.code==='platform/active-game-conflict') conflict=true;
            say(conflict ? e.message : 'Not synced. Keep this device open; reconnect and retry before signing out.');
        } finally {busy=false;if(queued && !retry) queueMicrotask(()=>void drain());}
    }
    function capture() {
        if(!game.cloudResume || game.cloudResume.ownerId!==owner || api.getAccount()?.uid!==owner) return;
        const snapshot=snapshotActiveGame(true); snapshot.timestamp=0;
        const key=JSON.stringify(snapshot);
        if(key===last) return;
        last=key;queued=snapshot;say('Saving active game…');void drain();
    }
    document.addEventListener('activeGameSaved',capture);
    document.addEventListener('activeGameStarted',()=>{
        const user=api.getAccount();
        if(!user || !user.emailVerified || user.isAnonymous) {say('Guest game stays on this device.');return;}
        owner=user.uid;revision=-1;conflict=false;retry=null;last='';
        game.cloudResume={ownerId:owner,id:crypto.randomUUID()};saveActiveGame();
    });
    window.addEventListener('online',()=>void drain());
    const retryButton=document.createElement('button');retryButton.id='cloudGameRetry';retryButton.textContent='Retry cloud save';retryButton.onclick=()=>void drain();status.after(retryButton);
    refresh.onclick=async()=>{
        try {
            list.replaceChildren();
            for(const row of await api.listCloudGames()) {
                const button=document.createElement('button');button.dataset.cloudGame=row.id;
                button.textContent=`Resume ${row.type}: ${row.players.join(' vs ')}`;
                button.onclick=async()=>{
                    try {
                        if(busy) throw new Error('Wait for the current cloud save.');
                        const record=await api.loadCloudGame(row.id);if(!record)throw new Error('Game no longer available.');
                        if(game.players.length && !game.cloudResume) localStorage.setItem('blakeout_dev_guest_resume_backup',JSON.stringify(snapshotActiveGame(true)));
                        owner=api.getAccount().uid;revision=record.revision;retry=null;queued=null;conflict=false;
                        restoreActiveGame(record.snapshot);last=JSON.stringify({...record.snapshot,timestamp:0});saveActiveGame();
                        const {resumeGame}=await import('./setup.js');resumeGame();say('Cloud game resumed.');
                    } catch(e) {say(e.message);}
                };list.append(button);
            }
            say(list.children.length ? 'Choose the game to resume.' : 'No cloud games for this account.');
        } catch(e) {say(e.message);}
    };
    await api.initPlatform();
    api.subscribeAccount(user=>{
        const uid=user?.emailVerified && !user.isAnonymous ? user.uid : null;setActiveGameOwner(uid);
        if(owner && uid!==owner) {
            queued=null;retry=null;conflict=true;list.replaceChildren();
            if(game.cloudResume) {
                localStorage.setItem('blakeout_dev_cloud_local_'+game.cloudResume.ownerId, JSON.stringify(snapshotActiveGame(true)));
                localStorage.removeItem(BUILD_STORAGE.activeGame);
                game.players=[];game.cloudResume=null;
                document.getElementById('gameScreen').style.display='none';document.getElementById('setupScreen').style.display='block';
                document.getElementById('resumeGameBtn').classList.add('hidden');
            }
            say('Signed out. Sign in and choose a cloud game to resume.');
        }
        owner=uid;
    });
    say('Cloud resume candidate: signed-in new games sync; guests stay local.');
}
