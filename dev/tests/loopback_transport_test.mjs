import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), net=require('node:net');
const {assertLoopbackArgs,install}=require('./loopback_transport.cjs');
let n=0;
for(const args of [[{host:'127.0.0.1',port:1}],[[{host:'localhost',port:1},null]],[1,'::1']]){assert.doesNotThrow(()=>assertLoopbackArgs(args));n++;}
for(const args of [[{host:'example.invalid',port:443}],[[{host:'example.invalid',port:443},null]],[[[{host:'example.invalid',port:443},null]]],[443,'example.invalid'],[443],[{port:443}],['/tmp/socket'],[{path:'/tmp/socket',host:'localhost'}],[]]){assert.throws(()=>assertLoopbackArgs(args));n++;}
// Exercise the real normalized net.createConnection call path without networking.
const original=net.Socket.prototype.connect;let continuations=0;
net.Socket.prototype.connect=function(){continuations++;return this;};install();
try{assert.throws(()=>net.createConnection({host:'example.invalid',port:443}));assert.equal(continuations,0);n++;}finally{net.Socket.prototype.connect=original;}
console.log(`PASS ${n} loopback socket guard cases, including actual normalized createConnection`);
