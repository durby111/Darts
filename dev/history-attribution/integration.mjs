// Explicit bridges from existing local candidate shapes; no SDK/private-data API.
import {binding} from './model.mjs';
import {propose,registrations} from '../tournament-device/model.mjs';
export function tournamentOperation(event,audit,head) {
    if(audit.eventId!==event.eventId||head.revision!==audit.revision-1)throw Error('Wrong tournament or revision');
    const review=propose(event,head,audit.matchId,audit.operation==='undo'?{operation:'undo'}:audit.after);
    if(review.operation!==audit.operation)throw Error('Wrong operation');
    for(const key of ['teamA','teamB','winnerId','scoreA','scoreB','forfeit'])if(review.after?.[key]!==audit.after?.[key])throw Error('Result differs from engine');
    const result=audit.after||audit.before;
    const expected=registrations(event,result);
    if(result.players.length!==expected.length||result.players.some((p,i)=>p.registrationId!==expected[i]||(p.uid!==null&&p.uid!==event.roster[p.registrationId].expectedUid)))throw Error('Attribution differs from roster');
    const organizer=audit.actorUid===event.ownerUid;
    if(!organizer&&audit.actorUid!==event.boardUid)throw Error('Unknown event actor');
    if(audit.source!==(organizer?'organizer':'shared-device-unknown-human')||audit.humanUid!==(organizer?event.ownerUid:null))throw Error('Misidentified submitter');
    const blocked=[];
    return {eventId:event.eventId,matchId:audit.matchId,operationId:audit.operationId,expectedRevision:audit.revision-1,kind:audit.operation,binding:{scope:'named-tournament',rosterRevision:event.rosterRevision},players:(audit.after||audit.before).players.map(p=>({registrationId:p.registrationId,uid:p.uid})),result:audit.after?{type:'tournament',teamA:audit.after.teamA,teamB:audit.after.teamB,winnerId:audit.after.winnerId,scoreA:audit.after.scoreA,scoreB:audit.after.scoreB,forfeit:audit.after.forfeit}:null,affected:review.affected,blocked,actor:{actorUid:audit.actorUid,humanUid:audit.humanUid,source:audit.source}};
}
export function gameSeatBinding({eventId,registrationId,rosterRevision,claim}) {
    // Pairing claim proves identity only. It never becomes history consent here.
    return binding({scope:'game-seat',eventId,registrationId,rosterRevision,uid:claim.uid,gameId:claim.game,seatId:claim.seat,invitationId:claim.handle});
}
export function phoneConsentView(root, displayed, onConfirm) {
    const title=root.ownerDocument.createElement('p');
    title.textContent=displayed.scope==='game-seat'?`Game ${displayed.gameId}, seat ${displayed.seatId}, roster ${displayed.registrationId}: attribute this game's personal history to ${displayed.uid}. This does not cover other games or the whole tournament.`:`Tournament ${displayed.eventId}, roster ${displayed.registrationId}: attribute results in this named tournament to ${displayed.uid}. This does not authorize unrelated games.`;
    const note=root.ownerDocument.createElement('p');note.textContent='Anyone at the tablet can enter scores. Your confirmation identifies whose history this is, not who submitted or approved the score. Revocation stops new attribution; accepted results retain their ownership and receive corrections or undo.';
    const label=root.ownerDocument.createElement('label'),ack=root.ownerDocument.createElement('input');ack.type='checkbox';label.append(ack,' I confirm this identity and the scope shown above.');
    const button=root.ownerDocument.createElement('button');button.type='button';button.textContent='Confirm history attribution';button.disabled=true;ack.onchange=()=>{button.disabled=!ack.checked;};
    const status=root.ownerDocument.createElement('p');status.setAttribute('role','status');
    let pending=false;button.onclick=async()=>{if(!ack.checked||pending)return;pending=true;button.disabled=true;try{await onConfirm(structuredClone(displayed));status.textContent='Attribution confirmed for the displayed scope.';}catch(e){status.textContent=e.message;}finally{pending=false;button.disabled=!ack.checked;}};
    root.replaceChildren(title,note,label,button,status);
}

export function casualOperation({eventId,gameId,rosterRevision,operationId,expectedRevision,kind='record',result,seats,actor}) {
    if(!['501','cricket'].includes(result.gameType))throw Error('Unsupported personal-history game');
    const ids=seats.filter(s=>s.uid!==null).map(s=>s.uid);
    if(new Set(ids).size!==ids.length||!Array.isArray(result.participantIds)||ids.length!==result.participantIds.length||ids.some(uid=>!result.participantIds.includes(uid)))throw Error('Result participants differ from seats');
    if(!Array.isArray(result.perPlayer)||result.perPlayer.some(c=>!ids.includes(c.playerId)))throw Error('Unknown counter owner');
    return {eventId,matchId:gameId,operationId,expectedRevision,kind,binding:{scope:'game-seat',gameId,rosterRevision},players:seats.map(s=>({registrationId:s.registrationId,uid:s.uid,seatId:s.seatId,invitationId:s.invitationId})),result:{type:result.gameType,winnerId:result.winnerId??null,counters:structuredClone(result.perPlayer)},affected:[gameId],blocked:[],actor};
}
