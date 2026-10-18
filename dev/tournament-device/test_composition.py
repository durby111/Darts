"""Source/provenance regressions only; does not compile or enforce Firestore rules."""
import hashlib,json,re,subprocess,unittest
from pathlib import Path
from compose_rules import compose,ROOT,HERE
P=json.loads((HERE/'lifecycle-provenance.json').read_text())
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def valid(source):
    fragment=(HERE/'resume.rules.fragment').read_text()
    assert hashlib.sha256(fragment.encode()).hexdigest()==P['fragmentSha256']
    assert source.count('match /blakeoutDevActiveGames/')==1
    assert source.count(fragment)==1
    assert "return database == '(default)' && request.auth != null && !qrBoard()" in source
    for role in ['devPilotUids','qrBoardUids','qrPlayerUids','tdOperatorUids']:
        assert re.search(r'function '+role+r'\(\)\s*\{[^}]*return\s*\[\];',source)
    assert source.count('match /{document=**}')==1
    assert 'allow read, write: if false;' in source
class Composition(unittest.TestCase):
    def test_exact_recovered_lifecycle(self):
        raw=git('show',P['sourceCommit']+':'+P['sourcePath'])
        self.assertEqual(hashlib.sha256(raw).hexdigest(),P['sourceSha256'])
        text=raw.decode();start=text.index('    match /blakeoutDevActiveGames/')
        self.assertEqual(text[start:text.index('    match /{document=**}',start)],(HERE/'resume.rules.fragment').read_text())
    def test_closed_combined_source(self):valid(compose())
    def test_unsafe_mutations_rejected(self):
        s=compose()
        mutations=[s.replace(' && !qrBoard()',''),s.replace('return [];','return ["synthetic"];',1),s.replace("d.updatedAt == request.time","d.updatedAt is int"),s.replace("duration.value(30, 'd')","duration.value(0, 'd')"),s.replace('allow read, write: if false;','allow read, write: if true;'),s+(HERE/'resume.rules.fragment').read_text()]
        for source in mutations:
            with self.subTest(source_hash=hashlib.sha256(source.encode()).hexdigest()):
                with self.assertRaises(AssertionError):valid(source)
    def test_current_production_baseline(self):
        # Explicit CURRENT baseline; does not recreate unavailable 3011d48 history.
        names=git('ls-tree','-r','--name-only',P['productionBaseline']).decode().splitlines()
        files=[p for p in names if not p.startswith('dev/')]
        for p in files:self.assertEqual((ROOT/p).read_bytes(),git('show',P['productionBaseline']+':'+p),p)
        print(f'PASS all {len(files)} non-DEV baseline files identical to {P["productionBaseline"]}')
if __name__=='__main__':unittest.main(verbosity=2)
