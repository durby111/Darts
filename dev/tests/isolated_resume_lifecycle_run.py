#!/usr/bin/env python3
"""Credential-free local QA. Entire process tree runs in a loopback-only netns.
Explicit tool paths are required; no downloads/login and no host-network fallback.
"""
import os, sys, subprocess, socket, time, hashlib, json, signal, shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
if '--inside-netns' not in sys.argv:
    command=['unshare','-Urn',sys.executable,str(Path(__file__).resolve()),'--inside-netns',*sys.argv[1:]]
    raise SystemExit(subprocess.call(command))
subprocess.run(['/usr/sbin/ip','link','set','lo','up'],check=True)
interfaces={line.split(':')[0].strip() for line in Path('/proc/net/dev').read_text().splitlines() if ':' in line}
if interfaces!={'lo'}:raise SystemExit('Refusing non-loopback network namespace')
required=['NODE','JAVA','JAR','MODULES','PLAYWRIGHT','CHROME','PYTHON','OUTPUT']
qa={key:os.environ['BLAKEOUT_QA_'+key] for key in required}
for key in required:
    if not Path(qa[key]).is_absolute():raise SystemExit('Tool/output paths must be absolute: '+key)
OUT=Path(qa['OUTPUT']).resolve()
if OUT.is_relative_to(ROOT):raise SystemExit('Evidence output must be outside the source checkout')
OUT.mkdir(parents=True,exist_ok=True)
(OUT/'network.json').write_text(json.dumps({'interfaces':sorted(interfaces),'namespace':os.readlink('/proc/self/ns/net'),'routes':Path('/proc/net/route').read_text()},indent=2))
(OUT/'home').mkdir(exist_ok=True);(OUT/'bin').mkdir(exist_ok=True)
chrome=OUT/'bin/chromium'
if not chrome.exists():chrome.symlink_to(qa['CHROME'])
env={'PATH':str(OUT/'bin')+':'+str(Path(qa['NODE']).parent)+':/usr/bin:/bin','HOME':str(OUT/'home'),'TMPDIR':'/tmp','PYTHONDONTWRITEBYTECODE':'1','NO_PROXY':'127.0.0.1,localhost','FIREBASE_CLI_DISABLE_TELEMETRY':'true','BLAKEOUT_JSDOM_MODULE':qa['MODULES']+'/jsdom'}
env.update({'BLAKEOUT_QA_'+k:v for k,v in qa.items()})
os.chdir(ROOT)
# Include imported codecs, guards and all test sources, not just the entry module.
def fingerprints():
    paths=[p for p in ROOT.rglob('*') if p.is_file() and p.suffix in {'.js','.mjs','.cjs','.py','.rules','.json'} and 'node_modules' not in p.parts]
    return {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(paths)}
before=fingerprints();(OUT/'sources.json').write_text(json.dumps(before,indent=2))
build="require(process.env.BLAKEOUT_QA_MODULES+'/esbuild').buildSync({entryPoints:['dev/tests/isolated_sdk_entry.js'],bundle:true,format:'esm',platform:'browser',nodePaths:[process.env.BLAKEOUT_QA_MODULES],outfile:process.env.BLAKEOUT_QA_OUTPUT+'/sdk.js'})"
subprocess.run([qa['NODE'],'-e',build],env=env,check=True)
children=[];handles=[];results=[]
def run(name,cmd,timeout=300):
    p=subprocess.Popen(cmd,env={**env,'FIRESTORE_EMULATOR_HOST':'127.0.0.1:18085'},stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
    try:stdout,_=p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(p.pid,signal.SIGKILL);stdout,_=p.communicate();stdout+='\nTIMEOUT\n'
    (OUT/(name+'.log')).write_text(stdout)
    results.append({'name':name,'exit':p.returncode,'pass_lines':sum(x.startswith('PASS') for x in stdout.splitlines()),'skip_lines':[x for x in stdout.splitlines() if x.startswith('SKIP')]})
    print(name+': exit '+str(p.returncode)+'\n'+stdout[-1400:],flush=True)
try:
    for name,cmd in [('firestore',[qa['JAVA'],'-jar',qa['JAR'],'--host','127.0.0.1','--port','18085','--project_id','demo-blakeout-adapter-task3']),('auth',[qa['NODE'],'dev/tests/isolated_auth_server.cjs'])]:
        f=open(OUT/(name+'.log'),'w');handles.append(f);children.append(subprocess.Popen(cmd,env=env,stdout=f,stderr=subprocess.STDOUT))
    for port in [18085,19099]:
        deadline=time.monotonic()+45
        while True:
            if any(p.poll() is not None for p in children):raise RuntimeError('Emulator startup failed')
            try:
                with socket.create_connection(('127.0.0.1',port),timeout=.2):break
            except OSError:
                if time.monotonic()>deadline:raise
                time.sleep(.2)
    if '--integration-only' not in sys.argv:run('pilot-guard',[qa['PYTHON'],'dev/tests/isolated_pilot_guard_test.py'])
    if '--integration-only' not in sys.argv:run('isolated-rules',[qa['PYTHON'],'dev/tests/isolated_rules_test.py'])
    if '--integration-only' not in sys.argv:run('large-ledger',[qa['PYTHON'],'dev/tests/isolated_large_ledger_test.py'])
    run('resume-lifecycle',[qa['NODE'],'dev/tests/isolated_resume_lifecycle_integration.mjs'],600)
    if '--resume-only' not in sys.argv:run('multiuser-integration',[qa['NODE'],'dev/tests/isolated_multiuser_integration.mjs'],600)
    for test in ([] if '--integration-only' in sys.argv else sorted(ROOT.glob('dev/tests/*test.mjs'))):
        run(test.stem,[qa['NODE'],'--experimental-vm-modules',str(test)])
    if '--full' in sys.argv:
        for name in ['platform_test','isolated_backend_test','dev_test']:
            run(name,[qa['PYTHON'],'dev/tests/'+name+'.py'],1800)
finally:
    for p in children:p.terminate()
    for p in children:
        try:p.wait(timeout=10)
        except subprocess.TimeoutExpired:p.kill();p.wait()
    for f in handles:f.close()
    (OUT/'results.json').write_text(json.dumps(results,indent=2))
if before!=fingerprints():raise SystemExit('Executed sources changed during run; evidence invalid')
raise SystemExit(0 if all(r['exit']==0 for r in results) else 1)
