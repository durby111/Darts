"""Local-only emulator suite; mandatory fresh loopback-only network namespace."""
import os,sys,subprocess,socket,time,json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
if '--inside' not in sys.argv:
    raise SystemExit(subprocess.call(['unshare','-Urn',sys.executable,__file__,'--inside']))
subprocess.run(['/usr/sbin/ip','link','set','lo','up'],check=True)
interfaces=[line.split(':')[0].strip() for line in Path('/proc/net/dev').read_text().splitlines() if ':' in line]
assert interfaces==['lo']
out=Path(os.environ['QR_EVIDENCE']).resolve();out.mkdir(parents=True,exist_ok=True)
assert not out.is_relative_to(ROOT)
node=os.environ['BLAKEOUT_QA_NODE'];java=os.environ['BLAKEOUT_QA_JAVA'];jar=os.environ['BLAKEOUT_QA_JAR']
env={**os.environ,'FIREBASE_CLI_DISABLE_TELEMETRY':'true','NO_PROXY':'127.0.0.1,localhost','QR_EVIDENCE':str(out),'FIRESTORE_EMULATOR_HOST':'127.0.0.1:18085','PYTHONDONTWRITEBYTECODE':'1'}
os.chdir(ROOT)
from compose_rules import compose
(out/'candidate.rules').write_text(compose())
sources={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dev/qr-firebase').glob('*') if p.is_file()}
(out/'sources.json').write_text(json.dumps(sources,indent=2));(out/'network.json').write_text(json.dumps({'interfaces':interfaces,'routes':Path('/proc/net/route').read_text()},indent=2))
subprocess.run([node,'-e',"require(process.env.BLAKEOUT_QA_MODULES+'/esbuild').buildSync({entryPoints:['dev/qr-firebase/emulator-session.mjs'],bundle:true,format:'esm',platform:'browser',nodePaths:[process.env.BLAKEOUT_QA_MODULES],outfile:process.env.QR_EVIDENCE+'/sdk.js'})"],env=env,check=True)
children=[];logs=[]
try:
    for name,cmd in [('firestore',[java,'-jar',jar,'--host','127.0.0.1','--port','18085','--project_id','demo-blakeout-adapter-task3']),('auth',[node,'dev/tests/isolated_auth_server.cjs'])]:
        f=open(out/(name+'.log'),'w');logs.append(f);children.append(subprocess.Popen(cmd,env=env,stdout=f,stderr=subprocess.STDOUT))
    for port in [18085,19099]:
        deadline=time.monotonic()+60
        while True:
            if any(p.poll() is not None for p in children):raise RuntimeError('Emulator startup failed')
            try:
                with socket.create_connection(('127.0.0.1',port),timeout=.2):break
            except OSError:
                if time.monotonic()>deadline:raise
                time.sleep(.2)
    p=subprocess.run([node,'dev/qr-firebase/test_integration.mjs'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=300)
    (out/'integration.log').write_text(p.stdout);print(p.stdout,flush=True)
    (out/'result.json').write_text(json.dumps({'exit':p.returncode,'passGroups':p.stdout.count('PASS '),'sources':sources},indent=2))
    if p.returncode:raise SystemExit(p.returncode)
    regression=subprocess.run([sys.executable,'dev/qr-firebase/test_existing_rules.py'],env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,timeout=180)
    (out/'existing-rules.log').write_text(regression.stdout);print(regression.stdout[-3000:],flush=True)
    (out/'regression-result.json').write_text(json.dumps({'exit':regression.returncode},indent=2))
    assert sources=={str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT/'dev/qr-firebase').glob('*') if p.is_file()},'Sources changed during test'
    if regression.returncode:raise SystemExit(regression.returncode)
finally:
    for p in children:p.terminate()
    for p in children:
        try:p.wait(timeout=10)
        except subprocess.TimeoutExpired:p.kill();p.wait()
    for f in logs:f.close()
