/** Local DOM checks of the real module, including its no-showModal fallback.
 * Run with node --experimental-vm-modules. Set BLAKEOUT_JSDOM_MODULE to an
 * existing jsdom install. No browser, network, provider or rendered-layout proof.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const { JSDOM } = createRequire(import.meta.url)(process.env.BLAKEOUT_JSDOM_MODULE || 'jsdom');
const code = fs.readFileSync(new URL('../js/confirm-dialog.js', import.meta.url), 'utf8');
let passed = 0;
for (const native of [false, true]) {
    const dom = new JSDOM('<!doctype html><body style="overflow: auto"><main><button id="opener">Start</button></main><aside inert aria-hidden="false">Previously inert</aside></body>', {
        runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window, doc = w.document;
    // JSDOM has no browser top layer. Exercise the native branch with only those
    // two missing UA methods supplied; all app listeners and promises are real.
    if (native) {
        w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
        w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
    }
    const module = new vm.SourceTextModule(code, { context: dom.getInternalVMContext() });
    await module.link(() => { throw Error('Unexpected dependency'); });
    await module.evaluate();
    const { confirmDialog, cancelConfirmation } = module.namespace;
    const opener = doc.getElementById('opener');
    const get = cls => doc.querySelector(`.platform-confirm-${cls}`);
    const open = message => { opener.focus(); return confirmDialog(message); };
    const clean = () => {
        assert.equal(doc.querySelector('.platform-confirm-host'), null);
        assert.equal(doc.body.style.overflow, 'auto');
        assert.equal(doc.querySelector('main').hasAttribute('inert'), false);
        assert.equal(doc.querySelector('main').hasAttribute('aria-hidden'), false);
        assert.equal(doc.querySelector('aside').getAttribute('inert'), '');
        assert.equal(doc.querySelector('aside').getAttribute('aria-hidden'), 'false');
    };
    try {
        const malicious = '<img src=x onerror=alert(1)> & "quoted"';
        let pending = open(malicious), settled = false;
        pending.then(() => { settled = true; });
        await Promise.resolve();
        assert.equal(settled, false, 'Real confirmation stays pending until explicit action');
        assert.equal(get('message').textContent, malicious);
        assert.equal(doc.querySelector('img'), null);
        assert.equal(doc.activeElement, get('cancel'));
        const dialog = doc.querySelector('dialog');
        assert.equal(dialog.getAttribute('aria-modal'), 'true');
        assert.equal(doc.getElementById(dialog.getAttribute('aria-labelledby')).textContent, 'Confirm action');
        assert.equal(doc.getElementById(dialog.getAttribute('aria-describedby')).textContent, malicious);
        assert.equal(doc.querySelector('main').getAttribute('inert'), '');
        assert.equal(await confirmDialog('A second action'), false);
        assert.equal(doc.querySelectorAll('dialog').length, 1);
        get('accept').click();
        get('cancel')?.click();
        assert.equal(await pending, true);
        clean();
        assert.equal(doc.activeElement, opener);
        passed++; console.log(`PASS ${native ? 'native shim' : 'fallback'} pending, duplicate, safe text, names and accept`);

        for (const dismissal of ['cancel', 'close', 'escape', 'native-cancel', 'native-close', 'explicit']) {
            pending = open('Cancel me');
            if (dismissal === 'escape') doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
            else if (dismissal === 'native-cancel') doc.querySelector('dialog').dispatchEvent(new w.Event('cancel', { cancelable: true }));
            else if (dismissal === 'native-close') doc.querySelector('dialog').dispatchEvent(new w.Event('close'));
            else if (dismissal === 'explicit') cancelConfirmation();
            else get(dismissal).click();
            assert.equal(await pending, false);
            clean();
            assert.equal(doc.activeElement, opener);
        }
        pending = open('Keyboard containment');
        get('accept').focus();
        doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
        assert.equal(doc.activeElement, get('close'));
        doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
        assert.equal(doc.activeElement, get('accept'));
        opener.focus();
        assert.equal(doc.activeElement, get('cancel'));
        cancelConfirmation();
        assert.equal(await pending, false);
        clean();
        passed++; console.log(`PASS ${native ? 'native shim' : 'fallback'} dismissals, tab containment, background focus and cleanup`);

        for (const interruption of ['abort', 'pagehide', 'popstate', 'hashchange']) {
            const controller = new w.AbortController();
            opener.focus();
            pending = confirmDialog('Private confirmation wording', { signal: controller.signal });
            if (interruption === 'abort') controller.abort();
            else w.dispatchEvent(new w.Event(interruption));
            assert.equal(await pending, false);
            assert.ok(!doc.body.textContent.includes('Private confirmation wording'));
            clean();
        }
        const controller = new w.AbortController();
        controller.abort();
        assert.equal(await confirmDialog('Must never open', { signal: controller.signal }), false);
        clean();
        for (let i = 0; i < 5; i++) {
            pending = open('Repeated');
            get('cancel').click();
            assert.equal(await pending, false);
            clean();
        }
        opener.focus();
        assert.equal(doc.activeElement, opener, 'No leaked focus-trap listeners');
        w.HTMLDialogElement.prototype.showModal = function () { throw Error('Top layer unavailable'); };
        assert.equal(await open('Must fail closed'), false);
        clean();
        passed++; console.log(`PASS ${native ? 'native shim' : 'fallback'} interruption, failed showModal and repeated lifecycle cleanup`);
    } finally { w.close(); }
}
console.log(`${passed}/${passed} shared confirmation DOM groups passed; browser rendering and assistive technology remain unverified`);
