"""Proposed public accounts policy only. Prints source; never deploys/configures."""
import importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('device_composer',ROOT/'dev/tournament-device/compose_rules.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
PUBLIC='''    function publicVerified() {
      return database == '(default)' && request.auth != null && !qrBoard()
        && devId(request.auth.uid)
        && request.auth.token.get('email_verified', false) == true
        && request.auth.token.get('firebase', {}).get('sign_in_provider', '') in ['password', 'google.com'];
    }
    function publicPage() {
      return request.query.limit != null && request.query.limit > 0 && request.query.limit <= 50;
    }
'''
def compose():
    source=module.compose()
    source=source.replace('    function devText(',PUBLIC+'\n    function devText(',1)
    # Only these existing collection grants become public-verified. Legacy
    # tournaments, device roles and private resume keep their original guards.
    for collection,next_marker in [('blakeoutDevProfiles','    // Canonical'),('blakeoutDevCasualResults','    match /blakeoutDevCasualReceipts'),('blakeoutDevCasualReceipts','    // No grants')]:
        start=source.index('    match /'+collection+'/');end=source.index(next_marker,start)
        block=source[start:end].replace('devVerified()','publicVerified()')
        if collection=='blakeoutDevProfiles':
            block=block.replace('allow read: if publicVerified();','allow get: if publicVerified();\n      allow list: if publicVerified() && publicPage();')
        else:
            block=block.replace('allow list: if publicVerified()','allow list: if publicVerified() && publicPage()')
        if collection=='blakeoutDevCasualResults':
            block=block.replace('&& devCasualGame(request.resource.data.gameType)',"&& request.resource.data.gameType in ['501', 'cricket']\n        && request.resource.data.participantIds == [request.auth.uid]")
            # Existing canonical counter grammar must use only the result's game.
            block=block.replace('devCasualCounters(request.resource.data.perPlayer, request.resource.data.participantIds)', 'publicCounters(request.resource.data.perPlayer, request.resource.data.participantIds, request.resource.data.gameType)')
        if collection=='blakeoutDevCasualReceipts':
            block=block.replace('&& devBackend(request.resource.data)','&& request.resource.data.playerId == request.auth.uid\n        && devBackend(request.resource.data)',1)
        source=source[:start]+block+source[end:]
    start=source.index('    function devCasualCounters(');end=source.index('    match /blakeoutDevCasualResults',start)
    counters=source[start:end].replace('function devCasualCounters(value, ids)', 'function publicCounters(value, ids, game)')
    first=counters.index('      let games = ');last=counters.index(';',first)
    counters=counters[:first]+'      let games = game'+counters[last:]
    source=source[:end]+counters+source[end:]
    return source
if __name__=='__main__':print(compose(),end='')
