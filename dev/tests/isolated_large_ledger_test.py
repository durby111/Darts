import copy, importlib.util, json
from pathlib import Path
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('rules_test',root/'dev/tests/isolated_rules_test.py')
t=importlib.util.module_from_spec(spec);spec.loader.exec_module(t)
m=json.loads(t.MATRIX.read_text())
c=copy.deepcopy(next(c for c in m['cases'] if c['name']=='strict canonical ledger accepted'))
r=json.loads(c['data']['records']);turn=r['legs'][0]['turns'][0]
r['legs'][0]['turns']=[dict(turn,id=f'turn{i}') for i in range(1000)]
c['data']['records']=json.dumps(r,separators=(',',':'));c['name']='1000-turn canonical ledger enforcement'
m['cases']=[c]
t.emulator_checks(m)
