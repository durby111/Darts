# Deployment and release boundaries

GitHub Pages publishes the `main` branch to [BlakeOut](https://blakeoutdarts.com/),
with DEV under `/dev/`. [CNAME](../CNAME) declares the custom domain. The Pages
workflow builds and uploads the static site; no application bundler is required.
The workflow is GitHub's Pages build/deployment workflow, not a checked-in custom
application workflow. A main push rebuilds the entire site, even for DEV-only or
documentation-only changes. Do not promise an exact propagation time.

## Before publishing

1. Obtain explicit authorization for the publication scope. Earlier approval for
   a particular feature or release does not authorize unrelated releases,
   backend changes or opening account/bracket gates. Without publication approval,
   keep a local branch/commit and identify the proposed remote action.
2. Verify the current remote SHA and preserve unrelated work. Review the exact
   changed-file list. Production and DEV are separate trees, not branches that
   can be promoted wholesale. Copy only reviewed shared changes; retain DEV-only
   local routes, providers and transports in DEV.
3. Check [feature readiness](../dev/FEATURE_READINESS.md). Production Accounts
   and Brackets must retain Coming Soon notices and false availability flags
   unless reopening them was separately authorized. Sample DEV navigation and
   device-local brackets do not authorize cloud rollout.
4. Run [applicable tests](TESTING.md), review browser evidence and record any
   limitations. Preserve the tested candidate before publication.
5. For changed runtime assets, review and bump the relevant `sw.js` cache name;
   preserve root/DEV cache isolation and existing save keys. Do not clear user
   storage as an upgrade strategy. Documentation-only changes do not need a
   runtime cache bump.

The placement baseline uses `blakeout-v57-minnesota-places` and
`blakeout-dev-v67-minnesota-places`. Read the actual worker files for later values.
Ordinary production, ordinary DEV and DEV-local tournaments have distinct active
save keys. Placement archives use the matching active key plus `_places_` and a
stable ID. Presets and roster data may have older shared keys; do not assume all
localStorage is build-isolated or delete it wholesale.

## Publication evidence

After an authorized push, verify the exact remote commit and locate the Pages
run for that SHA. Wait for both build and deploy success, not just push success.
Record the commit and run URL. Inspect served content and an existing cached
client when accessible, including Coming Soon gates and the intended feature.
If the environment proxy blocks live retrieval, report the block separately from
local rendered checks and Pages status. Do not describe physical touch or live
content as verified solely from CI or localhost.

A draft PR is a publication action too; create/push it only within authorized
scope. This guide grants no approval to push, merge or deploy.

## Backend is a separate release

`firebase.json` points to the canonical `firestore.rules`; a Pages deployment does
not deploy Firebase rules, change Auth providers or provision a separate project.
Production and DEV configs currently reference the shared Firebase project.
Named Firebase client apps and DEV collection prefixes are not backend isolation.
Never relax rules, remove API-key website restrictions, change IAM, enable billing,
provision infrastructure or send real email as an incidental frontend release step.

See [separate DEV backend proposal](../dev/SEPARATE_BACKEND_SETUP.md),
[account rollout review](../dev/REAL_ACCOUNT_ROLLOUT.md),
[provider preparation](../dev/ACCOUNT_PROVIDERS.md), and
[email-worker operations](../dev/email-worker/README.md). Those documents preserve
specific proposed scopes and dated evidence; they are not standing authorization.
