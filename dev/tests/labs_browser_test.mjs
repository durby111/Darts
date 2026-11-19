// Rendered Chromium checks for the three DEV labs features:
// 501 coach, TV spectator board, scorecard reader. Synthetic data only; external
// requests are blocked and counted; no accounts, backend, or real scorecards.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';
const { chromium } = createRequire(import.meta.url)(process.env.BLAKEOUT_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const output = process.env.BLAKEOUT_QA_OUTPUT;
if (output) await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer(async (req, res) => {
    try {
        let file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
        if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
        if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
        res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        res.end(await readFile(file));
    } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.BLAKEOUT_CHROMIUM || undefined });
const results = [];
const shot = async (page, name) => { if (output) await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); };

async function run(name, fn, options = {}) {
    if (process.argv.length > 2 && !process.argv.slice(2).some(filter => name.includes(filter))) return;
    const { scorerPage, ...contextOptions } = options;
    const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 }, ...contextOptions });
    const audit = { external: [], writes: [], errors: [] };
    await ctx.route('**/*', route => {
        const request = route.request();
        if (!request.url().startsWith(base + '/')) { let from = '/dev/ (service worker)'; try { from = request.frame().url().replace(base, ''); } catch { /* worker request: no frame */ } audit.external.push(request.url() + ' <- ' + from); return route.abort(); }
        if (request.method() !== 'GET') audit.writes.push(`${request.method()} ${request.url()}`);
        return route.continue();
    });
    const open = async url => {
        const page = await ctx.newPage();
        page.on('pageerror', error => audit.errors.push(error.message));
        page.on('dialog', dialog => dialog.accept());
        if (url) await page.goto(base + url);
        return page;
    };
    try {
        await fn({ ctx, open, audit });
        assert.deepEqual(audit.errors, [], 'page errors');
        assert.deepEqual(audit.external.filter(url => !(options.scorerPage && url.startsWith('https://www.gstatic.com/firebasejs/') && / <- \/dev\/(\?| |$)/.test(url))), [], 'no request may leave the local test server');
        assert.deepEqual(audit.writes, [], 'no non-GET network request');
        results.push({ name, pass: true }); console.log('PASS', name);
    } catch (error) { results.push({ name, pass: false }); console.log('FAIL', name, '\n', error); }
    finally { await ctx.close(); }
}

const gameState = page => page.evaluate(async () => JSON.parse(JSON.stringify((await import('/dev/js/state.js')).game)));
const enter = async (page, n) => { await page.waitForTimeout(750); for (const digit of String(n)) await page.locator(`[data-digit="${digit}"]`).click(); await page.click('#x01EnterBtn'); };
const startCasual = async (page, mode) => { await page.selectOption('#gameType', mode); await page.click('#startGameBtn'); await page.locator('#gameScreen').waitFor({ state: 'visible' }); };
const stats = page => page.locator('#coachRecap .coach-stat').evaluateAll(rows => Object.fromEntries(rows.map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent])));

// ---------------------------------------------------------------- 501 coach
await run('coach: 501 recap from recorded turns, one drill, collapsed by default, removed on undo', async ({ open }) => {
    const page = await open('/dev/');
    await page.locator('#player1').waitFor();
    await startCasual(page, '501');
    // Home: 180, 180, 100, bust(60 > 41), 41. Away: 60, 45, 26, 100.
    for (const n of [180, 60, 180, 45, 100, 26, 60, 100, 41]) await enter(page, n);
    await page.locator('#winnerModal').waitFor({ state: 'visible' });
    const game = await gameState(page);
    assert.deepEqual(game.players.map(p => p.score), [0, 270]);
    const panel = page.locator('#coachRecap');
    await panel.waitFor();
    assert.equal(await panel.evaluate(node => node.open), false, 'coach starts collapsed');
    // Existing winner actions are untouched and still on screen with the panel collapsed.
    for (const id of ['playAgainBtn', 'newGameBtn', 'winnerCancelBtn']) assert.ok(await page.locator('#' + id).isVisible(), id);
    await page.waitForTimeout(350);
    await panel.locator('summary').click();
    assert.deepEqual(await stats(page), {
        'Result': 'Finished on a 41-point turn', 'Turns recorded': '5', 'Points scored': '501', 'Average per turn': '100.2',
        'Highest turn': '180', 'Bust turns': '1', '100+ / 140+ / 180': '1 / 0 / 2', 'First three turns, average': '153.3',
        'Turns that began on 170 or less': '3',
    });
    assert.equal(await page.locator('#coachRecap .coach-drill').count(), 1, 'exactly one drill');
    assert.equal(await page.locator('#coachRecap .coach-drill').getAttribute('data-drill'), 'consistency');
    await shot(page, 'coach-winner');
    await page.locator('#coachRecap .coach-tab').nth(1).click();
    const away = await stats(page);
    assert.deepEqual([away['Result'], away['Turns recorded'], away['Points scored'], away['Average per turn'], away['Bust turns']], ['270 left', '4', '231', '57.8', '0']);
    assert.equal(await page.locator('#coachRecap .coach-drill').count(), 1);
    const text = await panel.innerText();
    for (const banned of [/accuracy/i, /checkout %/i, /per dart/i, /Darts recorded/]) assert.ok(!banned.test(text), String(banned));
    assert.match(text, /does not record individual darts/);
    // The coach changed nothing in the game or its saved copy.
    const after = await gameState(page);
    assert.deepEqual([after.players, after.currentPlayer, after.completedRounds], [game.players, game.currentPlayer, game.completedRounds]);
    // Undo the winning turn: the dialog closes and no stale recap remains.
    await page.click('#winnerCancelBtn');
    await page.locator('#winnerModal').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#coachRecap').count(), 0);
    assert.equal((await gameState(page)).players[0].score, 41);
    // The scorer restores the typed winning entry on undo; committing it again wins again.
    await page.waitForTimeout(750);
    await page.click('#x01EnterBtn');
    await page.locator('#coachRecap').waitFor();
    assert.equal(await page.locator('#coachRecap').count(), 1);
}, { scorerPage: true });

await run('coach: phone viewport keeps winner actions reachable; no coach for 301', async ({ open }) => {
    const page = await open('/dev/');
    await page.locator('#player1').waitFor();
    await startCasual(page, '301');
    for (const n of [180, 60, 121]) await enter(page, n);
    await page.locator('#winnerModal').waitFor({ state: 'visible' });
    await page.waitForTimeout(200);
    assert.equal(await page.locator('#coachRecap').count(), 0, '301 gets no coach');
    await page.click('#newGameBtn');
    await page.locator('#player1').waitFor();
    await startCasual(page, '501');
    for (const n of [180, 60, 180, 60, 141]) await enter(page, n);
    await page.locator('#coachRecap').waitFor();
    await page.waitForTimeout(350);
    await page.locator('#coachRecap summary').click();
    await shot(page, 'coach-phone');
    for (const id of ['playAgainBtn', 'newGameBtn', 'winnerCancelBtn']) {
        await page.locator('#' + id).scrollIntoViewIfNeeded();
        assert.ok(await page.locator('#' + id).isVisible(), id);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no horizontal overflow');
}, { scorerPage: true, viewport: { width: 390, height: 844 } });

// ------------------------------------------------------- TV spectator board
const organizerReady = page => page.waitForFunction(() => document.querySelector('#message') && !document.querySelector('#refresh').disabled);
const SPY = () => {
    window.__writes = [];
    for (const method of ['setItem', 'removeItem', 'clear']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (...args) { window.__writes.push([method, args[0]]); return original.apply(this, args); };
    }
};

await run('tv board: follows the real organizer and scorer on the same device, read-only', async ({ ctx, open, audit }) => {
    const organizer = await open('/dev/local/brackets/');
    await organizerReady(organizer);
    assert.equal(await organizer.locator('#devLabLinks a').count(), 2);
    await organizer.locator('#createPanel summary').click();
    await organizer.fill('#title', 'Synthetic TV Night');
    await organizer.selectOption('#gameType', '501');
    await organizer.fill('#bestOf', '1');
    await organizer.locator('#createForm button[type=submit]').click();
    await organizerReady(organizer);
    for (const name of ['Alex', 'Alex', 'Sam', 'Jo', 'Kit', 'Lee', 'Max', 'Noa']) { await organizer.fill('#guestName', name); await organizer.locator('#addForm button').click(); }
    await organizer.check('[data-bulk-field=checkedIn]');
    await organizer.check('[data-bulk-field=paid]');
    await organizer.click('#drawPartners'); await organizer.click('.platform-confirm-accept');
    await organizer.click('#saveRoster'); await organizerReady(organizer);
    await organizer.click('#startTournament'); await organizer.click('.platform-confirm-accept'); await organizerReady(organizer);

    // Second window of the same browser profile = the screen sent to the TV.
    const tv = await ctx.newPage();
    const tvErrors = [];
    tv.on('pageerror', error => tvErrors.push(error.message));
    await tv.addInitScript(SPY);
    await tv.goto(base + '/dev/local/tv/');
    await tv.locator('#tvTitle', { hasText: 'Synthetic TV Night' }).waitFor();
    assert.match(await tv.locator('#tvNow').innerText(), /No match is being scored on this device/);
    assert.equal(await tv.locator('#tvDeck .tv-deck-item').count(), 2);
    assert.equal(await tv.locator('#tvDiagram .match-card').count(), await organizer.locator('#diagram .match-card').count());
    // View only: no scoring/correction actions, no inputs besides the hidden event picker.
    assert.equal(await tv.locator('.match-action, #launchScorer, form, input, textarea').count(), 0);
    assert.equal(await tv.locator('#tvEventLabel').isHidden(), true);
    assert.match(await tv.locator('#tvDiagram').innerText(), /\(1\) Alex/);
    assert.ok(!/paid|checked in|standby/i.test(await tv.locator('main').innerText()), 'organizer flags are not shown');

    // Launch the real scorer for a ready match and score one visit.
    await organizer.locator('.match-action').first().click();
    await organizer.click('#launchScorer');
    await organizer.waitForFunction(() => document.querySelector('#gameScreen')?.style.display === 'flex');
    await tv.locator('#tvNow .tv-side').first().waitFor();
    assert.deepEqual(await tv.locator('#tvNow .tv-score-value').allInnerTexts(), ['501', '501']);
    assert.equal(await tv.locator('#tvDeck .tv-deck-item').count(), 1, 'the match being scored leaves the on-deck list');
    assert.equal(await tv.locator('#tvDiagram .match-card.in-progress').count(), 1);
    await organizer.selectOption('#tournamentActualDarts', '3');
    await enter(organizer, 140);
    await tv.locator('#tvNow .tv-score-value', { hasText: '361' }).waitFor();
    const live = await gameState(organizer);
    assert.deepEqual(await tv.locator('#tvNow .tv-score-value').allInnerTexts(), live.players.map(p => String(p.score)));
    assert.deepEqual(await tv.locator('#tvNow .tv-team-name').allInnerTexts(), live.tournament.teams.map(t => t.name));
    assert.equal(await tv.locator('#tvNow .tv-side.throwing').count(), 1);
    assert.equal(await tv.locator('#tvNow .tv-side').nth(1).evaluate(node => node.classList.contains('throwing')), true);
    assert.match(await tv.locator('#tvNow .tv-match-meta').innerText(), /501 · best of 1/);
    await shot(tv, 'tv-board-live');

    // Finish the leg, save, and return: the board advances with the saved bracket.
    for (;;) {
        const g = await gameState(organizer);
        if (g.tournament.legComplete) break;
        await organizer.selectOption('#tournamentActualDarts', '3');
        await enter(organizer, g.currentPlayer === 0 ? Math.min(180, g.players[0].score) : 0);
    }
    await organizer.waitForTimeout(500);
    await organizer.click('#tournamentSaveResult');
    await organizer.locator('dialog[open] button', { hasText: 'Save result' }).click();
    await organizer.waitForFunction(() => document.querySelector('#tournamentResultPanel')?.textContent.includes('Result saved'));
    await tv.locator('#tvNow', { hasText: 'No match is being scored' }).waitFor();
    assert.equal(await tv.locator('#tvDiagram .match-card.complete').count(), 1);
    assert.match(await tv.locator('#tvDiagram .match-card.complete').innerText(), /Won/);
    assert.ok(await tv.locator('#tvDeck .tv-deck-item').count() >= 1);

    // The TV window never wrote tournament or scorer data, and never changed it.
    assert.deepEqual(await tv.evaluate(() => window.__writes), [], 'the TV window performs no storage writes at all');
    assert.deepEqual(tvErrors, []);
    assert.deepEqual(audit.external.filter(url => / <- \/dev\/local\/tv\//.test(url)), [], 'the TV page requests nothing external');

    // Narrow screen (mirrored phone): no sideways overflow of the page itself.
    await tv.setViewportSize({ width: 390, height: 844 });
    await tv.waitForTimeout(200);
    assert.equal(await tv.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await shot(tv, 'tv-board-phone');
}, { scorerPage: true });

await run('tv board: empty, malformed and multi-event storage are reported, never rewritten', async ({ open, ctx }) => {
    const tv = await open();
    await tv.addInitScript(SPY);
    await tv.goto(base + '/dev/local/tv/');
    await tv.locator('#tvStatus', { hasText: 'No device-local tournaments are saved in this browser' }).waitFor();
    assert.equal(await tv.locator('.tv-main').isVisible(), false);
    // Another tab saves malformed data: the board reports it and leaves it alone.
    const other = await ctx.newPage();
    await other.goto(base + '/dev/local/tv/');
    await other.evaluate(() => localStorage.setItem('blakeout_dev_local_tournaments_v1', '{not json'));
    await tv.locator('#tvStatus', { hasText: 'could not be read. Nothing was changed' }).waitFor();
    assert.equal(await tv.evaluate(() => localStorage.getItem('blakeout_dev_local_tournaments_v1')), '{not json');
    // Two live synthetic events and no scorer: the board asks instead of guessing.
    await other.evaluate(async () => {
        const engine = await import('/dev/js/brackets/engine.js');
        const make = (id, title) => {
            let t = engine.createTournament({ id, ownerId: 'device-organizer', title, date: '2026-11-19', gameType: 'cricket', bestOf: 1 });
            t = engine.saveRoster(t, Array.from({ length: 4 }, (_, i) => ({ id: id + i, name: 'Guest ' + i, tag: String(Math.floor(i / 2) + 1), paid: true, checkedIn: true, standby: false })));
            return engine.startTournament(t);
        };
        localStorage.setItem('blakeout_dev_local_tournaments_v1', JSON.stringify({ version: 1, events: { a: make('a', 'Synthetic A'), b: make('b', 'Synthetic B') }, results: {}, corrections: [] }));
    });
    await tv.locator('#tvStatus', { hasText: 'Choose a tournament to show' }).waitFor();
    assert.equal(await tv.locator('#tvEventLabel').isVisible(), true);
    await tv.selectOption('#tvEvent', 'b');
    await tv.locator('#tvTitle', { hasText: 'Synthetic B' }).waitFor();
    assert.match(tv.url(), /\?event=b$/);
    assert.match(await tv.locator('#tvDeck').innerText(), /Cricket · best of 1/);
    await tv.goto(base + '/dev/local/tv/?event=missing');
    await tv.locator('#tvStatus', { hasText: 'not saved in this browser' }).waitFor();
    assert.deepEqual(await tv.evaluate(() => window.__writes), []);
});

// --------------------------------------------------------- scorecard reader
const flagged = page => page.locator('.scorecard-field:is([data-status=empty],[data-status=extracted],[data-status=uncertain])').count();
const field = (page, id) => page.locator(`[data-field="${id}"]`);

await run('scorecard: synthetic sample → flagged draft → mandatory review → local export', async ({ open }) => {
    const page = await open('/dev/scorecard/');
    await page.locator('#extractNote', { hasText: 'Choose a photo to begin' }).waitFor();
    assert.equal(await page.locator('#draftPanel').isHidden(), true);
    assert.equal(await page.locator('#detectText').isHidden(), true);
    await page.click('#loadSample');
    await page.locator('#games .scorecard-game').nth(3).waitFor();
    assert.equal(await page.locator('#sampleCanvas').isVisible(), true);
    // Every detected field is visibly flagged; doubtful and missing ones more strongly.
    assert.equal(await field(page, 'f-card-homeTeam').getAttribute('data-status'), 'extracted');
    assert.match(await field(page, 'f-card-homeTeam').innerText(), /⚑ Check/);
    assert.equal(await field(page, 'f-card-awayTeam').getAttribute('data-status'), 'uncertain');
    assert.match(await field(page, 'f-card-awayTeam').innerText(), /⚠ Uncertain[\s\S]*low confidence/);
    const g = async n => page.locator('#games .scorecard-game').nth(n - 1);
    const g3 = await g(3), g4 = await g(4);
    assert.equal(await g3.locator('[data-field$="-homeScore"] input').inputValue(), 'l', 'the doubtful reading is shown as read, not corrected');
    assert.equal(await g3.locator('[data-field$="-homeScore"]').getAttribute('data-status'), 'uncertain');
    for (const key of ['homeScore', 'awayScore']) {
        assert.equal(await g4.locator(`[data-field$="-${key}"] input`).inputValue(), '', 'missing scores stay blank');
        assert.equal(await g4.locator(`[data-field$="-${key}"]`).getAttribute('data-status'), 'empty');
    }
    assert.equal(await g4.locator('[data-field$="-winner"] select').inputValue(), '', 'no winner is invented');
    assert.equal(await page.locator('#unparsed li').count(), 2);
    const total = await flagged(page);
    assert.equal(total, 29, 'all 29 sample fields start flagged');
    assert.match(await page.locator('#reviewSummary').innerText(), /31 items still need your review/);
    // Review cannot be completed or exported while anything is flagged.
    for (const id of ['markReviewed', 'download', 'attest']) assert.equal(await page.locator('#' + id).isDisabled(), true, id);
    assert.equal(await page.locator('#exportText').inputValue(), '');
    await shot(page, 'scorecard-flagged');

    // A reviewer fixes doubtful values, fills or blanks the missing ones, and confirms the rest.
    await page.fill('#f-card-awayTeam', 'Triple Trouble'); await page.locator('#f-card-awayTeam').blur();
    await page.locator('[data-field="f-card-awayTeam"][data-status=entered]').waitFor();
    await g3.locator('[data-field$="-homeScore"] input').fill('1'); await g3.locator('[data-field$="-homeScore"] input').blur();
    await (await g(3)).locator('[data-field$="-homeScore"][data-status=entered]').waitFor();
    // Invalid entry is rejected with a message, not coerced.
    await page.fill('#f-card-homeTotal', 'three'); await page.locator('#f-card-homeTotal').blur();
    await page.locator('#reviewStatus', { hasText: 'Enter a whole number' }).waitFor();
    await page.fill('#f-card-homeTotal', '3'); await page.locator('#f-card-homeTotal').blur();
    await page.locator('[data-field="f-card-homeTotal"][data-status=entered]').waitFor();
    await (await g(4)).locator('[data-field$="-awayPlayers"] input').fill('Gus Pike & Hal Lee');
    await (await g(4)).locator('[data-field$="-awayPlayers"] input').blur();
    await (await g(4)).locator('[data-field$="-awayPlayers"][data-status=entered]').waitFor();
    for (const key of ['homeScore', 'awayScore']) await (await g(4)).locator(`[data-field$="-${key}"] [data-action=blank]`).click();
    await (await g(4)).locator('[data-field$="-winner"] select').selectOption('home');
    await (await g(4)).locator('[data-field$="-winner"][data-status=entered]').waitFor();
    while (await page.locator('[data-action=confirm]').count()) await page.locator('[data-action=confirm]').first().click();
    assert.equal(await flagged(page), 0);
    assert.equal(await page.locator('#markReviewed').isDisabled(), true, 'stray text still blocks review');
    while (await page.locator('#unparsed button').count()) await page.locator('#unparsed button').first().click();
    assert.match(await page.locator('#reviewSummary').innerText(), /Every field has been checked/);
    // Attestation is required.
    await page.click('#markReviewed');
    await page.locator('#reviewStatus', { hasText: 'compared every field' }).waitFor();
    assert.equal(await page.locator('#download').isDisabled(), true);
    await page.check('#attest');
    await page.click('#markReviewed');
    await page.locator('#reviewSummary', { hasText: 'Reviewed.' }).waitFor();
    const exported = JSON.parse(await page.locator('#exportText').inputValue());
    assert.deepEqual([exported.homeTeam, exported.awayTeam, exported.homeTotal, exported.awayTotal, exported.games.length], ['Bullseye Bandits', 'Triple Trouble', 3, 1, 4]);
    assert.deepEqual([exported.games[3].homeScore, exported.games[3].awayScore, exported.games[3].winner], [null, null, 'home']);
    assert.match(exported.notice, /Not submitted to any league tracker/);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    assert.equal(download.suggestedFilename(), 'blakeout-league-result-draft.json');
    await shot(page, 'scorecard-reviewed');
    // Editing after review re-opens it.
    await page.fill('#f-card-date', '11/13/2026'); await page.locator('#f-card-date').blur();
    await page.locator('#reviewSummary', { hasText: 'Every field has been checked' }).waitFor();
    assert.equal(await page.locator('#download').isDisabled(), true);
    assert.equal(await page.locator('#exportText').inputValue(), '');
    // Only the reader's own draft key was written; reload restores text, not a photo.
    const keys = await page.evaluate(() => Object.keys(localStorage));
    assert.deepEqual(keys.filter(key => /scorecard/.test(key)), ['blakeout_dev_scorecard_draft_v1']);
    assert.deepEqual(keys.filter(key => /tournament|roster|active_game|usage/.test(key)), [], 'no tournament, roster, scorer or usage data touched');
    assert.ok(!/data:image|blob:/.test(await page.evaluate(() => localStorage.getItem('blakeout_dev_scorecard_draft_v1'))), 'the photo is never stored');
    await page.reload();
    await page.locator('#extractNote', { hasText: 'Restored the draft' }).waitFor();
    assert.equal(await page.inputValue('#f-card-date'), '11/13/2026');
    assert.equal(await page.locator('#photoFrame').isHidden(), true);
    await page.click('#discard');
    assert.equal(await page.evaluate(() => localStorage.getItem('blakeout_dev_scorecard_draft_v1')), null);
});

// A synthetic scorecard photo, drawn in the page; never a real card.
const syntheticPhoto = async page => Buffer.from((await page.evaluate(async () => {
    const { drawSampleCard } = await import('/dev/js/scorecard/sample.js');
    return drawSampleCard(document.createElement('canvas')).toDataURL('image/png');
})).split(',')[1], 'base64');

await run('scorecard: photo without a detector → manual entry beside the photo', async ({ open }) => {
    const page = await open('/dev/scorecard/');
    assert.equal(await page.evaluate(() => 'TextDetector' in window), false, 'this Chromium has no on-device detector (the documented limitation)');
    await page.setInputFiles('#photoInput', { name: 'synthetic-card.png', mimeType: 'image/png', buffer: await syntheticPhoto(page) });
    await page.locator('#extractNote', { hasText: 'automatic reading is unavailable here' }).waitFor();
    assert.equal(await page.locator('#detectText').isHidden(), true);
    assert.equal(await page.locator('#photo').isVisible(), true);
    assert.match(await page.locator('#photo').getAttribute('src'), /^blob:/, 'photo is an in-memory object URL');
    assert.ok(await page.locator('#photo').evaluate(img => img.complete && img.naturalWidth === 900));
    await page.click('#startBlank');
    assert.equal(await flagged(page), 5, 'a blank draft invents nothing: five empty header fields');
    assert.equal(await page.locator('#games .scorecard-game').count(), 0);
    await page.click('#addGame');
    assert.equal(await flagged(page), 11);
    assert.ok(await page.locator('#games input').evaluateAll(inputs => inputs.every(input => input.value === '')));
    await page.setInputFiles('#photoInput', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
    await page.locator('#extractNote', { hasText: 'not an image' }).waitFor();
    await page.locator('#photoZoom').fill('200');
    assert.equal(await page.locator('#photo').evaluate(img => img.style.width), '200%');
    await shot(page, 'scorecard-manual');
}, { viewport: { width: 390, height: 844 } });

await run('scorecard: on-device detector (mocked) reads a synthetic photo; everything stays flagged', async ({ open, ctx }) => {
    const page = await open();
    // Stand-in for a browser that ships TextDetector. It returns the synthetic
    // fixture's lines as positioned blocks, and proves the image reached it locally.
    const fixture = JSON.parse(await readFile(path.join(root, 'dev/tests/fixtures/scorecard/synthetic-card.json'), 'utf8'));
    await page.addInitScript(lines => {
        window.TextDetector = class {
            async detect(image) {
                window.__detected = { width: image.width, height: image.height };
                return lines.map((line, index) => ({ rawValue: line.text, boundingBox: { x: 32, y: 28 + index * 56, width: 800, height: 26 } }));
            }
        };
    }, fixture.lines);
    await page.goto(base + '/dev/scorecard/');
    await page.setInputFiles('#photoInput', { name: 'synthetic-card.png', mimeType: 'image/png', buffer: await syntheticPhoto(page) });
    await page.locator('#detectText').waitFor({ state: 'visible' });
    await page.click('#detectText');
    await page.locator('#extractNote', { hasText: 'Read 10 lines on this device' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.__detected), { width: 900, height: 620 });
    assert.equal(await page.locator('#games .scorecard-game').count(), 4);
    assert.equal(await page.inputValue('#f-card-homeTeam'), 'Bullseye Bandits');
    // The real API gives no confidence, so nothing is trusted: every field with a value is flagged.
    assert.equal(await page.locator('.scorecard-field:is([data-status=entered],[data-status=confirmed],[data-status=blank])').count(), 0);
    assert.equal(await page.locator('#markReviewed').isDisabled(), true);
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('blakeout_dev_scorecard_draft_v1'))).extraction, 'on-device-text-detector');
    // A detector failure falls back to manual entry and says so.
    const failing = await ctx.newPage();
    await failing.addInitScript(() => { window.TextDetector = class { async detect() { throw new Error('service unavailable'); } }; });
    failing.on('dialog', dialog => dialog.accept());
    await failing.goto(base + '/dev/scorecard/');
    await failing.setInputFiles('#photoInput', { name: 'synthetic-card.png', mimeType: 'image/png', buffer: await syntheticPhoto(failing) });
    await failing.click('#detectText');
    await failing.locator('#extractNote', { hasText: 'On-device text reading failed (service unavailable)' }).waitFor();
});

// ------------------------------------------------------------ offline shell
await run('offline: the DEV worker serves the TV board, scorecard reader and coach with the network off', async ({ ctx, open }) => {
    const page = await open('/dev/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.deepEqual(await page.evaluate(() => caches.keys()), ['blakeout-dev-v99-labs-20261119']);
    await ctx.setOffline(true);
    await page.goto(base + '/dev/local/tv/?event=not-saved');
    await page.locator('#tvStatus', { hasText: 'not saved in this browser' }).waitFor();
    await page.goto(base + '/dev/scorecard/');
    await page.click('#loadSample');
    await page.locator('#games .scorecard-game').nth(3).waitFor();
    await page.goto(base + '/dev/');
    await page.locator('#player1').waitFor();
    await startCasual(page, '501');
    for (const n of [180, 60, 180, 60, 141]) await enter(page, n);
    await page.locator('#coachRecap').waitFor();
    assert.ok(await page.evaluate(() => getComputedStyle(document.querySelector('#coachRecap')).borderTopLeftRadius === '12px'), 'coach stylesheet loaded offline');
}, { scorerPage: true, serviceWorkers: 'allow' });

await browser.close();
await new Promise(resolve => server.close(resolve));
const failed = results.filter(result => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} labs browser checks passed`);
process.exit(failed.length ? 1 : 0);
