# BotBlake (DEV only)

BotBlake is a local computer opponent for all registered X01 distances, Cricket,
Spanish Cricket (with or without Bull), and Cutthroat. Specialized modes including
Minnesota, Chicago, Quickie, and the separate Official Team Cricket engine are
not supported yet; setup rejects bots for those modes with an explanation.
Human-only modes remain available. Bot matches never enter account/tournament
recording or change production assets.

Choose Human, BotBlake Auto, Easy, Medium, Hard, or Expert independently at each
individual player position. In Team mode, choose a skill and **Add BotBlake**, then
assign the chip like a human. Each assigned bot has an editable skill selector.
Distinct IDs and numbered names distinguish instances. Teams of two, three, and
four use the existing alternating-team/per-member rotation, with any mixture of
humans and bots (at least one human in the match). No doubles-only restriction is
introduced. Team setups are saved under a DEV-specific key; legacy human setups
can still be read without changing the production key.

Auto moves a human to the front of each team that has one, and starts with a
human-led team. In individual games it moves the first human ahead of bots.
Auto uses all humans' observed points per turn in X01 (busts count as zero), or
marks per turn in Cricket. In teams, per-member human statistics are recorded
inside the existing undo transaction. Bots never train on other bots. Each bot
keeps its own skill selection; Auto bots intentionally share the same pooled
human comparison rather than comparing against a team's combined human/bot score.
At least one human turn precedes Auto's first throw. The estimate is cumulative,
not a copy of the last turn, and is bounded to avoid certain hits or endless zero
play. Checkout attempts and Bull naturally differ from open scoring averages.

The pure engine simulates three legal board segments, including singles,
triples/doubles, adjacent-wedge misses and misses off the board. X01 searches legal
checkout routes and enforces double-in, double-out, leaving one, and bust rollback.
Cricket chooses closures or scores on an open opponent target when behind; the
existing scorer applies points, Cutthroat penalties and wins. A bot stops at the
winning dart. The bot's X01 rules do not change human total-score entry's existing
trust-based rules.

Bot turns commit atomically after a short visible delay. Menu, setup, hidden tabs,
restart, and state changes invalidate pending work. Manual scoring is blocked
while a bot owns the turn; undo and menus remain available. Undo/redo and resumed
bot turns pause with **Continue BotBlake**, allowing corrections without an
immediate replay. Skill choices, individual identities, team rotations, human
samples and undo/redo survive active-game reload. Play Again resets samples.

## Validation

Run from repository root:

```
node dev/tests/botblake_test.mjs
python3 dev/tests/botblake_ui_test.py
python3 dev/tests/botblake_edges_test.py
python3 dev/tests/botblake_team_mix_test.py
node --experimental-vm-modules dev/tests/production_release_test.mjs
```

Seeded 10,000-turn simulations per skill produce X01 open-scoring averages near
38/65/91/119 and Cricket marks per turn near 1.7/3.1/4.5/5.9. These describe the
simulation, not promised full-match averages. Tests cover ordering, variation,
legal finishes, double-in, Auto response, and team-only human samples. Local
Chromium tests block all external requests and cover setup, actual turns, two,
three and four member rotations, mixed teams, independent settings, reload,
undo, navigation and restart. Traces, screenshots and logs are retained in
`/workspace/scratch/botblake-20261029/` for this execution.

No publication, production deploy, real backend test, or physical-device/Safari
acceptance is claimed. The prior source appearance suite has an unrelated
semantic-outline assertion failure, reproduced on baseline e2a5a48.

Broad regression evidence: 56/57 rendered checks passed on the first run; the
remaining QR check lacked zxing-cpp. After installing the pinned dependency in
an isolated virtual environment, that check passed (57/57 combined). Source/DOM
suites: 34/35 passed, with only the baseline appearance assertion failing. The
production artifact test now pins released scorer files rather than requiring
DEV/production equality for modules that deliberately gained BotBlake.
