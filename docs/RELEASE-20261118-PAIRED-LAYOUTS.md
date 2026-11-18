# Paired optional scoreboard layouts, November 18, 2026

Mike requested Fable and Astra 6.2 in the same production release. Both are added to the existing Customize scoreboard choices in production and DEV. Modern remains the default; existing saved style selections remain unchanged.

- **Fable:** recovered green-baize/brass/ivory presentation, scoped to the game screen and in-game dialog palette. Original unrelated fixes excluded.
- **Astra 6.2 · Flight Deck:** an independent X01 presentation with fixed score lanes and a quick-score bank, layered on existing controls.
- No scoring-engine, tournament, roster, Firebase, authorization or save-format changes. Existing `blakeout_x01_skin` stores the opt-in preference.
- Both CSS files are included in each build's precache; root and DEV cache scopes stay separate.

Validation: Fable static suites (root and DEV), six-choice persistence/default contract, production module/cache/security preservation audit and candidate browser evidence. Actual checks and any limits are included in the release handback. Physical touch, installed-PWA upgrades and exhaustive device combinations are not implied by desktop/browser fixtures.

Known unrelated privacy/offline findings remain separate work; this style release does not assert they are fixed or expand their scope.

## Candidate portrait browser checks
Both actual integrated app styles passed at 390×844: select style in Customize, start 501, commit quick 60 (441), Undo (501). Fable also passed keypad 6+0, ENTER and Undo. Fable ENTER bottom was 838 within 844; Astra bottom action 831 with no horizontal overflow. These are browser-viewport results, not physical-device acceptance. Paired root/DEV registration/cache contract and production preservation audit passed.
