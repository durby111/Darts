import concurrent.futures, unittest
from server import Pairing

class PairingTest(unittest.TestCase):
    def setUp(self):
        self.now=1000
        self.s=Pairing(lambda:self.now)
        self.b=self.s.call('display',{})
        self.u=self.s.call('login',dict(account='alex',provider='Google'))
        self.h=self.board('pair',seat='1')
    def board(self,action,**data):return self.s.call(action,dict(game=self.b['game'],**data),self.b['token'])
    def claim(self,**extra):
        d=dict(handle=self.h['handle'],code=self.h['code'],game=self.b['game'],seat='1',uid=self.u['account']['uid']);d.update(extra)
        return self.s.call('claim',d,self.u['token'])
    def test_expiry(self):
        self.now+=120
        with self.assertRaises(ValueError):self.claim()
    def test_replay(self):
        self.claim()
        with self.assertRaises(ValueError):self.claim()
    def test_concurrent(self):
        def attempt(_):
            try:self.claim();return True
            except ValueError:return False
        with concurrent.futures.ThreadPoolExecutor(8) as pool:self.assertEqual(sum(pool.map(attempt,range(8))),1)
    def test_wrong_seat_game_account_code(self):
        for extra in [dict(seat='2'),dict(game='other'),dict(uid='demo-sam'),dict(code='bad')]:
            with self.assertRaises(ValueError):self.claim(**extra)
        self.claim()
    def test_revoke_remove_leave_end(self):
        for action in ['remove','leave','end']:
            self.setUp();self.claim()
            if action=='leave':self.s.call(action,dict(game=self.b['game'],seat='1'),self.u['token'])
            else:self.board(action,seat='1')
            self.assertIsNone(self.board('state')['seats']['1'])
            with self.assertRaises(ValueError):self.claim()
    def test_reload_only_participation(self):
        self.claim();state=self.board('state');self.assertEqual(state,self.board('state'))
        grant=state['seats']['1'];self.assertEqual(grant['uid'],'demo-alex')
        self.assertEqual(grant['scope'],'game-participation');self.assertNotIn('token',grant)
        with self.assertRaises(ValueError):self.s.call('state',dict(game=self.b['game']),self.u['token'])
    def test_unverified(self):
        self.u=self.s.call('login',dict(account='unverified',provider='Email'))
        with self.assertRaises(ValueError):self.claim()
    def test_rotation_end_pending(self):
        self.board('pair',seat='1')
        with self.assertRaises(ValueError):self.claim()
        self.h=self.board('pair',seat='2');self.board('end')
        with self.assertRaises(ValueError):self.claim(seat='2')
    def test_grant_expiry(self):
        self.claim();self.now+=4*3600
        self.assertIsNone(self.board('state')['seats']['1'])
    def test_rate_limit(self):
        for _ in range(60):self.s.call('me',{},self.u['token'])
        with self.assertRaises(ValueError):self.s.call('me',{},self.u['token'])
    def test_guest_and_duplicate_identity(self):
        self.assertTrue(all(v is None for v in self.board('state')['seats'].values()))
        self.claim();self.h=self.board('pair',seat='2')
        with self.assertRaises(ValueError):self.claim(seat='2')

if __name__=='__main__':unittest.main(verbosity=2)
