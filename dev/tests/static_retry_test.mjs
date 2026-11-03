// Exercise the actual worker fetch handler; no network or browser storage.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let groups = 0;
for (const build of ['', 'dev/']) {
    const base = `https://example.test/${build}`;
    async function run(relative, responses, { method = 'GET' } = {}) {
        const handlers = {}, requests = [], writes = [], reads = [];
        const cache = {
            put: async (request, response) => writes.push([request.url, response.status]),
            match: async request => { reads.push(request.url); return new Response('older cached module'); }
        };
        const context = vm.createContext({ URL, Request, Response, Set,
            setTimeout: callback => callback(),
            self: { location: new URL('sw.js', base), addEventListener: (event, fn) => { handlers[event] = fn; } },
            caches: { open: async () => cache },
            fetch: async request => {
                requests.push(request);
                assert.ok(responses.length, 'retry must be bounded');
                const result = responses.shift();
                if (result === 'disconnect') throw new TypeError('network unavailable');
                return new Response(result === 200 ? 'current network module' : 'HTTP failure', { status: result });
            }
        });
        vm.runInContext(fs.readFileSync(new URL(`../../${build}sw.js`, import.meta.url), 'utf8'), context);
        const request = new Request(new URL(relative, base), { method, credentials: 'same-origin' });
        let promise;
        handlers.fetch({ request, respondWith: value => { promise = value; } });
        const response = await promise;
        await Promise.resolve();
        return { response, requests, reads, writes };
    }
    for (const status of [404, 502, 503, 504]) {
        const recovered = await run('js/registry.js', [status, 200]);
        assert.equal(recovered.requests.length, 2);
        assert.equal(recovered.requests[1].cache, 'reload');
        assert.equal(recovered.requests[1].credentials, recovered.requests[0].credentials);
        assert.equal(await recovered.response.text(), 'current network module');
        assert.deepEqual(recovered.reads, []);
        assert.equal(recovered.writes.length, 1);
        const persistent = await run('js/registry.js', [status, status]);
        assert.equal(persistent.requests.length, 2);
        assert.equal(persistent.response.status, status);
        assert.deepEqual(persistent.reads, []);
        assert.deepEqual(persistent.writes, []);
        groups++;
    }
    for (const status of [401, 403, 429, 500]) {
        const result = await run('js/registry.js', [status]);
        assert.equal(result.requests.length, 1);
        assert.equal(result.response.status, status);
        assert.deepEqual(result.reads, []);
        assert.deepEqual(result.writes, []);
        groups++;
    }
    for (const relative of ['api/account', 'accounts/', 'js/not-precached.js',
        'js/registry.js?oobCode=fixture', 'js/registry.js?apiKey=fixture',
        'js/registry.js?v=other', 'https://other.test/js/registry.js',
        build ? '../js/registry.js' : 'dev/js/registry.js']) {
        const result = await run(relative, [503]);
        assert.equal(result.requests.length, 1, relative);
        assert.equal(result.response.status, 503);
        assert.deepEqual(result.reads, []);
        groups++;
    }
    const post = await run('api/account', [503], { method: 'POST' });
    assert.equal(post.requests.length, 1);
    assert.equal(post.requests[0].method, 'POST');
    const disconnect = await run('js/registry.js', [503, 'disconnect']);
    assert.equal(disconnect.requests.length, 2);
    assert.equal(disconnect.response.status, 503);
    assert.deepEqual(disconnect.reads, []);
    const authRetry = await run('js/registry.js', [503, 403]);
    assert.equal(authRetry.response.status, 403);
    assert.deepEqual(authRetry.reads, []);
    const offline = await run('js/registry.js', ['disconnect']);
    assert.equal(offline.requests.length, 1);
    assert.equal(await offline.response.text(), 'older cached module');
    assert.equal(offline.reads.length, 1);
    groups += 4;
    console.log(`PASS ${build || 'production/'} transient/persistent statuses, authorization, query/backend/scope exclusions, bounded retry and original offline behavior`);
}
console.log(`PASS ${groups} worker regression groups`);
