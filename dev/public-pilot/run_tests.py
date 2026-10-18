"""Run the NEW public-policy matrix in a fresh loopback-only namespace; no downloads."""
import os,sys,subprocess,socket,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
if '--inside' not in sys.argv:raise SystemExit(subprocess.call(['unshare','-Urn',sys.executable,__file__,'--inside']))
subprocess.run(['/usr/sbin/ip','link','set','lo','up'],check=True)
interfaces={x.split(':')[0].strip() for x in Path('/proc/net/dev').read_text().splitlines() if ':' in x}
assert interfaces=={'lo'}
out=Path(os.environ['PUBLIC_POLICY_EVIDENCE']).resolve();assert not out.is_relative_to(ROOT);out.mkdir(parents=True,exist_ok=False)
(out/'network.txt').write_text(Path('/proc/net/dev').read_text()+'\n'+Path('/proc/net/route').read_text())
(out/'home').mkdir()
env={'PATH':'/usr/bin:/bin','HOME':str(out/'home'),'PYTHONDONTWRITEBYTECODE':'1','FIRESTORE_EMULATOR_HOST':'127.0.0.1:18085','NO_PROXY':'127.0.0.1,localhost'}
java=os.environ['BLAKEOUT_QA_JAVA'];jar=os.environ['BLAKEOUT_QA_JAR'];assert Path(java).is_absolute() and Path(jar).is_absolute()
for key in ['BLAKEOUT_QA_NODE','BLAKEOUT_QA_MODULES']:
 value=os.environ[key];assert Path(value).is_absolute();env[key]=value
with (out/'firestore.log').open('w') as log:
 p=subprocess.Popen([java,'-jar',jar,'--host','127.0.0.1','--port','18085','--project_id','demo-blakeout-public-policy'],env=env,stdout=log,stderr=subprocess.STDOUT)
 try:
  deadline=time.monotonic()+60
  while True:
   if p.poll() is not None:raise RuntimeError('Emulator startup failed')
   try:
    with socket.create_connection(('127.0.0.1',18085),timeout=.2):break
   except OSError:
    if time.monotonic()>deadline:raise
    time.sleep(.2)
  with (out/'public-enforcement.log').open('w') as results:
   result=subprocess.run([sys.executable,str(ROOT/'dev/public-pilot/test_public_rules.py')],env=env,stdout=results,stderr=subprocess.STDOUT,timeout=600)
  print((out/'public-enforcement.log').read_text());raise SystemExit(result.returncode)
 finally:
  p.terminate()
  try:p.wait(timeout=10)
  except subprocess.TimeoutExpired:p.kill();p.wait()
