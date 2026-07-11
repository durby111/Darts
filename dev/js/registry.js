/* ============================================
   Game Registry — single source of truth for
   every playable game mode.

   Adding a new game:
   1. Add an entry here (id, label, icon, engine, category, tags).
   2. Add an <option> to the hidden #gameType select in index.html
      (kept for state/config compatibility) — or rely on
      syncSelectWithRegistry() which injects missing options.
   3. If the game needs its own options panel, give it an
      `optionsPanelId` pointing at a .form-group in index.html.
   4. Implement the engine hooks:
      - engine 'cricket' → targets come from state.js:initCricket()
      - engine 'x01'     → handled by x01.js (numeric start score)
            - engine 'score'   → turn-total entry through x01.js (Count Up,
                                                     future Gotcha-style games)
            - engine 'tictactoe' → dedicated 3×3 mark-and-claim board
      - engine 'target'  → implement currentTarget / describeHitButtons /
                           pointsForHit / commitTurn and wire it into
                           target_game.js's dispatcher
      - engine 'special' → own module + own lifecycle (chicago, 121)

   The picker (picker.js), the setup dispatcher (setup.js) and the
   display router (app.js) are all driven from this table — no other
   file should hard-code game-type lists.
   ============================================ */

export const CATEGORIES = [
    { id: 'all',      label: 'All' },
    { id: 'fav',      label: '★ Favorites' },
    { id: 'x01',      label: 'X01' },
    { id: 'cricket',  label: 'Cricket' },
    { id: 'numbers',  label: 'Around the Board' },
    { id: 'party',    label: 'Party / Combo' }
];

export const GAME_REGISTRY = [
    {
        id: '301', label: '301', sub: 'Double out', icon: '🎯',
        engine: 'x01', category: 'x01',
        tags: ['x01', 'countdown', 'classic', 'quick'],
        desc: 'Count down from 301. Finish on a double.',
        rules: 'Start at 301. Each turn, subtract what you threw. Reach exactly 0 to win — your last dart must match the out rule (default: a double). Go below 0 and the turn is a bust.'
    },
    {
        id: '501', label: '501', sub: 'Standard', icon: '🎯',
        engine: 'x01', category: 'x01',
        tags: ['x01', 'countdown', 'classic', 'standard', 'league'],
        desc: 'The standard competitive game. Count down from 501.',
        rules: 'Start at 501. Each turn, subtract what you threw. Reach exactly 0 to win — your last dart must match the out rule (default: a double). Go below 0 and the turn is a bust.'
    },
    {
        id: '701', label: '701', sub: 'Long form', icon: '🎯',
        engine: 'x01', category: 'x01',
        tags: ['x01', 'countdown', 'long'],
        desc: 'Longer format X01 — count down from 701.',
        rules: 'Start at 701. Same rules as 501: subtract each turn, reach exactly 0, finish per the out rule. More points = longer game.'
    },
    {
        id: '801', label: '801', sub: 'Endurance', icon: '🎯',
        engine: 'x01', category: 'x01',
        tags: ['x01', 'countdown', 'endurance', 'teams'],
        desc: 'Endurance X01 — count down from 801.',
        rules: 'Start at 801. Same rules as 501: subtract each turn, reach exactly 0, finish per the out rule. Great for teams.'
    },
    {
        id: '901', label: '901', sub: 'Marathon', icon: '🎯',
        engine: 'x01', category: 'x01', isNew: true,
        tags: ['x01', 'countdown', 'marathon', 'teams', 'new'],
        desc: 'Marathon X01 — count down from 901.',
        rules: 'Start at 901. Same rules as 501: subtract each turn, reach exactly 0, and finish per the selected out rule. Built for long matches and teams.'
    },
    {
        id: '1101', label: '1101', sub: 'Team marathon', icon: '🎯',
        engine: 'x01', category: 'x01', isNew: true,
        tags: ['x01', 'countdown', 'marathon', 'teams', '1101', 'new'],
        desc: 'Extra-long X01 — count down from 1101.',
        rules: 'Start at 1101. Subtract each turn and reach exactly 0 under the selected out rule. A long-format game especially suited to rotating teams.'
    },
    {
        id: '1501', label: '1501', sub: 'Ultra marathon', icon: '🎯',
        engine: 'x01', category: 'x01', isNew: true,
        tags: ['x01', 'countdown', 'ultra', 'marathon', 'teams', '1501', 'new'],
        desc: 'The longest X01 format — count down from 1501.',
        rules: 'Start at 1501. Standard X01 rules apply: subtract each turn, avoid going below 0, and reach exactly 0 under the selected out rule.'
    },
    {
        id: 'cricket', label: 'Cricket', sub: '15–20 + Bull', icon: '✕',
        engine: 'cricket', category: 'cricket',
        tags: ['cricket', 'marks', 'classic', 'standard', 'bar'],
        desc: 'Close 15–20 and Bull with three marks each. Points on open numbers.',
        rules: 'Mark 15–20 and Bull: single = 1 mark, double = 2, triple = 3. Three marks closes a number. Hitting your closed number scores points while any opponent still has it open. Close everything with equal or more points to win.'
    },
    {
        id: 'spanish', label: 'Spanish', sub: '20→10', icon: '✕',
        engine: 'cricket', category: 'cricket',
        tags: ['cricket', 'marks', 'spanish', 'long'],
        desc: 'Cricket on 20 down to 10 — optional Bull.',
        rules: 'Standard cricket marks and points, but on the numbers 20 down to 10 (Bull optional). More numbers to close = longer, more open game.'
    },
    {
        id: 'minnesota', label: 'Minnesota', sub: 'Cricket variant', icon: '✕',
        engine: 'cricket', category: 'cricket',
        tags: ['cricket', 'marks', 'minnesota', 'triples', 'doubles', 'beds'],
        desc: 'Cricket plus Triples, Doubles and Bed rows.',
        rules: 'Standard cricket 15–20 + Bull, plus extra rows: any Triple, any Double, and 3-in-a-bed. Each row needs 3 marks to close; open rows score points like cricket numbers.'
    },
    {
        id: 'chaos', label: 'Chaos Cricket', sub: 'Random targets', icon: '🎲',
        engine: 'cricket', category: 'cricket', isNew: true,
        tags: ['cricket', 'marks', 'random', 'chaos', 'party', 'new'],
        desc: 'Cricket with 6 randomly drawn numbers + Bull. New board every game — no camping on 20s.',
        rules: 'Standard cricket rules — 3 marks to close, points on numbers your opponent has open — but the 6 numbers are drawn at random each game (Bull always plays). Play Again re-rolls the board.'
    },
    {
        id: 'quickie', label: 'Cricket Quickie', sub: '10 rounds', icon: '⚡',
        engine: 'cricket', category: 'cricket', isNew: true,
        tags: ['cricket', 'marks', 'quick', '10 rounds', 'no spread', 'new'],
        desc: 'Full Cricket compressed into a strict 10-round game.',
        rules: 'Play standard Cricket on 15–20 + Bull, but only for 10 rounds and with no point-spread cap. A normal close-and-points win can end it early; at the limit, most board marks wins, then points break the tie.'
    },
    {
        id: 'cutthroat', label: 'Cut-Throat', sub: 'Lowest score wins', icon: '🗡️',
        engine: 'cricket', category: 'cricket', isNew: true,
        tags: ['cricket', 'cut throat', 'cutthroat', 'lowest score', 'opponents', 'new'],
        desc: 'Close the board while loading points onto opponents. Lowest score wins.',
        rules: 'Close 15–20 + Bull normally. Once you close a target, extra hits add points to every opponent who still has it open — not to you. Close the whole board with the lowest or tied-lowest score to win.'
    },
    {
        id: 'wildcard', label: 'Wild Card', sub: 'Targets keep changing', icon: '🃏',
        engine: 'cricket', category: 'cricket', isNew: true,
        tags: ['cricket', 'wild card', 'random', 'changing targets', '7 to 20', 'new'],
        desc: 'Six random targets from 7–20 + Bull. Unmarked targets change every turn.',
        rules: 'Standard Cricket scoring on six random numbers from 7–20 plus Bull. After every turn, each number nobody has marked changes to a new value. As soon as anyone marks a number, that row locks for the rest of the game. Bull is always fixed.'
    },
    {
        id: 'hammer', label: 'Hammer Cricket', sub: 'Don’t miss', icon: '🔨',
        engine: 'target', category: 'cricket', isNew: true,
        minPlayers: 2, maxPlayers: 4,
        tags: ['hammer', 'cricket', 'count up', 'wild rounds', 'penalty', 'new'],
        desc: 'Eight target rounds with escalating dart multipliers. Miss all three and the hammer falls.',
        rules: 'Rounds target 20, 19, 18, Wild, 17, 16, 15, Wild. A hit scores its segment value × dart position (×1, ×2, ×3); the final round uses ×1, ×3, ×5. Miss all three and subtract triple the target. Highest score wins.'
    },
    {
        id: 'teamhammer', label: 'Team Hammer', sub: '2 vs 2', icon: '🔨',
        engine: 'target', category: 'cricket', isNew: true,
        requiresTeamMode: true, teamMembers: 2,
        tags: ['hammer', 'team', '2 vs 2', 'cricket', 'count up', 'new'],
        desc: 'Official Team Hammer: two pairs share scores and penalties.',
        rules: 'Two teams of two play Hammer Cricket. Team members alternate full turns and share one total. Hits use the normal Hammer dart-position multipliers; an all-miss turn subtracts triple the target from that team. Highest team score wins.'
    },
    {
        id: 'chicago', label: 'Chicago', sub: 'Best of 3', icon: '🌆',
        engine: 'special', category: 'party',
        tags: ['combo', 'cricket', 'x01', 'match', 'best of 3'],
        desc: 'Best of 3 legs — Cricket, 301 and 501, loser of the toss picks.',
        rules: 'A match of three legs: Cricket, 301 and 501. The loser of each leg picks the next game. First to win 2 legs takes the match.'
    },
    {
        id: '121', label: '121', sub: 'Limited darts', icon: '⏱',
        engine: 'special', category: 'x01',
        tags: ['x01', 'checkout', 'practice', 'legs', 'solo'],
        desc: 'Check out from 121 in a fixed number of darts. Win legs to raise the bar.',
        rules: 'Check out from 121 (double out) within your dart allotment. Win the leg and your next start goes up; run out of darts and it drops by the penalty. Most legs won takes the match.'
    },
    {
        id: 'baseball', label: 'Baseball', sub: '9 innings', icon: '⚾',
        engine: 'target', category: 'numbers',
        tags: ['innings', 'runs', 'around the board', 'party'],
        desc: '9 innings, 3 darts at each inning number. Most runs wins.',
        rules: '9 innings. Each inning, throw 3 darts at that inning\u2019s number (1–9): single = 1 run, double = 2, triple = 3. Highest run total after 9 innings wins.'
    },
    {
        id: 'bermuda', label: 'Bermuda', sub: 'Triangle', icon: '🔺',
        engine: 'target', category: 'numbers',
        tags: ['halve it', 'targets', 'pressure', 'party'],
        desc: 'Run the target list — miss a stage and your score halves.',
        rules: 'Work through the target list, 3 darts per stage. Hits score face × multiplier. Miss a stage with all three darts and your total is CUT IN HALF. Highest score at the end wins.'
    },
    {
        id: 'golf', label: 'Golf', sub: '18 holes', icon: '⛳',
        engine: 'target', category: 'numbers',
        tags: ['holes', 'strokes', 'around the board', 'stableford'],
        desc: '18 holes, 3 darts per hole. Lowest strokes wins.',
        rules: '18 holes (numbers 1–18), up to 3 darts per hole. Triple = 1 stroke, double = 2, single = 3, miss = 5. Lowest total strokes wins.'
    },
    {
        id: 'shanghai', label: 'Shanghai', sub: 'S+D+T = win', icon: '🏮',
        engine: 'target', category: 'numbers', isNew: true,
        tags: ['shanghai', 'rounds', 'instant win', 'party', 'new'],
        desc: 'Hit the round number. Score face × multiplier — land Single + Double + Triple in one turn for an instant Shanghai win.',
        rules: 'Rounds 1→7 — only the round\u2019s number scores (face × multiplier). Hit a Single + Double + Triple of it in ONE turn for an instant Shanghai win; otherwise highest total after the last round wins.'
    },
    {
        id: 'countup', label: 'Count Up', sub: '8 rounds', icon: '📈',
        engine: 'score', category: 'party', isNew: true,
        tags: ['count up', '8 rounds', 'highest score', 'beginner', 'practice', 'new'],
        desc: 'Score every dart for 8 rounds. Highest total wins.',
        rules: 'Everyone starts at 0 and plays 8 rounds of 3 darts. Enter each turn’s total; every segment scores its normal value. Highest score after all players finish round 8 wins.'
    },
    {
        id: 'gotcha', label: 'Gotcha!', sub: 'Race to 301', icon: '💣',
        engine: 'score', category: 'party', isNew: true,
        minPlayers: 2, maxPlayers: 4,
        tags: ['gotcha', '301', 'count up', 'bomb', 'party', 'new'],
        desc: 'Race from 0 to exactly 301. Match a rival’s score to bomb them back to 0.',
        rules: 'Be first to reach exactly 301. Land on an opponent’s exact score to bomb that player back to 0. If a turn takes you over 301, subtract the amount you exceeded 301 from the score you had before that turn; overshoots do not trigger bombs.'
    },
    {
        id: 'sharktank', label: 'Shark Tank', sub: 'Survival Count-Up', icon: '🦈',
        engine: 'score', category: 'party', isNew: true,
        minPlayers: 2, maxPlayers: 4,
        tags: ['shark tank', 'survival', 'count up', 'bites', 'elimination', 'new'],
        desc: 'Win each Count-Up round or let the shark chew through your six lives.',
        rules: 'Enter each 3-dart total; Bulls score 0. The sole high scorer is safe and everyone else takes a bite. Score half or less than the leader and take 2 bites. If the top score is tied, every surviving player takes 1 bite. Six bites eliminates you; last surfer wins.'
    },
    {
        id: 'tictactoe', label: 'Tic Tac Toe', sub: 'Claim 3 in a row', icon: '❎',
        engine: 'tictactoe', category: 'party', isNew: true,
        minPlayers: 2, maxPlayers: 2,
        tags: ['tic tac toe', 'tic tac darts', 'x and o', 'random numbers', 'party', 'new'],
        desc: 'Claim dartboard squares with four marks and connect three in a row.',
        rules: 'Bull is the center of a 3×3 board; eight random numbers fill the other squares. Single = 1 mark, Double = 2, Triple = 3 (Bull = 1/2). Four marks claims a square. First to claim 3 in a row wins; a full Cats board goes to the player with more squares.'
    }
];

// --- Lookup helpers ---

const BY_ID = new Map(GAME_REGISTRY.map(g => [g.id, g]));

export function getGame(id) {
    return BY_ID.get(id) || null;
}

export function listGames() {
    return GAME_REGISTRY.slice();
}

// --- Engine predicates ---
// These replace the hard-coded ['cricket','spanish','minnesota'] style
// lists that used to be sprinkled across app.js / setup.js.

export function isCricketGame(id) {
    const g = BY_ID.get(id);
    return !!g && g.engine === 'cricket';
}

export function isX01Game(id) {
    const g = BY_ID.get(id);
    return !!g && g.engine === 'x01';
}

export function isScoreGame(id) {
    const g = BY_ID.get(id);
    return !!g && g.engine === 'score';
}

export function isTargetGame(id) {
    const g = BY_ID.get(id);
    return !!g && g.engine === 'target';
}

// Effective display engine for a game id — chicago legs resolve to the
// engine of the leg's game type, so callers pass the *effective* type.
export function engineOf(id) {
    const g = BY_ID.get(id);
    return g ? g.engine : null;
}

// --- Search / filter ---

export function searchGames(query, category, favIds) {
    const q = (query || '').trim().toLowerCase();
    return GAME_REGISTRY.filter(g => {
        if (category && category !== 'all') {
            if (category === 'fav') {
                if (!favIds || !favIds.includes(g.id)) return false;
            } else if (g.category !== category) {
                return false;
            }
        }
        if (!q) return true;
        return g.label.toLowerCase().includes(q)
            || g.sub.toLowerCase().includes(q)
            || (g.desc && g.desc.toLowerCase().includes(q))
            || g.tags.some(t => t.includes(q));
    });
}

// Ensure the hidden #gameType select contains every registry id, so a
// registry entry can never be un-selectable just because index.html
// wasn't updated in lockstep.
export function syncSelectWithRegistry(selectEl) {
    if (!selectEl) return;
    const existing = new Set(Array.from(selectEl.options).map(o => o.value));
    GAME_REGISTRY.forEach(g => {
        if (!existing.has(g.id)) {
            const opt = document.createElement('option');
            opt.value = g.id;
            opt.textContent = g.label;
            selectEl.appendChild(opt);
        }
    });
}
