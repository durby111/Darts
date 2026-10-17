require('./loopback_transport.cjs').install();
const {AuthEmulator,SingleProjectMode}=require(process.env.BLAKEOUT_QA_MODULES+'/firebase-tools/lib/emulator/auth/index.js');
const emulator=new AuthEmulator({projectId:'demo-blakeout-adapter-task3',host:'127.0.0.1',port:19099,singleProjectMode:SingleProjectMode.ERROR});
emulator.start().then(()=>console.log('Local synthetic Auth emulator ready'));
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,async()=>{await emulator.stop();process.exit(0);});
