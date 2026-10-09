/** NodeVM/JSDOM harness: actual feature/page/dialog modules, mocked platform only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { JSDOM } = require(process.env.BLAKEOUT_JSDOM_MODULE || 'jsdom');
const root = fileURLToPath(new URL('../', import.meta.url));
// Share the browser suite's current mock so payment and revision fixtures agree.
const suite = fs.readFileSync(new URL('./brackets_ui_test.py', import.meta.url), 'utf8');
const mock = suite.match(/^MOCK_PLATFORM = """\n([\s\S]*?)\n"""/m)?.[1];
assert.ok(mock, 'The browser suite must expose its platform fixture');
const featureHelpers = fs.readFileSync(new URL('./feature_test_helpers.py', import.meta.url), 'utf8');
const enabledFeatures = featureHelpers.match(/ENABLED_FEATURE_MODULE = '''([\s\S]*?)'''/)?.[1];
assert.ok(enabledFeatures, 'Use the same test-only feature fixture as browser checks');

export async function fresh({ enabled = true, autoConfirm = true } = {}) {
    const dom = new JSDOM(fs.readFileSync(path.join(root, 'brackets/index.html'), 'utf8'), {
        url: 'http://localhost/brackets/?id=demo', runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window;
    const ctx = dom.getInternalVMContext();
    Object.assign(w, {
        structuredClone, ResizeObserver: class { observe() {} },
        confirm: () => { throw Error('Native confirm must never be used'); },
        fetch: () => { throw Error('External requests are forbidden in this test'); },
    });
    w.confirmations = 0;
    w.confirmResult = true;
    const confirmationObserver = new w.MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType === 1 && node.matches('.platform-confirm-host')) w.confirmations++;
        }
    });
    confirmationObserver.observe(w.document.body, { childList: true });
    w.HTMLElement.prototype.scrollIntoView = function () {};
    const modules = new Map();
    async function load(filename) {
        if (modules.has(filename)) return modules.get(filename);
        const code = filename.endsWith('/js/platform.js') ? mock
            : enabled && filename.endsWith('/js/feature-availability.js') ? enabledFeatures
                : fs.readFileSync(filename, 'utf8');
        const resolve = specifier => specifier.startsWith('/') ? path.join(root, specifier)
            : path.resolve(path.dirname(filename), specifier);
        const module = new vm.SourceTextModule(code, {
            context: ctx, identifier: filename,
            initializeImportMeta: meta => { meta.url = pathToFileURL(filename).href; },
            importModuleDynamically: async specifier => {
                const imported = await load(resolve(specifier));
                if (imported.status === 'linked') await imported.evaluate();
                return imported;
            },
        });
        modules.set(filename, module);
        await module.link(specifier => load(resolve(specifier)));
        return module;
    }
    await (await load(path.join(root, 'js/feature-page.js'))).evaluate();
    const get = id => w.document.getElementById(id);
    const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
    if (enabled) {
        for (let i = 0; i < 50 && (!get('message')?.textContent.includes('Cloud connected') || get('refresh').disabled); i++) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        assert.match(get('message').textContent, /Cloud connected/);
    } else await settle();
    const input = (selector, value) => {
        const element = w.document.querySelector(selector);
        if (element.type === 'checkbox') {
            element.checked = value;
            element.dispatchEvent(new w.Event('change', { bubbles: true }));
        } else {
            element.value = value;
            element.dispatchEvent(new w.Event('input', { bubbles: true }));
        }
    };
    const respond = async (answer = w.confirmResult) => {
        const dialog = w.document.querySelector('dialog.platform-confirm');
        assert.ok(dialog, 'An actual app confirmation must be open before responding');
        dialog.querySelector(answer ? '.platform-confirm-accept' : '.platform-confirm-cancel').click();
        await settle();
    };
    const click = async id => {
        get(id).click();
        await settle();
        if (autoConfirm && w.document.querySelector('dialog.platform-confirm')) await respond();
    };
    const refresh = async options => {
        await modules.get(path.join(root, 'js/brackets/page.js')).namespace.refreshSelected(options);
        await settle();
    };
    return { dom, w, get, input, click, settle, refresh, modules, respond };
}
