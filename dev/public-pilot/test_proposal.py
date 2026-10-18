"""Static proposal/regression tests. NOT emulator or authorization acceptance."""
import copy,json,subprocess,unittest
from pathlib import Path
from compose_rules import compose,module,ROOT
from test_public_rules import cases
POLICY=ROOT/'dev/release/real-player-pilot/policy.proposed.json'
def validate(p):
 assert p['onboardingMode']=='public-signup' and p['publicSignupExpansionAllowed'] is True
 assert p['proposedTesterCap'] is None and p['invitedTesterUids']==[]
 assert p['additionalTesterAccessEnabled'] is False and p['activationRequiresSeparateConfirmation'] is True
 assert p['requireVerifiedEmail'] is True and p['allowAnonymousPrivateData'] is False
 assert p['acceptedGameTypes']==['501','cricket'] and p['backendProject']=='blakeout-darts-dev'
class Proposal(unittest.TestCase):
 def test_policy(self):
  p=json.loads(POLICY.read_text());validate(p)
  for key,value in [('additionalTesterAccessEnabled',True),('requireVerifiedEmail',False),('allowAnonymousPrivateData',True),('activationRequiresSeparateConfirmation',False),('onboardingMode','invited-only'),('proposedTesterCap',5)]:
   q=copy.deepcopy(p);q[key]=value
   with self.assertRaises(AssertionError):validate(q)
 def test_reproducible_rules(self):self.assertEqual(compose(),(ROOT/'dev/public-pilot/firestore.public-proposed.rules').read_text())
 def test_unchanged_security_fragments(self):
  s=compose()
  for p in ['dev/tournament-device/resume.rules.fragment','dev/tournament-device/device.rules.fragment','dev/qr-firebase/pairing.rules.fragment']:self.assertIn((ROOT/p).read_text(),s)
  self.assertIn("&& request.auth.uid in devPilotUids()",s)
  self.assertIn("function qrBoardUids() { return []; }",s)
  self.assertIn("request.resource.data.participantIds == [request.auth.uid]",s)
  self.assertIn('request.resource.data.playerId == request.auth.uid',s)
  self.assertIn("request.resource.data.gameType in ['501', 'cricket']",s)
 def test_no_runtime_or_live_configuration_change(self):
  changed=subprocess.check_output(['git','diff','--name-only','2f30644','--'],cwd=ROOT,text=True).splitlines()
  self.assertTrue(all(p.startswith(('dev/public-pilot/','dev/release/real-player-pilot/')) for p in changed),changed)
  self.assertEqual(json.loads((ROOT/'firebase.json').read_text())['firestore']['rules'],'firestore.rules')
 def test_matrix_integrity(self):
  seed,matrix=cases();self.assertEqual(len(matrix),len({c['name'] for c in matrix}))
  self.assertTrue(any(c['auth']=='brandnew' and c['allow'] for c in matrix))
  self.assertTrue(all(not c['allow'] for c in matrix if c['auth'] in [None,'anonymous','anonymous_verified','unverified']))
  print('Prepared actual emulator cases:',len(matrix)+2,'(NOT executed by this test)')
if __name__=='__main__':unittest.main(verbosity=2)
