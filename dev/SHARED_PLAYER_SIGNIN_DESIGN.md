# Shared-device player sign-in: proposed DEV behavior

Status: implemented local DEV candidate, not published or an access grant.

## Implemented candidate (October 26)

Home exposes Add player account after the owner is verified. The additional
player signs in through a separate Firebase app using initializeAuth with
inMemoryPersistence. The adapter reloads the user and checks verified, non-anonymous
identity, matching token subject and a five-minute authentication freshness limit.
It signs out and deletes that temporary app before the UI offers confirmation.
Confirmation retains only UID and the player's chosen display label in memory;
its deadline comes from auth_time, not from the time the dialog was rendered.

The list is labeled verified this visit, not continuously signed in. Duplicate
UIDs replace the same entry, while duplicate display names retain distinct IDs.
Remove, owner replacement/revoked verification, game selection changes and page
exit clear the applicable entries. Canceled late completions cannot repopulate
the list. The list does not automatically modify game rosters or private history.
Recorded-game profile links continue through the existing authorized directory
and validation path; users identify the desired account by its UID.

No real Firebase authentication or backend permission test has been performed for
this candidate. SDK/DOM tests and a real Chrome fixture use synthetic identities.
The fixture has connect-src 'none' and never calls Firebase.

The home account candidate supplies a small Login/My account link and an explicit
Keep me signed in choice. The existing verified-profile picker links players to
scorekeeper-declared results; it does not prove that each player authenticated or
consented. Do not label those selections as signed-in players.

## Proposed additional-player flow

Keep the scorekeeper's named Firebase app and persistence choice untouched.
Each additional player chooses Add player account and authenticates themselves
through a separate, temporary Firebase auth instance in the existing DEV project.
Use in-memory persistence for this temporary instance. Never ask the scorekeeper
to supply someone else's password, infer identity from a matching name/email, or
link providers automatically. Existing enabled methods only; no provider changes.

After Firebase authentication, require a non-anonymous, email-verified account and
an explicit confirmation of the displayed player identity and game participation.
Use UID as identity, not name/email. Show duplicate names with distinct profile
identifiers. Reject a stale completion after cancel, account replacement, game
replacement or navigation. The guest path always remains available.

A local participation chip must say it is local to this game/session. It must not
imply permission to read another player's history or write on their behalf.
Remove temporary auth state on cancel, failure, completion and page exit. Do not
persist passwords, tokens or a reusable authenticated-player list in game saves.
On reload, retained player labels are not fresh authentication evidence.

## Boundary requiring further implementation

Local verified participation can be implemented without changing Firebase rules.
It cannot by itself authorize multi-player private-history writes. Before wiring
those writes, inspect the existing server/rules contract for player consent and
receipts. If it lacks the needed bounded authorization, propose the exact backend
change separately. Do not broaden existing access to make the UI appear complete.

The approved one-hour QR experiment is not standing authority for enrolling
additional ordinary players. Its credentials and synthetic records must not be
reused for this feature.

## Required regression coverage before release

- Owner remains signed in with unchanged UID and persistence across each flow.
- Guest, unverified and anonymous accounts never become verified participants.
- Explicit player confirmation is required; cancel performs no roster mutation.
- Same UID is deduplicated; different UIDs with identical names stay distinct.
- Repeated clicks produce one flow; late auth results after cancel are discarded.
- Failure during verification/profile lookup clears temporary auth in finally.
- Sign-out, navigation and reload invalidate session-only participation proofs.
- Existing game, guest roster and private history are unchanged on failure.
- Auth tokens never enter URLs, localStorage, console output, receipts or exports.
- Backend denies unauthorized history actions even when a client chip is forged.

Executed coverage includes home guest/unverified/verified states and offline
fallback, 25 account UI ownership groups, persistence adapter tests, profile
directory authorization/race checks and shared-player SDK/DOM lifecycle tests.
Eleven shared-player groups include simulated cross-tab sign-out, Back-cache
return and fresh-page restart. Account/home pages clear their presentation on
pagehide and reread the SDK's current account on pageshow; this does not sign the
owner out or remove game storage. A regression test failed before adding these
handlers and passes afterward.

The rendered synthetic Chrome flow covers verification, explicit consent, Escape
cancel and owner sign-out cleanup. Real Firebase restart/cross-tab/Back behavior,
fresh sign-in with actual additional players, and server-enforced multi-player
history consent remain unverified. The latter is outside this no-new-grants UI
candidate. No live game history or account permissions were altered.
