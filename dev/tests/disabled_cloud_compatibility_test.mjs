// Disabled DEV APIs must preserve their caller contracts without SDK/network access.
// Run: node --test dev/tests/disabled_cloud_compatibility_test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as roster from '../js/firebase.js';
import { GUEST_SIGNUP_AVAILABLE, joinTournamentAsGuest } from '../js/platform.js';

globalThis.location = { hostname: 'localhost' };
globalThis.document = { body: { classList: { contains: () => true } } };

test('disabled guest signup preserves name validation before its unavailable error', async () => {
    assert.equal(GUEST_SIGNUP_AVAILABLE, false);
    for (const name of ['', 'person@example.test', 'x'.repeat(41)]) {
        await assert.rejects(joinTournamentAsGuest('event', name), /public display name/);
    }
    for (const id of ['event', null, 'invalid/id']) {
        await assert.rejects(joinTournamentAsGuest(id, ' Guest '), {
            message: 'Online guest signup is unavailable: Anonymous Auth is disabled for the isolated DEV project. Ask the organizer to add you, or use device-local brackets.',
        });
    }
});

test('disabled roster retains validation, unavailable writes, null reads and harmless deletes', async () => {
    await assert.rejects(roster.upsertPlayer({ name: ' ', email: 'person@example.test' }), /name required/);
    await assert.rejects(roster.upsertPlayer({ name: 'Guest', email: 'person@example.test' }), {
        message: 'Roster is offline. Check your connection and refresh.',
    });
    assert.equal(await roster.getMonthlyUsage('2026-10-dev'), null);
    assert.equal(await roster.getMonthlyUsage(), null);
    assert.equal(await roster.deletePlayer(' Person@Example.test '), undefined);
    assert.equal(await roster.deletePlayer(''), undefined);
    assert.equal(roster.findPlayerByName('Guest'), null);
    assert.equal(roster.findPlayerByEmail('person@example.test'), null);
    assert.throws(roster.getRosterShareUrl, /DEV cloud roster sharing is disabled/);
});

test('disabled initialization still notifies subscribers and exposes the same error state', async () => {
    let notices = 0;
    const stop = roster.onRosterChange(rows => { assert.deepEqual(rows, []); notices++; });
    await roster.initFirebase();
    assert.equal(notices, 1);
    assert.equal(roster.getInitState().state, 'error');
    assert.match(roster.getInitState().error.message, /DEV cloud roster and usage sync are disabled/);
    stop();
    await roster.initFirebase();
    assert.equal(notices, 1);
});

test('usage compatibility test seam remains idempotent; ordinary disabled calls do not write', () => {
    const stored = new Map([['unrelated-save', 'preserved']]);
    globalThis.localStorage = {
        getItem: key => stored.get(key) ?? null,
        setItem: (key, value) => stored.set(key, value),
        removeItem: key => stored.delete(key),
    };
    const writes = [];
    const sdk = {
        doc: (_db, ...path) => path,
        increment: value => value,
        setDoc: (...args) => { writes.push(args); return Promise.resolve(); },
    };
    roster.recordMonthlyUsage();
    assert.deepEqual([...stored], [['unrelated-save', 'preserved']]);
    const fixture = { db: {}, sdk, countableHost: true };
    roster.recordMonthlyUsage(fixture);
    roster.recordMonthlyUsage(fixture);
    assert.equal(writes.length, 1);
    assert.match(writes[0][0][1], /^\d{4}-\d{2}-dev$/);
    assert.equal(stored.get('unrelated-save'), 'preserved');
});
