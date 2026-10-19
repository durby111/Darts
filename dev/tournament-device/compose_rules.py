from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
HERE=Path(__file__).parent
def resolvers():
    return """function tdResolve(s,r) {
  return s == null ? {'ready':true,'team':null} : 'teamId' in s ? {'ready':true,'team':s.teamId}
    : !(s.matchCode in r) ? {'ready':false,'team':null}
    : {'ready':true,'team':s.outcome == 'winner' ? r[s.matchCode].winnerId
      : r[s.matchCode].winnerId == r[s.matchCode].teamA ? r[s.matchCode].teamB : r[s.matchCode].teamA};
}"""
def compose():
    base=(ROOT/'dev/backend-setup/firestore.isolated-candidate.rules').read_text()
    guard="return database == '(default)' && request.auth != null"
    assert base.count(guard)==1
    base=base.replace(guard,guard+' && !qrBoard()')
    marker='    match /{document=**} {'
    assert base.count(marker)==1
    fragments=[(ROOT/'dev/qr-firebase/pairing.rules.fragment').read_text(),(HERE/'resume.rules.fragment').read_text(),resolvers(),(HERE/'device.rules.fragment').read_text()]
    return base.replace(marker,'\n'.join(fragments)+'\n'+marker)
if __name__=='__main__':print(compose())
