export const DESTINATION='https://8080-cs-890759530763-default.cs-us-central1-pits.cloudshell.dev';
export const APP_ORIGIN='https://blakeoutdarts.com';
export function accept(event,source,origin,challenge){
 return !!source&&event.source===source&&event.origin===origin&&event.data?.channel==='blakeout-dev-once'&&(!challenge||event.data.challenge===challenge);
}
export function packet(type,challenge,extra={}){return {channel:'blakeout-dev-once',type,challenge,...extra};}
