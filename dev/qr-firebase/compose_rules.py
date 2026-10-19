"""Print a review-only merged candidate. Never deploy; no saved role activation."""
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
def compose():
    base=(ROOT/'dev/backend-setup/firestore.isolated-candidate.rules').read_text()
    # Firebase allow expressions are additive: explicitly exclude board roles
    # from ALL existing account grants, even if a UID is in both role lists.
    base=base.replace("return database == '(default)' && request.auth != null", "return database == '(default)' && request.auth != null && !qrBoard()")
    marker='    match /{document=**} {'
    assert base.count(marker)==1
    return base.replace(marker,(Path(__file__).with_name('pairing.rules.fragment').read_text())+'\n'+marker)
if __name__=='__main__':print(compose())
