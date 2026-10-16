// Strict wire schema for DEV shared ledgers. No free-text or unknown nested keys.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const GAMES = /^(301|501|701|801|901|1101|1501|cricket|spanish|minnesota|chaos|quickie|cutthroat|wildcard|hammer|teamhammer|chicago|121|baseball|bermuda|golf|shanghai|countup|gotcha|sharktank|tictactoe|robinhood|doubledown|teamcricket)$/;
function fail() { throw new Error('Unsupported DEV result ledger: invalid fields, identity, or numeric value.'); }
function shape(value, required, optional = []) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => ![...required, ...optional].includes(key))) fail();
}
function id(value, nullable = false) { if (!(nullable && value === null) && (typeof value !== 'string' || !ID.test(value))) fail(); return value; }
function game(value) { if (typeof value !== 'string' || !GAMES.test(value)) fail(); return value; }
function number(value) { if (!Number.isFinite(value) || value < 0 || value >= 1e12) fail(); return value; }
function list(value, maximum) { if (!Array.isArray(value) || value.length > maximum) fail(); return value; }
function boolean(value) { if (typeof value !== 'boolean') fail(); return value; }
function summary(value) {
    shape(value, ['id', 'gameType', 'winnerId']);
    return { id: id(value.id), gameType: game(value.gameType), winnerId: id(value.winnerId, true) };
}
function pack(value, maximum) {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).length > maximum) fail();
    return text;
}
export function encodeResultLedger(result) {
    const legScores = list(result.legScores, 99).map(summary);
    const output = { legScores: pack(legScores, 50000) };
    if (result.records !== undefined) {
        shape(result.records, ['id', 'legs'], ['winnerIds']);
        const legs = list(result.records.legs, 99).map(leg => {
            shape(leg, ['id', 'gameType', 'winnerId', 'turns'], ['minnesotaCutthroat']);
            const minnesotaCutthroat = boolean(leg.minnesotaCutthroat ?? false);
            if (minnesotaCutthroat && leg.gameType !== 'minnesota') fail();
            const turns = list(leg.turns, 100000).map(turn => {
                shape(turn, ['id', 'registrationId', 'playerId', 'teamId', 'points', 'darts', 'marks', 'bust']);
                if (turn.playerId !== null && !result.participantIds.includes(turn.playerId)) fail();
                if (!Number.isInteger(turn.darts) || turn.darts < 1 || turn.darts > 3) fail();
                return { id: id(turn.id), registrationId: id(turn.registrationId, true), playerId: id(turn.playerId, true),
                    teamId: id(turn.teamId), points: number(turn.points), darts: turn.darts, marks: number(turn.marks), bust: boolean(turn.bust) };
            });
            return { ...summary({ id: leg.id, gameType: leg.gameType, winnerId: leg.winnerId }), minnesotaCutthroat, turns };
        });
        const winnerIds = list(result.records.winnerIds ?? [], 128).map(value => id(value));
        output.records = pack({ id: id(result.records.id), legs, winnerIds }, 700000);
    }
    return output;
}
export function decodeResultLedger(document) {
    if (typeof document.legScores !== 'string' || (document.records !== undefined && typeof document.records !== 'string')) fail();
    const result = { ...document, legScores: JSON.parse(document.legScores),
        ...(document.records === undefined ? {} : { records: JSON.parse(document.records) }) };
    const canonical = encodeResultLedger(result);
    if (canonical.legScores !== document.legScores || canonical.records !== document.records) fail();
    return result;
}
