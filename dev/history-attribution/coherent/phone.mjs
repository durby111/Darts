// Disabled phone integration; uses authoritative context details and existing UI.
import {phoneConsentView} from '../integration.mjs';
export async function mountPhoneConsent(root,api,params) {
 const displayed=await api.consentDetails(params);
 phoneConsentView(root,displayed,async()=>api.confirm({...params,displayed,displayedUid:displayed.uid,acknowledged:true}));
}
