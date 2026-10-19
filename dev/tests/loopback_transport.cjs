'use strict';
// Node may normalize connect arguments to [options, callback] before dispatch.
function assertLoopbackArgs(input) {
    let args=input;
    for(let i=0;i<4 && Array.isArray(args[0]);i++) args=args[0];
    const options=args[0];
    const host=options && typeof options==='object' && !Array.isArray(options)
        ? (options.path ? undefined : options.host)
        : typeof options==='number' && typeof args[1]==='string' ? args[1] : undefined;
    if(!['127.0.0.1','localhost','::1'].includes(host)) throw Error('Non-loopback or ambiguous socket destination blocked');
}
function install(){
    const net=require('node:net'), original=net.Socket.prototype.connect;
    net.Socket.prototype.connect=function(...args){assertLoopbackArgs(args);return original.apply(this,args);};
    global.fetch=()=>Promise.reject(Error('Auth emulator outbound fetch blocked'));
}
module.exports={assertLoopbackArgs,install};
