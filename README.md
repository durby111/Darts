# BlakeOut Darts

BlakeOut is an offline-capable darts scoring PWA built with vanilla JavaScript,
ES modules and static HTML/CSS. There is no application bundler or build step.
GitHub Pages serves the repository's `main` branch.

## Start here

- [Feature status](dev/FEATURE_READINESS.md): current production, DEV and gated features.
- [Testing](docs/TESTING.md): dependencies, commands, evidence and limitations.
- [Deployment](docs/DEPLOYMENT.md): scope, cache updates and release verification.
- [Architecture and contributor context](CLAUDE.md): game model, input handling,
  storage and historical infrastructure decisions.
- [Current backlog](dev/BACKLOG.md) and [dated development notes](dev/DEV_NOTES.md).
- [Security audit](SECURITY_AUDIT.md), [real-account review](dev/REAL_ACCOUNT_ROLLOUT.md)
  and [proposed separate DEV backend](dev/SEPARATE_BACKEND_SETUP.md).

## Run locally

From the repository root, serve the whole tree over HTTP:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/` for production source or
`http://127.0.0.1:8000/dev/` for DEV. Do not open HTML with `file://`; modules and
service workers require a suitable origin. Localhost supports service workers;
installed offline use requires a successful initial asset load.

No Firebase credential or backend deployment is needed to run the scorer.
Ordinary scorer pages can attempt existing Firebase initialization; local
scoring remains usable if it fails. For backend-free feature exploration use
the explicitly labeled sample or device-local routes below. Automated browser
fixtures block/mock external requests; serving the ordinary app is not itself a
network sandbox. Do not change backend configuration to make a local test pass.

## Routes and data

| Route | Purpose | Persistence |
| --- | --- | --- |
| `/` | [Production scorer](https://blakeoutdarts.com/) | Production active-game save and presets; offline asset cache |
| `/dev/` | [DEV scorer](https://blakeoutdarts.com/dev/) | Separate DEV active-game save/cache |
| `/accounts/`, `/brackets/` | Production Coming Soon pages | Real feature gates remain closed |
| `/dev/accounts/`, `/dev/brackets/` | Redirect to labeled sample previews | Sample edits are in memory; reset on reload |
| `/dev/preview/` | [Sample navigation](dev/preview/README.md) | No real authentication, mail or cloud writes |
| `/dev/local/brackets/` | [Device-local DEV tournaments](dev/LOCAL_TOURNAMENTS.md) | Same-device localStorage; no cloud sync |

Minnesota includes optional **Cutthroat** scoring. After first place in a
three- or four-side Minnesota game, **Play for places** continues for second and
third in either scoring mode. First place stays fixed after opting in;
placement undo/reload and separate device-local records are supported. The
current two-team setup does not offer placement continuation. See
[Minnesota Cutthroat](dev/MINNESOTA_CUTTHROAT.md) and
[Play for places](dev/MINNESOTA_PLACES.md) for rules and test details.

## Repository map

- Root `index.html`, `js/`, `css/`, `sw.js`: production application.
- `dev/`: DEV application, sample previews, local tournaments, feature notes and tests.
- `dev/tests/`: source/DOM suites and rendered browser regressions.
- `scripts/headless_test.py`: older production smoke harness; see testing guidance.
- `firestore.rules`, `firebase.json`: canonical rules source and CLI mapping.
- `dev/email-worker/`: separate email service source and operational documentation.

Do not copy the whole DEV tree over production: DEV-only routes, providers,
transports and settings have separate release boundaries. Preserve existing
storage keys/data and Coming Soon gates. A push to `main` rebuilds the whole
Pages site, including documentation-only changes; publication requires explicit
scope authorization. This documentation is not deployment approval.
