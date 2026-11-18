// An in-page modal: browser focus trapping and Escape handling, no native
// window.confirm. Closing or navigating away always declines the action.
let active = false;
export function confirmAction(message, { title = 'Confirm action', confirmLabel = 'Continue' } = {}) {
    if (active) return Promise.resolve(false);
    const dialog = document.createElement('dialog');
    if (typeof dialog.showModal !== 'function') return Promise.resolve(false);
    active = true;
    const previousFocus = document.activeElement;
    dialog.className = 'modal-content';
    dialog.setAttribute('aria-labelledby', 'actionConfirmTitle');
    dialog.setAttribute('aria-describedby', 'actionConfirmMessage');
    dialog.setAttribute('aria-modal', 'true');
    // Existing theme tokens and button styles keep this in the scorer theme.
    dialog.style.cssText = 'position:fixed;inset:0;margin:auto;box-sizing:border-box;width:min(92vw,32rem);max-height:85dvh;overflow:auto;background:var(--color-bg,#171717);color:var(--color-text,#fff);border:2px solid var(--color-primary,#e9b949);border-radius:16px;padding:24px;';
    const heading = document.createElement('h2');
    heading.id = 'actionConfirmTitle'; heading.textContent = title;
    const description = document.createElement('p');
    description.id = 'actionConfirmMessage'; description.textContent = message;
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:12px;margin-top:20px;';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.className = 'btn'; cancel.textContent = 'Cancel';
    const accept = document.createElement('button');
    accept.type = 'button'; accept.className = 'btn'; accept.textContent = confirmLabel;
    actions.append(cancel, accept); dialog.append(heading, description, actions);
    return new Promise(resolve => {
        let settled = false;
        const finish = accepted => {
            if (settled) return;
            settled = true;
            window.removeEventListener('pagehide', onPageHide);
            if (dialog.open) dialog.close();
            dialog.remove(); active = false;
            if (previousFocus?.isConnected) previousFocus.focus();
            resolve(accepted);
        };
        const onPageHide = () => finish(false);
        cancel.addEventListener('click', () => finish(false));
        accept.addEventListener('click', () => finish(true));
        dialog.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            if (event.shiftKey && document.activeElement === cancel) {
                event.preventDefault(); accept.focus();
            } else if (!event.shiftKey && document.activeElement === accept) {
                event.preventDefault(); cancel.focus();
            }
        });
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
        dialog.addEventListener('close', () => finish(false));
        window.addEventListener('pagehide', onPageHide);
        try { document.body.append(dialog); dialog.showModal(); cancel.focus(); }
        catch { finish(false); }
    });
}
