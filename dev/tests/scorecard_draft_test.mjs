// Scorecard reader draft model: synthetic fixtures only. Nothing invented,
// every detected value flagged, review mandatory before export.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as d from '../js/scorecard/draft.js';
import { blocksToLines, detectorAvailable, detectLines } from '../js/scorecard/extract.js';
import { SAMPLE_LINES } from '../js/scorecard/sample.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/scorecard/synthetic-card.json', import.meta.url), 'utf8'));
assert.equal(fixture.synthetic, true);
let draft = d.draftFromTextLines(fixture.lines);
const f = draft.fields, game = n => draft.games.find(g => g.number === n).fields;

// Clean detections are still unconfirmed.
assert.deepEqual([f.date.value, f.date.status], ['11/12/2026', 'extracted']);
assert.deepEqual([f.homeTeam.value, f.homeTeam.status], ['Bullseye Bandits', 'extracted']);
assert.equal(draft.games.length, 4);
assert.deepEqual(Object.values(game(1)).map(x => [x.value, x.status]), [
    ['501', 'extracted'], ['Ada Quill & Ben Marsh', 'extracted'], ['Cy Okoro & Dee Lund', 'extracted'],
    ['1', 'extracted'], ['0', 'extracted'], ['home', 'extracted']]);
console.log('PASS detected values are kept verbatim and start unconfirmed');

// Doubt is flagged, never auto-corrected.
assert.deepEqual([f.awayTeam.value, f.awayTeam.status], ['Triple Tr0uble', 'uncertain']);
assert.match(f.awayTeam.reason, /low confidence/); assert.match(f.awayTeam.reason, /digit/);
assert.deepEqual([game(3).homeScore.value, game(3).homeScore.status], ['l', 'uncertain'], 'an ambiguous "l" is not silently read as 1');
assert.equal(game(4).awayPlayers.status, 'uncertain'); assert.match(game(4).awayPlayers.reason, /unreadable/);
// Missing values stay blank; a winner is never inferred from scores.
for (const key of ['homeScore', 'awayScore', 'winner']) assert.deepEqual([game(4)[key].value, game(4)[key].status], ['', 'empty']);
const noWinner = d.draftFromTextLines(['1. 501: A vs B | 1-0']);
assert.deepEqual([noWinner.games[0].fields.winner.value, noWinner.games[0].fields.winner.status], ['', 'empty']);
const oddWinner = d.draftFromTextLines(['1. 501: A vs B | 1-0 | W: Maybe']).games[0].fields.winner;
assert.equal(oddWinner.value, ''); assert.match(oddWinner.reason, /“Maybe” was not understood/);
// Unrecognised lines are kept for the reviewer, not dropped or guessed.
assert.deepEqual(draft.unparsed, ['SYNTHETIC SAMPLE LEAGUE — NOT A REAL CARD', 'Captain sign: ~~~']);
// Conflicting repeat readings become doubt.
const twice = d.draftFromTextLines(['Home: Red', 'Home: Rod']);
assert.deepEqual([twice.fields.homeTeam.value, twice.fields.homeTeam.status], ['Red', 'uncertain']);
const empty = d.draftFromTextLines([]);
assert.ok(Object.values(empty.fields).every(x => x.value === '' && x.status === 'empty')); assert.equal(empty.games.length, 0);
console.log('PASS uncertain readings flagged; missing values never invented; stray text preserved');

// Review gating.
const flags = d.openFlags(draft);
assert.ok(flags.length >= 20);
assert.throws(() => d.markReviewed(draft, { attested: true }), /still need review/);
assert.throws(() => d.exportDraft(draft), /Finish the manual review/);
assert.throws(() => d.exportDraft({ ...draft, reviewed: true }), /Finish the manual review/, 'a forged reviewed flag cannot bypass open flags');
assert.throws(() => d.markReviewed(d.createDraft(), { attested: true }), /still need review/, 'an empty draft is not reviewable');

// Resolve every flag the way a reviewer would.
const before = JSON.stringify(draft);
assert.throws(() => d.setField(draft, { key: 'homeTotal' }, 'three'), /whole number/);
assert.throws(() => d.confirmField(draft, { game: draft.games[2].id, key: 'homeScore' }), /whole number/, 'a doubtful score cannot be confirmed as-is');
assert.throws(() => d.confirmField(draft, { game: draft.games[3].id, key: 'winner' }), /nothing to confirm/);
assert.throws(() => d.setField(draft, { key: 'nope' }, 'x'), /Unknown/);
assert.equal(JSON.stringify(draft), before, 'failed edits and all operations leave the input draft unchanged');
draft = d.setField(draft, { key: 'awayTeam' }, 'Triple Trouble');
draft = d.setField(draft, { game: draft.games[2].id, key: 'homeScore' }, '1');
draft = d.setField(draft, { game: draft.games[3].id, key: 'awayPlayers' }, 'Gus Pike & Hal Lee');
draft = d.markBlank(draft, { game: draft.games[3].id, key: 'homeScore' });
draft = d.markBlank(draft, { game: draft.games[3].id, key: 'awayScore' });
draft = d.setField(draft, { game: draft.games[3].id, key: 'winner' }, 'home');
for (const flag of d.openFlags(draft)) {
    if (flag.path.unparsed !== undefined) continue;
    draft = d.confirmField(draft, flag.path);
}
while (draft.unparsed.length) draft = d.dismissUnparsed(draft, 0);
assert.deepEqual(d.openFlags(draft), []);
assert.throws(() => d.markReviewed(draft), /compared every field/);
assert.throws(() => d.markReviewed(draft, { attested: 'yes' }), /compared every field/);
// Cross-check warns (card says 3-1 but three home wins + one away) without changing values.
assert.deepEqual(d.consistencyWarnings(draft), []);
let wrong = d.setField(draft, { game: draft.games[0].id, key: 'winner' }, 'away');
assert.equal(d.consistencyWarnings(wrong).length, 3);
assert.equal(wrong.fields.homeTotal.value, '3', 'totals are never auto-corrected');
const reviewed = d.markReviewed(draft, { attested: true, now: Date.UTC(2026, 10, 19) });
assert.equal(reviewed.reviewed, true);
const out = d.exportDraft(reviewed);
assert.equal(out.reviewedAt, '2026-11-19T00:00:00.000Z');
assert.match(out.notice, /Not submitted to any league tracker/);
assert.deepEqual([out.homeTeam, out.awayTeam, out.homeTotal, out.awayTotal], ['Bullseye Bandits', 'Triple Trouble', 3, 1]);
assert.deepEqual(out.games[3], { number: 4, game: 'Cricket', homePlayers: 'Eve Tran & Flo Diaz', awayPlayers: 'Gus Pike & Hal Lee', homeScore: null, awayScore: null, winner: 'home' });
// Any later edit re-opens the review.
const edited = d.setField(reviewed, { key: 'date' }, '11/13/2026');
assert.equal(edited.reviewed, false); assert.throws(() => d.exportDraft(edited));
assert.equal(d.addGame(reviewed).reviewed, false); assert.equal(d.removeGame(reviewed, reviewed.games[0].id).reviewed, false);
assert.equal(d.setField(reviewed, { key: 'date' }, '   ').fields.date.status, 'empty', 'clearing a field re-flags it as missing');
assert.ok(d.isDraft(reviewed)); assert.ok(!d.isDraft({ version: 1 })); assert.ok(!d.isDraft(null));
console.log('PASS mandatory review: flags block review/export; attestation required; edits re-open review');

// Manual-entry scaffold works with no extraction at all.
let manual = d.addGame(d.createDraft());
assert.equal(manual.source, 'manual'); assert.equal(manual.games[0].number, 1);
assert.equal(d.openFlags(manual).length, 11);
console.log('PASS manual-entry draft');

// On-device detector adapter: absent → explicit failure; present → reading-order lines, no confidence claimed.
assert.equal(detectorAvailable({}), false);
await assert.rejects(detectLines({}, {}), /no on-device text detector/);
const blocks = [
    { rawValue: 'Bandits', boundingBox: { x: 120, y: 52, height: 20 } }, { rawValue: 'Home:', boundingBox: { x: 10, y: 50, height: 20 } },
    { rawValue: 'Date: 11/12/2026', boundingBox: { x: 10, y: 10, height: 20 } }, { rawValue: '  ', boundingBox: { x: 0, y: 0, height: 20 } }];
assert.deepEqual(blocksToLines(blocks), [{ text: 'Date: 11/12/2026' }, { text: 'Home: Bandits' }]);
class FakeDetector { async detect() { return blocks; } }
const lines = await detectLines({}, { TextDetector: FakeDetector });
const viaDetector = d.draftFromTextLines(lines, { extraction: 'on-device-text-detector' });
assert.deepEqual([viaDetector.fields.homeTeam.value, viaDetector.fields.homeTeam.status, viaDetector.extraction], ['Bandits', 'extracted', 'on-device-text-detector']);
assert.deepEqual(d.draftFromTextLines(SAMPLE_LINES).games.length, 4);
console.log('PASS detector adapter orders lines and flags everything it reads');

// Local processing only: no network, OCR library, cloud service or tracker code.
const read = file => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
for (const file of ['draft.js', 'extract.js', 'sample.js', 'page.js']) {
    const source = read('../js/scorecard/' + file);
    assert.ok(!/fetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|firebase|https?:\/\/|tesseract|importScripts/i.test(source), `${file} must not reach the network or a third-party reader`);
}
for (const file of ['draft.js', 'extract.js', 'sample.js']) assert.ok(!/localStorage|document\./.test(read('../js/scorecard/' + file)), `${file} stays pure`);
const page = read('../js/scorecard/page.js');
assert.deepEqual([...page.matchAll(/localStorage\.(?:setItem|removeItem|getItem)\((\w+)/g)].map(m => m[1]).filter(k => k !== 'DRAFT_KEY'), [], 'the page touches only its own draft key');
assert.match(page, /DRAFT_KEY = 'blakeout_dev_scorecard_draft_v1'/);
const html = read('../scorecard/index.html');
assert.ok(!/<script[^>]+src="https?:|<link[^>]+href="https?:|<form/i.test(html));
assert.ok(!fs.existsSync(new URL('../../scorecard', import.meta.url)) && !fs.existsSync(new URL('../../js/scorecard', import.meta.url)), 'scorecard reader must not exist in production');
console.log('PASS scorecard reader is local-only and DEV-only');
