"""Loopback-only synthetic pairing service. Never connect this mock to Firebase."""
import json, secrets, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Pairing:
    def __init__(self, clock=time.time):
        self.clock, self.lock = clock, threading.RLock()
        self.games, self.handles, self.sessions, self.limits = {}, {}, {}, {}

    def call(self, action, data, token=''):
        with self.lock:  # all validation and mutation are one atomic operation
            now = self.clock()
            bucket = (token, action)
            recent = [t for t in self.limits.get(bucket, []) if now-t < 60]
            if len(recent) >= 60: raise ValueError('Too many attempts. Try again in a minute.')
            self.limits[bucket] = recent + [now]
            if action == 'display':
                owner, game = secrets.token_urlsafe(32), secrets.token_urlsafe(12)
                self.games[game] = dict(game=game, display='Practice board', title='X01 · Local demo', owner=owner, ended=False, seats={str(i): None for i in range(1,5)})
                return dict(token=owner, game=game)
            if action == 'login':
                # Synthetic identities only. Provider selection has no external side effects.
                if data.get('account') not in ('alex', 'sam', 'unverified'): raise ValueError('Choose a demo account.')
                if data.get('provider') not in ('Google', 'Email'): raise ValueError('Choose Google or email.')
                uid = 'demo-' + data['account']
                session = secrets.token_urlsafe(32)
                self.sessions[session] = dict(uid=uid, name=data['account'].title(), verified=data['account'] != 'unverified', provider=data['provider'])
                return dict(token=session, account=self.sessions[session])
            if action == 'logout':
                self.sessions.pop(token, None)
                return {}
            if action == 'me':
                if token not in self.sessions: raise ValueError('Choose an account again.')
                return self.sessions[token]
            if action in ('inspect', 'claim'):
                h = self.handles.get(data.get('handle'))
                if not h or h['used'] or now >= h['expires']: raise ValueError('This code expired or was used. Ask the board for a new code.')
                g = self.games[h['game']]
                if g['ended'] or g['seats'][h['seat']]: raise ValueError('This seat is no longer available.')
                context = dict(game=g['game'], title=g['title'], display=g['display'], seat=h['seat'], expires=h['expires'])
                if action == 'inspect': return context
                user = self.sessions.get(token)
                if not user or not user['verified']: raise ValueError('Use a verified demo identity.')
                if data.get('uid') != user['uid']: raise ValueError('Account changed. Review your account again.')
                if data.get('game') != h['game'] or data.get('seat') != h['seat']: raise ValueError('Wrong game or seat. Scan the intended seat again.')
                if data.get('code') != h['code']: raise ValueError('Code does not match the board.')
                if any(s and s['uid'] == user['uid'] for s in g['seats'].values()): raise ValueError('This account already has a seat here.')
                h['used'] = True
                grant = dict(id=secrets.token_urlsafe(24), uid=user['uid'], name=user['name'], game=h['game'], seat=h['seat'], scope='game-participation', expires=now+4*3600)
                g['seats'][h['seat']] = grant
                return grant.copy()
            game = data.get('game')
            g = self.games.get(game)
            if not g: raise ValueError('Board session is gone. Start a new local game.')
            owner = secrets.compare_digest(token, g['owner'])
            if action == 'participation':
                user = self.sessions.get(token)
                grant = g['seats'].get(data.get('seat'))
                active = bool(user and grant and grant['uid'] == user['uid'] and now < grant['expires'] and not g['ended'])
                return dict(active=active)
            if action == 'leave':
                user = self.sessions.get(token)
                seat = data.get('seat')
                grant = g['seats'].get(seat)
                if not user or not grant or grant['uid'] != user['uid']: raise ValueError('This is not your seat.')
                g['seats'][seat] = None
                return {}
            if not owner: raise ValueError('Board authorization required.')
            for seat, grant in g['seats'].items():
                if grant and now >= grant['expires']: g['seats'][seat] = None
            if action == 'state': return {k:v for k,v in g.items() if k != 'owner'}
            if action == 'end':
                g['ended'] = True
                g['seats'] = {str(i): None for i in range(1,5)}
                for h in self.handles.values():
                    if h['game'] == game: h['used'] = True
                return {}
            if g['ended']: raise ValueError('This game has ended.')
            seat = data.get('seat')
            if seat not in g['seats']: raise ValueError('Unknown seat.')
            if action in ('pair', 'remove'):
                for h in self.handles.values():
                    if h['game'] == game and h['seat'] == seat: h['used'] = True
                if action == 'remove':
                    g['seats'][seat] = None
                    return {}
                if g['seats'][seat]: raise ValueError('Remove the current player first.')
                handle = secrets.token_urlsafe(32)
                code = f'{secrets.randbelow(1000000):06}'
                self.handles[handle] = dict(game=game, seat=seat, code=code, expires=now+120, used=False)
                return dict(handle=handle, code=code, expires=now+120, seat=seat)
            raise ValueError('Unknown action.')

service = Pairing()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass  # never log handles, credentials or request bodies
    def respond(self, status, body, mime='application/json'):
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body if isinstance(body, bytes) else json.dumps(body).encode())
    def valid_host(self):
        return self.headers.get('Host') == f'127.0.0.1:{self.server.server_port}'
    def do_GET(self):
        if not self.valid_host(): return self.respond(403, {})
        name = self.path.split('?')[0].lstrip('/') or 'index.html'
        if name not in ('index.html', 'app.js', 'style.css', 'qr.js'): return self.respond(404, {})
        mime = 'text/html' if name.endswith('html') else 'text/css' if name.endswith('css') else 'text/javascript'
        self.respond(200, Path(__file__).with_name(name).read_bytes(), mime)
    def do_POST(self):
        origin = f'http://127.0.0.1:{self.server.server_port}'
        if not self.valid_host() or self.headers.get('Origin') != origin: return self.respond(403, {'error':'Local origin required.'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if size > 4096 or size <= 0: raise ValueError('Invalid request size.')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict): raise ValueError('Invalid request.')
            result = service.call(self.path.removeprefix('/api/'), data, self.headers.get('Authorization', '').removeprefix('Bearer '))
            self.respond(200, result)
        except (ValueError, TypeError, KeyError) as error:
            self.respond(400, {'error':str(error)})

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8874)
    args = parser.parse_args()
    print(f'BlakeOut synthetic QR demo: http://127.0.0.1:{args.port}', flush=True)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
