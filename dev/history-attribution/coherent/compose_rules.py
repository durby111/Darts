"""Generate disabled candidate only; no release/firebase config changes."""
from pathlib import Path
import importlib.util
HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[2]
spec=importlib.util.spec_from_file_location('public_candidate',ROOT/'dev/public-pilot/compose_rules.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def compose():
 source=m.compose();marker='    match /{document=**} {'
 assert source.count(marker)==1
 return source.replace(marker,(HERE/'candidate.fragment.rules').read_text()+'\n'+marker)
if __name__=='__main__':print(compose(),end='')
