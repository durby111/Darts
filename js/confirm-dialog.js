/** Shared app-owned confirmations. Text is never interpreted as markup.
 * Only one request may be open: a second caller is canceled, never queued or
 * attached to the first caller's approval. Owners must recheck their state after
 * awaiting, and abort when that state becomes obsolete.
 */
let active = null;
let serial = 0;

export function cancelConfirmation({ restoreFocus = true } = {}) {
    active?.finish(false, restoreFocus);
}

export function confirmDialog(message, {
    title = 'Confirm action', confirmLabel = 'Continue', cancelLabel = 'Cancel', signal,
} = {}) {
    if (active || signal?.aborted) return Promise.resolve(false);
    const doc = document;
    const returnTo = doc.activeElement;
    const host = doc.createElement('div');
    host.className = 'platform-confirm-host';
    const dialog = doc.createElement('dialog');
    dialog.className = 'platform-confirm';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('data-opening', '');
    const panel = doc.createElement('div');
    panel.className = 'platform-confirm-panel';
    const element = (tag, text, className) => {
        const node = doc.createElement(tag);
        node.textContent = String(text);
        node.className = className;
        return node;
    };
    const button = (label, className) => {
        const node = element('button', label, className);
        node.type = 'button';
        return node;
    };
    const close = button('Close', 'platform-confirm-close');
    close.setAttribute('aria-label', 'Close confirmation');
    const heading = element('h2', title, 'platform-confirm-title');
    const description = element('p', message, 'platform-confirm-message');
    const key = ++serial;
    heading.id = `platform-confirm-title-${key}`;
    description.id = `platform-confirm-message-${key}`;
    dialog.setAttribute('aria-labelledby', heading.id);
    dialog.setAttribute('aria-describedby', description.id);
    const actions = element('div', '', 'platform-confirm-actions');
    const cancel = button(cancelLabel, 'platform-confirm-cancel');
    cancel.autofocus = true;
    const confirm = button(confirmLabel, 'platform-confirm-accept');
    actions.append(cancel, confirm);
    panel.append(close, heading, description, actions);
    dialog.append(panel);
    host.append(dialog);
    doc.body.append(host);
    // Explicit inert/ARIA isolation also supports browsers without showModal.
    const background = [...doc.body.children].filter(node => node !== host).map(node => ({
        node, inert: node.getAttribute('inert'), hidden: node.getAttribute('aria-hidden'),
    }));
    for (const { node } of background) {
        node.setAttribute('inert', '');
        node.setAttribute('aria-hidden', 'true');
    }
    const overflow = doc.body.style.overflow;
    doc.body.style.overflow = 'hidden';
    return new Promise(resolve => {
        let settled = false;
        const openingTimer = setTimeout(() => dialog.removeAttribute('data-opening'), 300);
        const finish = (approved, restoreFocus = true) => {
            if (settled) return;
            settled = true;
            clearTimeout(openingTimer);
            doc.removeEventListener('keydown', onKeydown, true);
            doc.removeEventListener('focusin', onFocus, true);
            window.removeEventListener('pagehide', onNavigate);
            window.removeEventListener('popstate', onNavigate);
            window.removeEventListener('hashchange', onNavigate);
            signal?.removeEventListener('abort', onAbort);
            // Remove listeners first: close() emits a separate close event.
            dialog.removeEventListener('close', onClose);
            dialog.removeEventListener('cancel', onCancel);
            if (typeof dialog.close === 'function' && dialog.open) dialog.close();
            host.remove();
            for (const { node, inert, hidden } of background) {
                if (inert === null) node.removeAttribute('inert'); else node.setAttribute('inert', inert);
                if (hidden === null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', hidden);
            }
            doc.body.style.overflow = overflow;
            active = null;
            if (restoreFocus && returnTo?.isConnected && !returnTo.disabled
                && !returnTo.closest('[hidden], [inert], [aria-hidden="true"]')) {
                returnTo.focus({ preventScroll: true });
            }
            resolve(approved);
        };
        const onCancel = event => { event.preventDefault(); finish(false); };
        const onClose = () => finish(false);
        const onNavigate = () => finish(false, false);
        const onAbort = () => finish(false, false);
        const onFocus = event => {
            if (!dialog.contains(event.target)) cancel.focus({ preventScroll: true });
        };
        const onKeydown = event => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                finish(false);
            } else if (event.key === 'Tab') {
                const buttons = [close, cancel, confirm];
                const index = buttons.indexOf(doc.activeElement);
                if (index < 0 || (event.shiftKey && index === 0) || (!event.shiftKey && index === buttons.length - 1)) {
                    event.preventDefault();
                    (event.shiftKey ? confirm : close).focus();
                }
            }
        };
        active = { finish };
        close.addEventListener('click', () => finish(false));
        cancel.addEventListener('click', () => finish(false));
        confirm.addEventListener('click', () => finish(true));
        dialog.addEventListener('cancel', onCancel);
        dialog.addEventListener('close', onClose);
        doc.addEventListener('keydown', onKeydown, true);
        doc.addEventListener('focusin', onFocus, true);
        window.addEventListener('pagehide', onNavigate);
        window.addEventListener('popstate', onNavigate);
        window.addEventListener('hashchange', onNavigate);
        signal?.addEventListener('abort', onAbort, { once: true });
        try {
            if (typeof dialog.showModal === 'function') dialog.showModal();
            else {
                host.classList.add('platform-confirm-fallback');
                dialog.setAttribute('open', '');
            }
            cancel.focus({ preventScroll: true });
        } catch {
            // A failed modal must never silently approve or invoke native confirm.
            finish(false);
        }
    });
}
