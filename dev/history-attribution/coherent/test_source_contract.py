"""Source checks only: not a rules parser or an enforcement test."""
import unittest,importlib.util,subprocess
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('coherent_composer',HERE/'compose_rules.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class SourceContract(unittest.TestCase):
 def test_disconnected(self):
  root=m.ROOT
  self.assertNotIn('coherent',(root/'firebase.json').read_text())
  self.assertNotIn('coherent',(root/'dev/sw.js').read_text())
 def test_no_legacy_rule_change(self):
  source=m.compose();fragment=(HERE/'candidate.fragment.rules').read_text()
  self.assertEqual(source.replace(fragment+'\n',''),m.m.compose())
 def test_atomic_source_and_immutable_grants(self):
  s=(HERE/'candidate.fragment.rules').read_text()
  for required in ['hcTransition(c,resource.data','hcOccurrenceValid','getAfter(','grant.at < first.at','get(revoked).data.at > first.at','allow update,delete: if false','request.resource.data.uid == u','hcCounter(u,context.gameType','p.actorUid == request.auth.uid']:
   self.assertIn(required,s)
 def test_casual_participant_guard_is_order_independent(self):
  # Source contract only. Actual Firestore evaluation is covered by the
  # separately reported laptop enforcement run, not this static assertion.
  s=m.compose()
  self.assertIn("(d.kind == 'tournament' ? o.participants == hcParticipants(d,p.after) : (o.participants.size() == p.after.perPlayer.size() && o.participants.toSet() == p.after.perPlayer.keys().toSet()))",s)
  self.assertNotIn('o.participants == p.after.perPlayer.keys()',s)
 def test_owner_projection_not_tablet_history(self):
  s=(HERE/'candidate.fragment.rules').read_text();block=s[s.index('match /contexts/{c}/history/{o}'):]
  self.assertIn('hcPlayer() && request.auth.uid == u',block);self.assertNotIn('hcWriter',block)
 def test_bounded_discovery_no_per_user_dynamic_index(self):
  s=(HERE/'adapter.mjs').read_text();self.assertIn("where('participants','array-contains',u.uid)",s)
  self.assertNotIn("where(new sdk.FieldPath",s);self.assertIn('limit(50)',s)
if __name__=='__main__':unittest.main(verbosity=2)
