/** Actual account UI module with deterministic DOM/provider fixtures, never live Firebase. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/accounts-page.js', import.meta.url), 'utf8');
const deferred = () => {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));
const user = (uid, verified = true) => ({ uid, email: `${uid}@example.invalid`, emailVerified: verified, isAnonymous: false });
const record = id => ({ id, matchId: id, createdAt: 1000, gameType: '501', perPlayer: [] });

class Element {
    constructor() {
        this.disabled = false; this.hidden = false; this.value = ''; this.textContent = '';
        this.listeners = {}; this.style = {}; this.attrs = {}; this.children = [];
        this.classList = { toggle() {} };
    }
    setAttribute(key, value) { this.attrs[key] = value; }
    addEventListener(event, listener) { this.listeners[event] = listener; }
    reportValidity() { return true; }
    replaceChildren(...children) { this.children = children; this.textContent = ''; }
    append(child) { this.children.push(child); }
    click() { return this.listeners.click?.({}); }
    submit(submitter = null) { return this.listeners.submit?.({ preventDefault() {}, submitter }); }
}

async function harness(initial = user('a')) {
    const nodes = new Map(), hooks = {}, calls = {}, windowListeners = {};
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, new Element());
        return nodes.get(id);
    };
    node('profileForm').querySelector = () => node('saveProfile');
    const state = { user: initial, exportBlob: null };
    const api = {
        initPlatform: async () => {}, subscribeAccount: callback => { state.listener = callback; callback(state.user); },
        getAccount: () => state.user, isAccountLink: () => false, pendingAccountEmail: () => '',
        getProfile: async () => ({ name: 'Player' }), listMyResults: async () => [],
        sendAccountLink: async () => {}, completeAccountLink: async () => {}, signOutAccount: async () => {},
        saveProfile: async () => {}, registerAccount: async () => {}, signInAccount: async () => {},
        sendAccountVerification: async () => {}, resetAccountPassword: async () => {}, refreshAccount: async () => {}
    };
    const context = vm.createContext({
        document: { getElementById: node, createElement: () => new Element(), addEventListener() {} },
        window: { addEventListener: (event, listener) => { windowListeners[event] = listener; } },
        URL: { createObjectURL: blob => { state.exportBlob = blob; return 'blob:fixture'; }, revokeObjectURL() {} },
        Blob, setTimeout() {}, console
    });
    const platform = new vm.SyntheticModule(Object.keys(api), function () {
        for (const name of Object.keys(api)) this.setExport(name, (...args) => {
            calls[name] = (calls[name] || 0) + 1;
            return (hooks[name] || api[name])(...args);
        });
    }, { context });
    const registry = new vm.SyntheticModule(['GAME_REGISTRY'], function () {
        this.setExport('GAME_REGISTRY', [{ id: '501', engine: 'x01' }]);
    }, { context });
    // Expose render/read helpers only inside this test VM; shipped exports stay unchanged.
    const module = new vm.SourceTextModule(source + '\nexport { renderAccount, refreshRecords, passwordAuth };', { context });
    await module.link(specifier => specifier === './platform.js' ? platform : registry);
    await module.evaluate(); await flush();
    return {
        node, hooks, calls, state, windowListeners, ui: module.namespace,
        async change(next) { state.user = next; await state.listener(next); },
        status: () => node('accountStatus').textContent,
        records: () => node('records').children.map(child => child.textContent).join('\n')
    };
}

let passed = 0;
async function test(name, body) { await body(); passed++; console.log(`PASS ${name}`); }

await test('latest records response owns visible records and JSON export', async () => {
    const h = await harness(), older = deferred();
    h.hooks.listMyResults = () => older.promise;
    const first = h.ui.refreshRecords();
    h.hooks.listMyResults = async () => [record('new')];
    await h.node('refreshRecords').click();
    older.resolve([record('old')]); await first;
    assert.match(h.records(), /Match new/); assert.doesNotMatch(h.records(), /Match old/);
    h.node('exportRecords').click();
    const exported = JSON.parse(await h.state.exportBlob.text());
    assert.deepEqual(exported.results.map(item => item.id), ['new']);
});

await test('superseded same-account record errors do not replace current status', async () => {
    const h = await harness(), older = deferred();
    h.hooks.listMyResults = () => older.promise;
    const first = h.ui.refreshRecords();
    h.hooks.listMyResults = async () => [record('new')]; await h.ui.refreshRecords();
    older.reject(Error('Obsolete read')); await first;
    assert.doesNotMatch(h.status(), /Obsolete/); assert.match(h.records(), /Match new/);
});

await test('account replacement discards late records and keeps export private', async () => {
    const h = await harness(), older = deferred();
    h.hooks.listMyResults = () => older.promise;
    const first = h.node('refreshRecords').click();
    await h.change(null); older.resolve([record('private-a')]); await first;
    assert.equal(h.records(), ''); assert.equal(h.node('exportRecords').disabled, true);
    assert.equal(h.node('recordsPanel').hidden, true);
});

await test('export cannot relabel old records during an auth-notification gap', async () => {
    const h = await harness();
    h.hooks.listMyResults = async () => [record('private-a')]; await h.ui.refreshRecords();
    h.state.user = user('b'); // SDK getter changes before its UI observer runs.
    h.node('exportRecords').click(); assert.equal(h.state.exportBlob, null);
    await h.change(h.state.user);
});

await test('old record failure cannot replace new account status or release its busy button', async () => {
    const h = await harness(), oldRead = deferred(), newRead = deferred();
    h.hooks.listMyResults = () => oldRead.promise;
    const first = h.node('refreshRecords').click();
    h.hooks.listMyResults = async () => []; await h.change(user('b'));
    h.hooks.listMyResults = () => newRead.promise;
    const second = h.node('refreshRecords').click();
    oldRead.reject(Error('Old read')); await first;
    assert.doesNotMatch(h.status(), /Old read/); assert.equal(h.node('refreshRecords').disabled, true);
    newRead.resolve([record('b')]); await second;
    assert.equal(h.node('refreshRecords').disabled, false); assert.match(h.records(), /Match b/);
});

await test('profile submit without submitter is safe; late success stays off signed-out screen', async () => {
    const h = await harness(), save = deferred();
    h.hooks.saveProfile = () => save.promise;
    h.node('profileForm').submit(); await flush();
    assert.equal(h.node('saveProfile').disabled, true);
    await h.change(null); save.resolve(); await flush();
    assert.match(h.status(), /Sign in with email/); assert.equal(h.node('saveProfile').disabled, false);
});

await test('old profile error is ignored while a current failure remains visible', async () => {
    const h = await harness(), oldSave = deferred(), newSave = deferred();
    h.hooks.saveProfile = () => oldSave.promise; h.node('profileForm').submit();
    await h.change(user('b'));
    h.hooks.saveProfile = () => newSave.promise; h.node('profileForm').submit();
    oldSave.reject(Error('Old save')); await flush();
    assert.doesNotMatch(h.status(), /Old save/); assert.equal(h.node('saveProfile').disabled, true);
    newSave.reject(Error('Current save')); await flush();
    assert.match(h.status(), /Current save/); assert.equal(h.node('accountStatus').attrs.role, 'alert');
    assert.equal(h.node('saveProfile').disabled, false);
});

await test('repeated verification actions share one pending UI operation', async () => {
    const h = await harness(user('a', false)), send = deferred();
    h.hooks.sendAccountVerification = () => send.promise;
    const first = h.node('sendVerification').click(); await h.node('sendVerification').click();
    assert.equal(h.calls.sendAccountVerification, 1);
    await h.change(h.state.user); // Same account refresh must not unlock the send.
    assert.equal(h.node('sendVerification').disabled, true);
    send.resolve(); await first;
    assert.match(h.status(), /Verification email sent/); assert.equal(h.node('sendVerification').disabled, false);
});

await test('registration owns its initial verification send through the expected account transition', async () => {
    const h = await harness(null), email = deferred();
    h.node('accountEmail').value = 'new@example.invalid'; h.node('accountPassword').value = 'fixture-only';
    h.hooks.registerAccount = async () => { await h.change(user('new', false)); await email.promise; };
    const signup = h.ui.passwordAuth(true); await flush();
    assert.equal(h.node('verificationPanel').hidden, false); assert.equal(h.node('sendVerification').disabled, true);
    await h.node('sendVerification').click(); assert.equal(h.calls.sendAccountVerification || 0, 0);
    email.resolve(); await signup;
    assert.match(h.status(), /Account created/); assert.equal(h.node('accountPassword').value, '');
    assert.equal(h.node('sendVerification').disabled, false);
});

await test('verification delivery failure after signup still surfaces and allows a deliberate retry', async () => {
    const h = await harness(null);
    h.node('accountEmail').value = 'new@example.invalid'; h.node('accountPassword').value = 'fixture-only';
    h.hooks.registerAccount = async () => { await h.change(user('new', false)); throw Error('Delivery failed'); };
    await h.ui.passwordAuth(true);
    assert.match(h.status(), /Delivery failed/); assert.equal(h.node('verificationPanel').hidden, false);
    assert.equal(h.node('sendVerification').disabled, false); assert.equal(h.node('accountPassword').value, '');
});

await test('obsolete credential cleanup preserves a replacement request and newly entered password', async () => {
    const h = await harness(null), oldLogin = deferred(), newLogin = deferred();
    h.node('accountEmail').value = 'a@example.invalid'; h.node('accountPassword').value = 'old-input';
    h.hooks.signInAccount = () => oldLogin.promise; const first = h.ui.passwordAuth(false);
    await h.change(user('b'));
    assert.equal(h.node('accountPassword').value, '', 'Identity changes clear the previous password immediately');
    await h.change(null);
    h.node('accountEmail').value = 'c@example.invalid'; h.node('accountPassword').value = 'new-input';
    h.hooks.signInAccount = () => newLogin.promise; const second = h.ui.passwordAuth(false);
    oldLogin.reject(Error('Old login')); await first;
    assert.doesNotMatch(h.status(), /Old login/); assert.equal(h.node('accountPassword').value, 'new-input');
    assert.equal(h.node('passwordSignIn').disabled, true);
    newLogin.reject(Error('Current login')); await second;
    assert.match(h.status(), /Current login/); assert.equal(h.node('accountPassword').value, '');
    assert.equal(h.node('passwordSignIn').disabled, false);
});

await test('email-link completion retains its expected account transition and current token errors', async () => {
    const h = await harness(null);
    h.node('linkEmail').value = 'linked@example.invalid';
    h.hooks.completeAccountLink = async () => { await h.change(user('linked')); throw Error('Current token failure'); };
    await h.node('completeLink').click();
    assert.match(h.status(), /Current token failure/); assert.equal(h.node('completeLink').disabled, false);
    h.hooks.completeAccountLink = async () => {};
    await h.node('completeLink').click(); assert.equal(h.node('completeLink').hidden, true);
});

await test('late email outcomes cannot overwrite another account or a signed-out screen', async () => {
    const h = await harness(user('a', false)), email = deferred();
    h.hooks.sendAccountVerification = () => email.promise;
    const first = h.node('sendVerification').click();
    await h.change(null); email.resolve(); await first;
    assert.match(h.status(), /Sign in with email/);
    const reset = deferred(); h.hooks.resetAccountPassword = () => reset.promise;
    h.node('passwordReset').click(); await h.change(user('b'));
    reset.reject(Error('Old reset')); await flush(); assert.doesNotMatch(h.status(), /Old reset/);
});

await test('return verification refresh still coalesces and ignores obsolete account failures', async () => {
    const h = await harness(user('a', false)), refresh = deferred();
    h.hooks.refreshAccount = () => refresh.promise;
    const before = h.calls.refreshAccount || 0;
    const first = h.windowListeners.focus(); await h.windowListeners.focus();
    assert.equal(h.calls.refreshAccount, before + 1);
    await h.change(user('b')); refresh.reject(Error('Old verification')); await first;
    assert.doesNotMatch(h.status(), /Old verification/);
});

console.log(`\n${passed}/${passed} account UI ownership groups passed. DOM/provider fixtures are not browser or live-email proof.`);
