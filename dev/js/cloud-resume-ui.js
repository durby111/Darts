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
    const list=document.createElement('div'); list.id='cloudResumeList';
    const more=document.createElement('button');more.id='cloudResumeMore';more.textContent='More games';more.hidden=true;
    panel.append(label,refresh,list,more);
    let nextCursor=null;
    panel.className='setup-section setup-panel';
    document.getElementById('playSection').before(panel);
    const status=document.createElement('p');status.id='cloudGameStatus';status.setAttribute('role','status');
    document.getElementById('gameScreen').prepend(status);
    let revision=-1, queued=null, busy=false, conflict=false, owner=null, last='', retry=null;
    const say=text=>{label.textContent=text;status.textContent=text;};
    function backupLocal() {
        if(game.cloudResume?.ownerId!==owner) return;
        try {localStorage.setItem('blakeout_dev_cloud_local_'+owner,JSON.stringify({snapshot:snapshotActiveGame(true),revision}));} catch {say('Device recovery storage is unavailable. Wait for cloud confirmation before leaving.');}
    }
    async function drain() {
        if (busy || (!queued && !retry) || conflict || api.getAccount()?.uid!==owner) return;
        busy=true;
        const job=retry || {snapshot:queued, operationId:crypto.randomUUID(), expected:revision};
        if(!retry) queued=null;
        const current=()=>owner===job.snapshot.cloudResume.ownerId && game.cloudResume?.id===job.snapshot.cloudResume.id;
        try {
            const savedRevision=await api.saveCloudGame(job.snapshot.cloudResume.id,job.expected,job.operationId,job.snapshot);
            if(!current()) return;
            revision=savedRevision;retry=null;backupLocal();say(queued ? 'Saving latest active game…' : 'Cloud saved. Safe to resume this game on another device.');
        } catch(e) {
            if(!current()) return;
            retry=job;
            if(e.code==='platform/active-game-conflict') conflict=true;
            say(conflict ? e.message : 'Not synced. Keep this device open; reconnect and retry before signing out.');
        } finally {busy=false;if(queued && !retry) queueMicrotask(()=>void drain());}
    }
    function capture() {
        if(!game.cloudResume || game.cloudResume.status==='archived' || game.cloudResume.ownerId!==owner || api.getAccount()?.uid!==owner) return;
        backupLocal();
        if(conflict) {say('Another device changed this game. Local recovery is retained; refresh and resume the cloud version.');return;}
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
    async function resumeRecord(record) {
        if(busy) throw new Error('Wait for the current cloud save.');
        if(!record || record.status!=='active') throw new Error('Restore an archived game before resuming.');
        if(game.players.length && !game.cloudResume) localStorage.setItem('blakeout_dev_guest_resume_backup',JSON.stringify(snapshotActiveGame(true)));
        owner=api.getAccount().uid;revision=record.revision;retry=null;queued=null;conflict=false;
        restoreActiveGame(record.snapshot);last=JSON.stringify({...record.snapshot,timestamp:0});saveActiveGame();
        const {resumeGame}=await import('./setup.js');resumeGame();say('Cloud game resumed.');
    }
    async function renderPage(reset) {
        try {
            if(reset) {list.replaceChildren();nextCursor=null;}
            const page=await api.listCloudGamesPage({afterId:nextCursor});nextCursor=page.nextCursor;more.hidden=!nextCursor;
            for(const row of page.items) {
                const container=document.createElement('div');
                const button=document.createElement('button');button.dataset.cloudGame=row.id;
                button.textContent=`${row.status==='archived' ? 'Restore archived' : 'Resume'} ${row.type}: ${row.players.join(' vs ')}`;
                button.onclick=async()=>{
                    try {
                        if(busy || (!conflict && (queued || retry))) throw new Error('Save or recover the current pending edits first.');
                        let record=await api.loadCloudGame(row.id);
                        if(record?.status==='archived') {
                            await api.changeCloudGame(row.id,record.revision,crypto.randomUUID(),'restore');
                            record=await api.loadCloudGame(row.id);
                        }
                        await resumeRecord(record);
                    } catch(e) {say(e.message);}
                };container.append(button);
                if(row.status==='archived') {
                    const discard=document.createElement('button');discard.dataset.discardGame=row.id;
                    discard.textContent='Discard archived cloud snapshot after 30 days';
                    discard.onclick=async()=>{
                        if(!confirm('Permanently discard this cloud resume snapshot? Local recovery copies and completed result history remain.')) return;
                        try {await api.changeCloudGame(row.id,row.revision,crypto.randomUUID(),'discard');await renderPage(true);say('Archived snapshot discarded; its ID cannot be reused.');}
                        catch(e){say('Not discarded. Archives must be at least 30 days old and unchanged. '+e.message);}
                    };container.append(discard);
                }
                list.append(container);
            }
            say(list.children.length ? 'Choose a game; archives remain recoverable until explicitly discarded after 30 days.' : nextCursor ? 'No recoverable games on this page. Choose More games.' : 'No cloud games for this account.');
        } catch(e) {say(e.message);}
    }
    refresh.onclick=()=>renderPage(true);more.onclick=()=>renderPage(false);
    const archive=document.createElement('button');archive.id='cloudGameArchive';archive.textContent='Finish & archive cloud game';status.after(archive);
    archive.onclick=async()=>{
        try {
            if(busy || queued || retry) throw new Error('Wait until the latest input is cloud saved before archiving.');
            if(!game.cloudResume || game.cloudResume.ownerId!==owner) throw new Error('No owned cloud game is open.');
            revision=await api.changeCloudGame(game.cloudResume.id,revision,crypto.randomUUID(),'archive');
            game.cloudResume.status='archived';conflict=true;saveActiveGame();backupLocal();
            document.getElementById('gameScreen').style.display='none';document.getElementById('setupScreen').style.display='flex';
            document.getElementById('resumeGameBtn').classList.add('hidden');
            await renderPage(true);say('Archived. It can be restored from the cloud game list. Result history was not changed.');
        } catch(e) {say(e.message);}
    };
    const recover=document.createElement('button');recover.id='cloudRecoverLocal';recover.textContent='Recover this account’s unsynced device copy';panel.append(recover);
    recover.onclick=async()=>{
        try {
            const user=api.requireVerifiedAccount();const local=JSON.parse(localStorage.getItem('blakeout_dev_cloud_local_'+user.uid));
            if(!local?.snapshot || local.snapshot.cloudResume?.ownerId!==user.uid) throw new Error('No owned device recovery is available.');
            const remote=await api.loadCloudGame(local.snapshot.cloudResume.id);
            if(!remote || remote.status!=='active' || remote.revision!==local.revision) throw new Error('Cloud state changed or is archived. Device copy is preserved; do not overwrite the newer cloud game.');
            await resumeRecord({...remote,snapshot:local.snapshot});last='';capture();
        } catch(e) {say(e.message);}
    };
    const guest=document.createElement('button');guest.id='cloudRecoverGuest';guest.textContent='Restore this device’s saved guest game';panel.append(guest);
    guest.onclick=async()=>{
        try {
            if(busy || queued || retry) throw new Error('Save pending account edits first.');
            const saved=JSON.parse(localStorage.getItem('blakeout_dev_guest_resume_backup'));
            if(!saved || saved.cloudResume) throw new Error('No guest backup is available.');
            restoreActiveGame(saved);saveActiveGame();const {resumeGame}=await import('./setup.js');resumeGame();say('Guest game restored on this device only.');
        } catch(e) {say(e.message);}
    };
    await api.initPlatform();
    api.subscribeAccount(user=>{
        const uid=user?.emailVerified && !user.isAnonymous ? user.uid : null;setActiveGameOwner(uid);
        if(owner && uid!==owner) {
            queued=null;retry=null;conflict=true;list.replaceChildren();
            if(game.cloudResume) {
                backupLocal();
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
