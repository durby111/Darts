// Scorecard reader — pure league-result draft model. DEV only.
//
// Rules this module enforces:
//  * Nothing is ever invented. A value exists only because text was detected on
//    the photo (kept exactly as detected) or because a person typed it.
//  * Every detected value starts unconfirmed and is visibly flagged until a
//    person confirms or edits it. Doubtful readings are flagged more strongly.
//  * A missing value stays blank. A person must either enter it or explicitly
//    record that the card leaves it blank.
//  * A draft cannot be marked reviewed, or exported, while any flag is open.
// No network, storage, account or tracker access happens here.

export const DRAFT_VERSION = 1;
export const STATUS = Object.freeze({
    EMPTY: 'empty',           // nothing detected or entered — needs a person
    EXTRACTED: 'extracted',   // detected from the photo, not yet checked
    UNCERTAIN: 'uncertain',   // detected, with a specific reason for doubt
    ENTERED: 'entered',       // typed by a person
    CONFIRMED: 'confirmed',   // detected value checked by a person
    BLANK: 'blank',           // a person confirmed the card leaves this blank
});
const OPEN = new Set([STATUS.EMPTY, STATUS.EXTRACTED, STATUS.UNCERTAIN]);

export const HEADER_FIELDS = Object.freeze([
    ['date', 'Match date'], ['homeTeam', 'Home team'], ['awayTeam', 'Away team'],
    ['homeTotal', 'Home total'], ['awayTotal', 'Away total'],
]);
export const GAME_FIELDS = Object.freeze([
    ['game', 'Game'], ['homePlayers', 'Home player(s)'], ['awayPlayers', 'Away player(s)'],
    ['homeScore', 'Home score'], ['awayScore', 'Away score'], ['winner', 'Winner'],
]);
export const WINNER_VALUES = Object.freeze(['home', 'away']);
const NUMERIC = new Set(['homeTotal', 'awayTotal', 'homeScore', 'awayScore']);
const KNOWN_GAMES = /^(?:[3579]01|1[15]01|cricket|chicago|minnesota|spanish(?: cricket)?|doubles? (?:cricket|[3579]01)|singles? (?:cricket|[3579]01))$/i;

const emptyField = () => ({ value: '', status: STATUS.EMPTY, reason: 'Not found — enter it or mark it blank on the card.' });
const clean = text => String(text ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();

function detectedField(key, text, lowConfidence) {
    const value = clean(text);
    if (!value) return emptyField();
    const reasons = [];
    if (lowConfidence) reasons.push('The text detector reported low confidence.');
    if (/[?�]/u.test(value)) reasons.push('Contains an unreadable character.');
    if (NUMERIC.has(key) && !/^\d{1,4}$/.test(value)) reasons.push('Expected a whole number; the detected text is kept exactly as read.');
    if (key === 'winner' && !WINNER_VALUES.includes(value)) reasons.push('Winner must be Home or Away.');
    if (key === 'date' && !/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$/.test(value)) reasons.push('Does not look like a numeric date.');
    if (key === 'game' && !KNOWN_GAMES.test(value)) reasons.push('Not a recognised game name.');
    if ((key === 'homePlayers' || key === 'awayPlayers' || key === 'homeTeam' || key === 'awayTeam') && /\d/.test(value)) reasons.push('Name contains a digit; letters and digits are easily confused.');
    return reasons.length ? { value, status: STATUS.UNCERTAIN, reason: reasons.join(' ') }
        : { value, status: STATUS.EXTRACTED, reason: 'Detected from the photo — check it against the card.' };
}

let gameCounter = 0;
const newGameId = () => `g${Date.now().toString(36)}${(gameCounter++).toString(36)}`;

export function emptyGame(number) {
    return { id: newGameId(), number, fields: Object.fromEntries(GAME_FIELDS.map(([key]) => [key, emptyField()])) };
}

export function createDraft({ source = 'manual', extraction = 'none' } = {}) {
    return {
        version: DRAFT_VERSION, source, extraction,
        fields: Object.fromEntries(HEADER_FIELDS.map(([key]) => [key, emptyField()])),
        games: [], unparsed: [], reviewed: false, reviewedAt: null,
    };
}

const WINNER_WORDS = { h: 'home', home: 'home', a: 'away', away: 'away', v: 'away', visitor: 'away', visitors: 'away' };
const ROW = /^(\d{1,2})\s*[.):-]?\s+(.+?)\s*[:|]\s*(.+?)\s+(?:vs?\.?|versus)\s+(.+?)(?:\s*[|,;]\s*(\S+)\s*[-–—:]\s*(\S+))?(?:\s*[|,;]\s*(?:w(?:in(?:ner)?)?\s*[:=]?\s*)?([a-z]+))?$/iu;

// Text lines → draft. `lines` is [{ text, confidence? }] or plain strings, in
// reading order, exactly as a detector (or a synthetic fixture) produced them.
// Recognised layout (one item per line):
//   Date: 11/12/2026          Home: Bullseye Bandits       Away: Triple Trouble
//   1. 501: Ada & Ben vs Cy & Dee | 1-0 | W: Home
//   Totals: 3-2
// Anything else is kept verbatim in `unparsed` for the reviewer — never dropped,
// never guessed into a field.
export function draftFromTextLines(lines, { extraction = 'synthetic-fixture', confidenceFloor = 0.8 } = {}) {
    const draft = createDraft({ source: 'photo', extraction });
    const seen = new Set();
    for (const entry of lines || []) {
        const text = clean(typeof entry === 'string' ? entry : entry?.text);
        if (!text) continue;
        const confidence = typeof entry === 'object' && Number.isFinite(entry?.confidence) ? entry.confidence : null;
        const low = confidence !== null && confidence < confidenceFloor;
        const set = (key, value) => {
            // A second, conflicting reading is doubt, not a tie to be broken.
            if (seen.has(key)) {
                const field = draft.fields[key];
                if (field.value !== clean(value)) Object.assign(field, { status: STATUS.UNCERTAIN, reason: `Read more than once with different text (also “${clean(value)}”).` });
                return;
            }
            seen.add(key);
            draft.fields[key] = detectedField(key, value, low);
        };
        let match;
        if ((match = text.match(/^date\s*[:=-]\s*(.+)$/iu))) { set('date', match[1]); continue; }
        if ((match = text.match(/^home(?:\s+team)?\s*[:=-]\s*(.+)$/iu))) { set('homeTeam', match[1]); continue; }
        if ((match = text.match(/^(?:away|visitors?|visiting)(?:\s+team)?\s*[:=-]\s*(.+)$/iu))) { set('awayTeam', match[1]); continue; }
        if ((match = text.match(/^(?:totals?|final(?:\s+score)?)\s*[:=-]?\s*(\S+)\s*[-–—:]\s*(\S+)$/iu))) { set('homeTotal', match[1]); set('awayTotal', match[2]); continue; }
        if ((match = text.match(ROW))) {
            const [, number, game, home, away, homeScore, awayScore, winnerWord] = match;
            const row = emptyGame(Number(number));
            const put = (key, value) => { if (value !== undefined) row.fields[key] = detectedField(key, value, low); };
            put('game', game); put('homePlayers', home); put('awayPlayers', away);
            put('homeScore', homeScore); put('awayScore', awayScore);
            // The winner is recorded only when the card states it. It is never
            // inferred from the scores.
            if (winnerWord !== undefined) {
                const winner = WINNER_WORDS[winnerWord.toLowerCase()];
                row.fields.winner = winner ? detectedField('winner', winner, low)
                    : { value: '', status: STATUS.EMPTY, reason: `Winner text “${winnerWord}” was not understood — choose Home or Away from the card.` };
            }
            if (draft.games.some(existing => existing.number === row.number)) {
                for (const field of Object.values(row.fields)) if (field.status === STATUS.EXTRACTED) Object.assign(field, { status: STATUS.UNCERTAIN, reason: `Game number ${row.number} was read more than once.` });
            }
            draft.games.push(row);
            continue;
        }
        draft.unparsed.push(text);
    }
    return draft;
}

function locate(draft, path) {
    if (path.game) {
        const game = draft.games.find(item => item.id === path.game);
        if (!game || !game.fields[path.key]) throw Error('Unknown scorecard field.');
        return game.fields;
    }
    if (!draft.fields[path.key]) throw Error('Unknown scorecard field.');
    return draft.fields;
}

function validateEntered(key, value) {
    if (NUMERIC.has(key) && !/^\d{1,4}$/.test(value)) throw Error('Enter a whole number.');
    if (key === 'winner' && !WINNER_VALUES.includes(value)) throw Error('Choose Home or Away.');
    if (value.length > 80) throw Error('Keep entries to 80 characters or fewer.');
}

const unreview = draft => ({ ...draft, reviewed: false, reviewedAt: null });
const withField = (draft, path, field) => {
    const next = structuredClone(unreview(draft));
    locate(next, path)[path.key] = field;
    return next;
};

// Any edit re-opens the review: a reviewed draft never changes silently.
export function setField(draft, path, rawValue) {
    const value = clean(rawValue);
    if (!value) return withField(draft, path, emptyField());
    validateEntered(path.key, value);
    return withField(draft, path, { value, status: STATUS.ENTERED, reason: '' });
}

export function confirmField(draft, path) {
    const field = locate(draft, path)[path.key];
    if (!field.value) throw Error('There is nothing to confirm. Enter a value or mark the field blank on the card.');
    validateEntered(path.key, field.value);
    return withField(draft, path, { value: field.value, status: STATUS.CONFIRMED, reason: '' });
}

export function markBlank(draft, path) {
    return withField(draft, path, { value: '', status: STATUS.BLANK, reason: 'Confirmed blank on the card.' });
}

export function addGame(draft) {
    const next = structuredClone(unreview(draft));
    next.games.push(emptyGame(Math.max(0, ...next.games.map(game => game.number || 0)) + 1));
    return next;
}

export function removeGame(draft, id) {
    const next = structuredClone(unreview(draft));
    next.games = next.games.filter(game => game.id !== id);
    return next;
}

export function dismissUnparsed(draft, index) {
    const next = structuredClone(unreview(draft));
    next.unparsed.splice(index, 1);
    return next;
}

export function openFlags(draft) {
    const flags = [];
    for (const [key, label] of HEADER_FIELDS) {
        const field = draft.fields[key];
        if (OPEN.has(field.status)) flags.push({ path: { key }, label, status: field.status, reason: field.reason });
    }
    for (const game of draft.games) for (const [key, label] of GAME_FIELDS) {
        const field = game.fields[key];
        if (OPEN.has(field.status)) flags.push({ path: { game: game.id, key }, label: `Game ${game.number}: ${label}`, status: field.status, reason: field.reason });
    }
    draft.unparsed.forEach((text, index) => flags.push({ path: { unparsed: index }, label: 'Unplaced text from the photo', status: 'unparsed', reason: `“${text}” — copy it into a field if it belongs, then dismiss it.` }));
    if (!draft.games.length) flags.push({ path: { games: true }, label: 'Games', status: STATUS.EMPTY, reason: 'No games are in the draft. Add each game from the card.' });
    return flags;
}

// Cross-checks are warnings for the reviewer. They never change a value.
export function consistencyWarnings(draft) {
    const warnings = [];
    const number = field => (/^\d+$/.test(field.value) ? Number(field.value) : null);
    const wins = side => draft.games.filter(game => game.fields.winner.value === side).length;
    const decided = draft.games.length && draft.games.every(game => WINNER_VALUES.includes(game.fields.winner.value));
    for (const [side, key] of [['home', 'homeTotal'], ['away', 'awayTotal']]) {
        const total = number(draft.fields[key]);
        if (decided && total !== null && total !== wins(side)) warnings.push(`The ${side} total is ${total}, but ${wins(side)} game${wins(side) === 1 ? ' is' : 's are'} marked as ${side} wins. Check the card; nothing was changed.`);
    }
    for (const game of draft.games) {
        const home = number(game.fields.homeScore), away = number(game.fields.awayScore), winner = game.fields.winner.value;
        if (home !== null && away !== null && winner && home !== away && (home > away ? 'home' : 'away') !== winner) warnings.push(`Game ${game.number}: the winner is ${winner}, but the scores read ${home}–${away}. Check the card; nothing was changed.`);
    }
    const numbers = draft.games.map(game => game.number);
    if (new Set(numbers).size !== numbers.length) warnings.push('Two games share a game number.');
    return warnings;
}

export function markReviewed(draft, { attested = false, now = Date.now() } = {}) {
    const flags = openFlags(draft);
    if (flags.length) throw Error(`${flags.length} item${flags.length === 1 ? '' : 's'} still need review.`);
    if (attested !== true) throw Error('Confirm that you compared every field with the scorecard.');
    return { ...structuredClone(draft), reviewed: true, reviewedAt: new Date(now).toISOString() };
}

// A plain local document for a person to carry to their league tracker by
// hand. Only produced after review; blank-on-card fields export as null.
export function exportDraft(draft) {
    if (!draft.reviewed || openFlags(draft).length) throw Error('Finish the manual review before exporting.');
    const out = field => (field.status === STATUS.BLANK ? null : NUMERIC_VALUE(field));
    return {
        format: 'blakeout-dev-league-result-draft', version: DRAFT_VERSION,
        notice: 'Manually reviewed draft. Not submitted to any league tracker.',
        reviewedAt: draft.reviewedAt, source: draft.source, extraction: draft.extraction,
        ...Object.fromEntries(HEADER_FIELDS.map(([key]) => [key, out({ ...draft.fields[key], key })])),
        games: draft.games.map(game => ({ number: game.number, ...Object.fromEntries(GAME_FIELDS.map(([key]) => [key, out({ ...game.fields[key], key })])) })),
        warnings: consistencyWarnings(draft),
    };
}
function NUMERIC_VALUE(field) { return NUMERIC.has(field.key) ? Number(field.value) : field.value; }

export function isDraft(value) {
    return !!value && value.version === DRAFT_VERSION && value.fields && Array.isArray(value.games) && Array.isArray(value.unparsed)
        && HEADER_FIELDS.every(([key]) => value.fields[key] && typeof value.fields[key].value === 'string')
        && value.games.every(game => game && typeof game.id === 'string' && GAME_FIELDS.every(([key]) => game.fields?.[key] && typeof game.fields[key].value === 'string'));
}
