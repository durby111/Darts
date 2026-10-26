import { createSharedPlayerAuth } from './shared-player-auth.js';

let active = false;
export function requestSharedPlayer(document, { create = createSharedPlayerAuth, signal } = {}) {
    if (active || signal?.aborted) return Promise.resolve(null);
    const dialog = document.createElement('dialog');
    if (typeof dialog.showModal !== 'function') return Promise.reject(new Error('Player sign-in requires dialog support.'));
    active = true;
    dialog.className = 'shared-player-dialog';
    dialog.setAttribute('aria-labelledby', 'sharedPlayerTitle');
    dialog.innerHTML = '<h2 id="sharedPlayerTitle">Add your player account</h2>' +
        '<p>Hand the device to this player. Sign in with your own BlakeOut account, then confirm your name. This app does not save your password. The owner stays signed in.</p>' +
        '<form><label>Your email<input name="email" type="email" autocomplete="off" required maxlength="254"></label>' +
        '<label>Your password<input name="password" type="password" autocomplete="off" required></label>' +
        '<button type="submit">Verify my account</button></form>' +
        '<section hidden><p class="shared-player-identity"></p><label>Name on this device<input name="playerName" maxlength="40" required></label>' +
        '<label><input name="consent" type="checkbox"> I am this player and agree to use my player identity for this visit. This does not share my private history.</label>' +
        '<button type="button" class="shared-player-confirm" disabled>Add me for this visit</button></section>' +
        '<p role="status" aria-live="polite"></p><button type="button" class="shared-player-cancel">Cancel</button>';
    const form = dialog.querySelector('form'), section = dialog.querySelector('section');
    const email = form.elements.email, password = form.elements.password;
    const name = dialog.querySelector('[name=playerName]'), consent = dialog.querySelector('[name=consent]');
    const confirm = dialog.querySelector('.shared-player-confirm'), status = dialog.querySelector('[role=status]');
    const focus = document.activeElement;
    let adapter, identity, canceled = false, finished = false, work;
    return new Promise(resolve => {
        const finish = async value => {
            if (finished) return;
            finished = true; canceled = true;
            password.value = ''; email.value = ''; name.value = ''; consent.checked = false;
            dialog.querySelector('.shared-player-identity').textContent = '';
            signal?.removeEventListener('abort', cancel);
            document.defaultView.removeEventListener('pagehide', cancel);
            if (dialog.open) dialog.close(); dialog.remove();
            if (focus?.isConnected) focus.focus();
            try { await work; await adapter?.close(); }
            catch { value = null; }
            finally { identity = null; active = false; resolve(value); }
        };
        const cancel = () => { void finish(null); };
        signal?.addEventListener('abort', cancel, { once: true });
        document.defaultView.addEventListener('pagehide', cancel, { once: true });
        dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
        dialog.addEventListener('close', cancel);
        dialog.querySelector('.shared-player-cancel').onclick = cancel;
        consent.onchange = () => { confirm.disabled = !identity || !consent.checked; };
        confirm.onclick = () => {
            const label = name.value.trim();
            if (!identity || !consent.checked || !label || label.length > 40 || finished) return;
            if (!Number.isFinite(identity.expiresAt) || Date.now() >= identity.expiresAt) { status.textContent = 'Sign-in expired. Cancel and verify again.'; confirm.disabled = true; return; }
            void finish({ id: identity.id, name: label });
        };
        form.onsubmit = event => {
            event.preventDefault(); if (work || finished) return;
            if (!form.reportValidity()) return;
            const address = email.value.trim(), secret = password.value;
            password.value = ''; form.querySelector('button').disabled = true;
            status.textContent = 'Verifying your account…';
            work = (async () => {
                try {
                    adapter = await create();
                    if (canceled) return;
                    const result = await adapter.signIn(address, secret);
                    if (canceled) return;
                    // Close authentication before retaining non-secret participation labels.
                    await adapter.close();
                    if (canceled) return;
                    identity = result;
                    email.value = ''; form.hidden = true; section.hidden = false;
                    dialog.querySelector('.shared-player-identity').textContent = `Verified: ${result.email} · Player ID ${result.id}`;
                    name.value = result.name; name.focus(); status.textContent = 'Review your identity and confirm. Nothing has been added yet.';
                } catch {
                    status.textContent = 'Could not verify this player. Check your sign-in and verified email, then cancel and try again. No player was added.';
                } finally {
                    if (!identity) { try { await adapter?.close(); } catch {} }
                }
            })();
        };
        try { document.body.append(dialog); dialog.showModal(); email.focus(); }
        catch { void finish(null); }
    });
}
