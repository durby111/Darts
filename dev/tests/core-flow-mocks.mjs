export const scenario={verified:false,offline:false,calls:0,hold:null};
export const BACKEND_KEY='synthetic',BUILD_STORAGE={casualRecoveryPrefix:'synthetic-'};
export const game={};export const RECORDING_GAMES=new Set(['501','minnesota']);
export const requireCurrentBackend=()=>{},recordingSession=()=>null,saveActiveGame=()=>true,restoreActiveGame=()=>{},localRecordingRecoveries=()=>[],newRecordId=()=> 'synthetic-result',recordingComplete=()=>true,recordingWinnerIds=()=>[],scoringResult=()=>({});
export const isFeatureAvailable=name=>name==='accounts';
export const showModal=id=>{document.getElementById(id).style.display='flex';};
export const hideModal=id=>{document.getElementById(id).style.display='none';};
export const initPlatform=async()=>{};
export const requireVerifiedAccount=()=>{if(!scenario.verified)throw Error('Sign in and verify your email address on the Accounts page first.');return {uid:'synthetic-owner'};};
const profiles=[{id:'synthetic-owner',name:'Synthetic owner'},{id:'synthetic-other',name:'Synthetic other'}];
export const listProfilePage=async()=>({profiles,nextCursor:null});
export async function getProfilesByIds(ids){scenario.calls++;if(scenario.hold)await scenario.hold;if(scenario.offline)throw Error('Offline: profile verification unavailable.');return profiles.filter(p=>ids.includes(p.id));}
