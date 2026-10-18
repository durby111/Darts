"""Reuse the existing 155-case account matrix against merged pairing rules."""
import importlib.util,json,os
from pathlib import Path
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('account_rules_test',root/'dev/tests/isolated_rules_test.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.RULES=Path(os.environ['QR_EVIDENCE'])/'candidate.rules'
module.emulator_checks(json.loads(module.MATRIX.read_text()))
