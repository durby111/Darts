/** Preview isolation and actual template/module interactions, no browser/provider.
 * BLAKEOUT_JSDOM_MODULE=/path/to/existing/jsdom node --experimental-vm-modules dev/tests/mock_preview_test.mjs
 * JSDOM does not verify pixels, actual CSP enforcement, touch, or live providers. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.BLAKEOUT_JSDOM_MODULE || 'jsdom');
const dev = fileURLToPath(new URL('../', import.meta.url));
const read = p => fs.readFileSync(path.join(dev, p), 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(); };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }

async function fixture(scenario = 'verified', page = 'accounts') {
    const context = vm.createContext({ structuredClone, console });
    const modules = new Map();
    async function load(filename) {
        if (modules.has(filename)) return modules.get(filename);
        const m = new vm.SourceTextModule(fs.readFileSync(filename, 'utf8'), { context, identifier: filename });
        modules.set(filename, m);
        await m.link(spec => load(path.resolve(path.dirname(filename), spec)));
        return m;
    }
    const module = await load(path.join(dev, 'preview/fixture-platform.js'));
    await module.evaluate();
    module.namespace.configurePreview({ page, selectedScenario: scenario });
    return { api: module.namespace, modules };
}

async function browser(page = 'accounts', scenario = '', options = {}) {
    const url = `https://preview.test/dev/preview/${page}/?scenario=${scenario}${options.query || ''}`;
    const html = read(`preview/${page}/index.html`);
    const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
    const w = dom.window, context = dom.getInternalVMContext();
    const effects = { fetch: [], storage: [], exports: 0, imports: [] };
    w.localStorage.setItem('blakeout_theme', 'arctic');
    w.localStorage.setItem('blakeout_x01_skin', 'dot-better');
    w.Storage.prototype.setItem = function (...args) { effects.storage.push(args); throw Error('Storage writes forbidden'); };
    w.Storage.prototype.removeItem = function (...args) { effects.storage.push(args); throw Error('Storage removals forbidden'); };
    w.Storage.prototype.clear = function (...args) { effects.storage.push(args); throw Error('Storage clearing forbidden'); };
    Object.assign(w, { structuredClone, ResizeObserver: class { observe() {} }, confirm: () => { throw Error('Native confirmation forbidden'); } });
    w.HTMLElement.prototype.scrollIntoView = function () {};
    w.URL.createObjectURL = () => { effects.exports++; throw Error('Downloads forbidden'); };
    w.fetch = async (address, init) => {
        effects.fetch.push([address, init]);
        assert.equal(address, `https://preview.test/dev/${page}/index.html`);
        assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
        assert.ok(!init.method || init.method === 'GET');
        if (options.templateWait) await options.templateWait;
        return { ok: !options.templateFail, text: async () => read(`${page}/index.html`) };
    };
    w.HTMLScriptElement.supports = kind => kind === 'importmap' && options.supported !== false;
    const classic = w.document.querySelector('script[src]');
    Object.defineProperty(w.document, 'currentScript', { value: classic });
    if (options.tampered) w.document.getElementById('previewImportMap').textContent = '{"imports":{}}';
    if (options.scopes) { const map = JSON.parse(w.document.getElementById('previewImportMap').textContent); map.scopes = {}; w.document.getElementById('previewImportMap').textContent = JSON.stringify(map); }
    const imports = JSON.parse(w.document.getElementById('previewImportMap').textContent).imports;
    const mapping = Object.fromEntries(Object.entries(imports).map(([key, value]) => [new URL(key, url).href, new URL(value, url).href]));
    const modules = new Map();
    function filename(address) {
        assert.ok(address.startsWith('https://preview.test/dev/'), `External module forbidden: ${address}`);
        return path.join(dev, new URL(address).pathname.slice('/dev/'.length));
    }
    async function load(address) {
        address = mapping[address] || address;
        assert.ok(!address.endsWith('/js/platform.js'), 'Real platform must never be imported');
        if (modules.has(address)) return modules.get(address);
        effects.imports.push(address);
        const code = fs.readFileSync(filename(address), 'utf8');
        const m = new vm.SourceTextModule(code, {
            context, identifier: address,
            initializeImportMeta: meta => {
                meta.url = address;
                if (!options.noResolve) meta.resolve = spec => { const target = new URL(spec, address).href; return options.ignoredMap ? target : mapping[target] || target; };
            },
            importModuleDynamically: async spec => {
                const imported = await load(new URL(spec, address).href);
                if (imported.status === 'linked') await imported.evaluate();
                return imported;
            },
        });
        modules.set(address, m);
        await m.link(spec => load(new URL(spec, address).href));
        return m;
    }
    new vm.Script(read('preview/boot.js'), {
        importModuleDynamically: async spec => {
            const imported = await load(spec);
            if (imported.status === 'linked') await imported.evaluate();
            return imported;
        },
    }).runInContext(context);
    await settle();
    const get = id => w.document.getElementById(id);
    const input = (element, value) => {
        if (typeof element === 'string') element = get(element);
        if (element.type === 'checkbox') element.checked = value; else element.value = value;
        element.dispatchEvent(new w.Event(element.type === 'checkbox' || element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
    };
    const submit = id => get(id).dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    const forcedClick = id => get(id).dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));
    const click = async id => { get(id).click(); await settle(); };
    const confirm = async accept => {
        const dialog = w.document.querySelector('.platform-confirm');
        assert.ok(dialog, 'App confirmation must appear');
        assert.match(dialog.textContent, /Preview · sample data · nothing is saved or sent/);
        dialog.querySelector(accept ? '.platform-confirm-accept' : '.platform-confirm-cancel').click();
        await settle();
    };
    return { dom, w, get, effects, modules, input, submit, forcedClick, click, confirm, close: () => w.close() };
}

await test('static shells use exact hashed import map and restrictive CSP before the classic support gate', async () => {
    for (const page of ['accounts', 'brackets']) {
        const html = read(`preview/${page}/index.html`);
        const dom = new JSDOM(html); const doc = dom.window.document;
        const map = doc.getElementById('previewImportMap').textContent;
        const csp = doc.querySelector('[http-equiv="Content-Security-Policy"]').content;
        assert.ok(csp.includes(`'sha256-${createHash('sha256').update(map).digest('base64')}'`));
        for (const directive of ["default-src 'none'", "script-src 'self'", "connect-src 'self'", "form-action 'none'", "worker-src 'none'", "frame-src 'none'", "base-uri 'none'"]) assert.ok(csp.includes(directive));
        assert.equal(doc.querySelectorAll('script[type="module"]').length, 0);
        assert.equal(doc.querySelectorAll('form,input[type="email"],input[type="password"]').length, 0);
        assert.deepEqual(JSON.parse(map), { imports: { '../../js/platform.js': '../fixture-platform.js' } });
        dom.window.close();
    }
    const boot = read('preview/boot.js');
    assert.ok(boot.indexOf("supports?.('importmap')") < boot.indexOf('import(new URL'));
});
await test('unsupported or tampered import maps fail closed without requests or interactive clones', async () => {
    for (const options of [{ supported: false }, { tampered: true }, { scopes: true }]) {
        const h = await browser('accounts', 'verified', options);
        try {
            assert.equal(h.effects.imports.length, 0); assert.equal(h.effects.fetch.length, 0);
            assert.equal(h.get('previewContent').children.length, 0);
            assert.equal(h.get('previewBootStatus').getAttribute('role'), 'alert');
        } finally { h.close(); }
    }
});
await test('ignored map or unavailable resolution fail closed before template fetch or feature import', async () => {
    for (const options of [{ ignoredMap: true }, { noResolve: true }]) {
        const h = await browser('accounts', 'verified', options);
        try {
            assert.equal(h.effects.fetch.length, 0); assert.equal(h.get('previewContent').children.length, 0);
            assert.ok(!h.effects.imports.some(url => url.endsWith('/js/accounts-page.js') || url.endsWith('/js/platform.js')));
            assert.equal(h.get('previewBootStatus').getAttribute('role'), 'alert');
        } finally { h.close(); }
    }
});
await test('unavailable template fails closed before actual feature module', async () => {
    const h = await browser('accounts', 'verified', { templateFail: true });
    try {
        assert.equal(h.get('previewContent').children.length, 0);
        assert.ok(!h.effects.imports.some(url => url.endsWith('/js/accounts-page.js')));
        assert.equal(h.get('previewBootStatus').getAttribute('role'), 'alert');
    } finally { h.close(); }
});
await test('fixture graph is pure and changes/results are memory-only, clone-safe and revision checked', async () => {
    const { api, modules } = await fixture('registration', 'brackets');
    assert.deepEqual([...modules.keys()].map(f => path.relative(dev, f)).sort(), ['js/brackets/engine.js', 'preview/fixture-platform.js']);
    await api.initPlatform();
    const item = await api.getTournament('sample-cup'); item.title = 'mutated outside adapter';
    assert.match((await api.getTournament('sample-cup')).title, /^Sample /);
    await api.saveProfile('Changed label'); assert.equal((await api.getProfile()).name, 'Sample Changed label');
    const initial = await api.getTournament('sample-cup');
    const engine = modules.get(path.join(dev, 'js/brackets/engine.js')).namespace;
    const saved = await api.updateTournament(initial.id, initial.revision, current => engine.startTournament(current));
    assert.equal(saved.status, 'live');
    await assert.rejects(api.updateTournament(initial.id, initial.revision, value => value), /revision conflict/);
    const ready = saved.matches.find(match => match.status === 'ready');
    const result = await api.updateTournament(saved.id, saved.revision, current => engine.recordResult(current, ready.id, { winnerId: ready.teamA, scoreA: 2, scoreB: 0 }));
    assert.equal(result.matches.find(match => match.id === ready.id).status, 'complete');
    const fresh = await fixture('registration', 'brackets');
    assert.equal((await fresh.api.getTournament('sample-cup')).status, 'registration');
    for (const name of ['registerAccount', 'signInAccount', 'sendAccountLink', 'completeAccountLink', 'sendAccountVerification', 'resetAccountPassword']) await assert.rejects(api[name](), /disabled/);
    assert.equal(api.isAccountLink(), false); assert.equal(api.pendingAccountEmail(), '');
});
await test('guest membership is idempotent; spectator views redact private flags', async () => {
    const { api } = await fixture('spectator', 'brackets');
    const first = await api.joinTournamentAsGuest('sample-cup', 'Test Guest');
    const second = await api.joinTournamentAsGuest('sample-cup', 'Other Guest');
    assert.equal(first.registrationId, second.registrationId);
    assert.equal(first.tournament.registrations.length, second.tournament.registrations.length);
    assert.ok(first.tournament.registrations.some(entry => entry.name === 'Sample Test Guest'));
    for (const row of first.tournament.registrations) for (const key of ['paid', 'checkedIn', 'standby']) assert.equal(row[key], undefined);
    await assert.rejects(api.getProfile(), /simulated verified/);
});
await test('accounts use actual current template/module, sample records, read-only saved appearance, and safe actions', async () => {
    const h = await browser('accounts', 'verified');
    try {
        assert.equal(h.get('profilePanel').hidden, false); assert.equal(h.get('recordsPanel').hidden, false);
        assert.match(h.get('records').textContent, /SAMPLE-W1.1/);
        assert.match(h.get('lifetimeSummary').textContent, /22.27 PPD/);
        assert.match(h.get('lifetimeSummary').textContent, /2.50 MPR/);
        assert.match(h.get('accountStatus').textContent, /^Sample · Simulated verified/);
        assert.equal(h.w.document.documentElement.dataset.theme, 'arctic');
        assert.equal(h.w.document.documentElement.dataset.scoreboardMode, 'dot-better');
        h.input('previewTheme', 'red'); h.input('previewStyle', 'classic');
        assert.equal(h.w.document.documentElement.dataset.theme, 'red');
        assert.equal(h.w.document.documentElement.dataset.scoreboardMode, 'classic');
        h.input('displayName', 'Example'); h.submit('profileForm'); await settle();
        assert.match(h.get('accountStatus').textContent, /saved/);
        h.forcedClick('exportRecords'); h.forcedClick('passwordReset'); h.submit('passwordForm'); h.submit('emailForm'); await settle();
        assert.equal(h.effects.exports, 0); assert.deepEqual(h.effects.storage, []);
        for (const id of ['accountEmail', 'accountPassword', 'linkEmail']) {
            assert.equal(h.get(id).disabled, true); assert.equal(h.get(id).readOnly, true); assert.equal(h.get(id).value, '');
            assert.equal(h.get(id).type, 'text'); assert.equal(h.get(id).hasAttribute('name'), false);
        }
        assert.equal(h.effects.fetch.length, 1);
        assert.ok(h.effects.imports.some(url => url.endsWith('/js/accounts-page.js')));
        assert.ok(!h.effects.imports.some(url => /firebase|account-email|feature-page|theme\.js|\/js\/platform\.js/.test(url)));
    } finally { h.close(); }
});
await test('signed-out/unverified/empty/error/loading account scenarios and auth-link queries stay synthetic', async () => {
    for (const scenario of ['signed-out', 'unverified', 'empty', 'error', 'loading']) {
        const h = await browser('accounts', scenario, { query: '&mode=signIn&oobCode=must-not-consume&apiKey=not-real' });
        try {
            assert.equal(h.effects.fetch.length, 1); assert.deepEqual(h.effects.storage, []);
            assert.equal(h.get('completeLink').hidden, true);
            if (scenario === 'signed-out') assert.equal(h.get('signInPanel').hidden, false);
            if (scenario === 'unverified') assert.equal(h.get('verificationPanel').hidden, false);
            if (scenario === 'empty') assert.match(h.get('records').textContent, /No recorded matches/);
            if (scenario === 'error') assert.match(h.get('accountStatus').textContent, /Simulated sample-data error/);
            if (scenario === 'loading') {
                assert.equal(h.get('previewContent').inert, true);
                assert.equal(h.submit('profileForm'), false, 'Premature submits must be stopped');
            }
        } finally { h.close(); }
    }
});
await test('actual bracket roster edits, shared confirmations, start, manual result and scorer guard work together', async () => {
    const h = await browser('brackets', 'registration');
    try {
        assert.equal(h.get('tournament').hidden, false); assert.equal(h.get('rosterRows').rows.length, 8);
        assert.match(h.get('message').textContent, /^Sample · .*sample memory/);
        assert.ok(h.w.document.querySelectorAll('.match-card').length > 0);
        h.input(h.w.document.querySelector('[data-field="name"]'), 'Edited label');
        h.submit('rosterForm'); await settle();
        assert.match(h.get('publicRoster').textContent, /Sample Edited label/);
        await h.click('startTournament'); await h.confirm(false);
        assert.equal(h.get('rosterPanel').hidden, false); assert.match(h.get('startFeedback').textContent, /canceled/);
        await h.click('startTournament'); await h.confirm(true);
        assert.equal(h.get('rosterPanel').hidden, true); assert.match(h.get('tournamentMeta').textContent, /live/);
        h.w.document.querySelector('.match-action').click(); await settle();
        assert.equal(h.get('resultPanel').hidden, false);
        h.forcedClick('launchScorer'); await settle();
        assert.equal(h.w.location.pathname, '/dev/preview/brackets/'); assert.equal(h.w.location.search.includes('tournamentMatch'), false);
        h.input('scoreA', '2'); h.input('scoreB', '1'); h.submit('resultForm'); await settle(); await h.confirm(true);
        assert.match(h.get('message').textContent, /Manual result saved/);
        assert.ok(h.w.document.querySelector('.slot-score'));
        assert.deepEqual(h.effects.storage, []); assert.equal(h.effects.fetch.length, 1);
        assert.ok(h.effects.imports.some(url => url.endsWith('/js/brackets/page.js')));
        assert.ok(h.effects.imports.some(url => url.endsWith('/js/confirm-dialog.js')));
    } finally { h.close(); }
});
await test('all bracket scenarios render and internal navigation never targets real feature routes', async () => {
    for (const scenario of ['live', 'complete', 'large', 'spectator', 'unverified', 'empty', 'error', 'loading']) {
        const h = await browser('brackets', scenario);
        try {
            if (scenario === 'large') assert.equal(h.get('rosterRows').rows.length, 64);
            if (scenario === 'complete') assert.match(h.get('champion').textContent, /Champion/);
            if (scenario === 'spectator' || scenario === 'unverified') assert.equal(h.get('rosterPanel').hidden, true);
            if (scenario === 'empty') assert.match(h.get('currentList').textContent, /No current tournaments/);
            if (scenario === 'error') assert.match(h.get('message').textContent, /Simulated sample-data error/);
            if (scenario === 'loading') assert.equal(h.get('refresh').disabled, true);
            for (const link of h.w.document.querySelectorAll('a[href]')) {
                const target = new URL(link.href);
                assert.ok(target.pathname.startsWith('/dev/preview/') || (target.pathname === '/dev/' && link.dataset.leavePreview === 'true'));
                assert.equal(target.search.includes('tournamentMatch'), false);
            }
            assert.deepEqual(h.effects.storage, []);
        } finally { h.close(); }
    }
});
await test('preview files are independent of real entrypoints, availability, provider modules and SW precaches', async () => {
    for (const p of ['sw.js', 'index.html', 'js/feature-page.js', 'js/platform.js', 'js/feature-availability.js']) assert.ok(!read(p).includes('/preview/'), `${p} must not depend on preview`);
    const root = path.resolve(dev, '..');
    assert.equal(fs.existsSync(path.join(root, 'preview')), false);
    for (const p of ['js/feature-availability.js', '../js/feature-availability.js']) {
        const code = read(p);
        assert.match(code, /brackets:\s*false/); assert.match(code, /accounts:\s*false/);
    }
    const fixtureCode = read('preview/fixture-platform.js');
    assert.doesNotMatch(fixtureCode, /\bfetch\s*\(|\blocalStorage\s*\.|\bsessionStorage\s*\.|\bindexedDB\s*\.|https?:\/\//);
    const preview = read('preview/preview.js');
    assert.doesNotMatch(preview, /\.setItem\(|\.removeItem\(|\.clear\(|serviceWorker\.register|saveScoreSkin\(/);
    for (const page of ['accounts', 'brackets']) {
        const dom = new JSDOM(read(`preview/${page}/index.html`), { url: `https://test.invalid/dev/preview/${page}/` });
        for (const node of dom.window.document.querySelectorAll('[src],link[href]')) {
            const target = new URL(node.getAttribute('src') || node.getAttribute('href'), dom.window.location.href);
            assert.ok(fs.existsSync(path.join(dev, target.pathname.slice('/dev/'.length))), `Missing asset: ${target}`);
        }
        dom.window.close();
    }
});
console.log(`\n${passed} mock preview groups passed. No browser pixels, touch or live provider verification is claimed.`);
