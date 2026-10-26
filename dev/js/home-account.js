import { isFeatureAvailable } from './feature-availability.js';
import { requestSharedPlayer } from './shared-player-dialog.js';
import { createPlayerVisit } from './shared-player-list.js';

// A named account session, separate from the scorer's anonymous device identity.
// Additional player sign-in is explicit; no enrollment or game/history writes.
export async function mountHomeAccount(document, load = () => import('./platform.js'), requestPlayer = requestSharedPlayer) {
    const link = document.getElementById('homeAccountLink');
    if (!link || !isFeatureAvailable('accounts')) return () => {};
    const panel = document.createElement('details');
    panel.className = 'home-player-help';
    const title = document.createElement('summary');
    title.textContent = 'Players on this device';
    const description = document.createElement('p');
    description.textContent = 'Add names in the player setup to play as guests. For account-linked games, choose verified player profiles when you start. Selecting a profile does not sign that person in or grant access to their private records.';
    const status = document.createElement('p');
    status.setAttribute('role', 'status');
    status.textContent = 'Checking your account. Guest scoring remains available.';
    const choose = document.createElement('button');
    choose.type = 'button'; choose.className = 'btn btn--md btn--neutral';
    choose.textContent = 'Set up verified players'; choose.disabled = true;
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn btn--md btn--neutral'; add.textContent = 'Add player account'; add.disabled = true;
    const list = document.createElement('ul'); list.setAttribute('aria-label', 'Players verified for this visit');
    const hint = document.createElement('p');
    hint.textContent = 'Additional players verify their own accounts. This visit list clears on leaving, changing the game or changing the owner. It does not save passwords or give access to anyone’s private history. Use the player IDs when choosing recorded-game links.';
    panel.append(title, description, status, choose, add, hint, list);
    document.querySelector('.setup-header')?.after(panel);
    const visit = createPlayerVisit();
    let current = null, ownerKey = null, disposed = false, unsubscribe = () => {}, pending = null, api;
    const drawPlayers = () => {
        list.replaceChildren();
        for (const player of visit.list()) {
            const row = document.createElement('li'), remove = document.createElement('button');
            row.append(document.createTextNode(`${player.name} · ID ${player.id} · verified this visit `));
            remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', `Remove ${player.name}`);
            remove.onclick = () => { visit.remove(player.id); drawPlayers(); }; row.append(remove); list.append(row);
        }
    };
    const clearPlayers = () => { pending?.abort(); visit.clear(); drawPlayers(); };
    const onPageHide = () => { clearPlayers(); render(null); };
    const onPageShow = () => { if (api?.getAccount) render(api.getAccount()); };
    document.defaultView.addEventListener('pagehide', onPageHide);
    document.defaultView.addEventListener('pageshow', onPageShow);
    const gameType = document.getElementById('gameType');
    gameType?.addEventListener('change', clearPlayers);
    const render = user => {
        if (disposed) return;
        const next = user && !user.isAnonymous ? user : null;
        const nextKey = next?.emailVerified ? next.uid : null;
        if (ownerKey !== nextKey) clearPlayers();
        ownerKey = nextKey;
        current = next;
        visit.setOwner(current?.emailVerified ? current.uid : null);
        link.textContent = current ? 'My account' : 'Login';
        link.title = current ? 'Manage your signed-in account' : 'Sign in to your account';
        choose.disabled = !current?.emailVerified;
        add.disabled = !current?.emailVerified || !!pending;
        status.textContent = !current ? 'Login to use verified profiles. Everyone can still play as a guest.'
            : !current.emailVerified ? 'Verify your email on My account before linking player profiles.'
            : 'Your account is signed in. Available profiles still depend on your existing DEV permissions. Other players must verify their own accounts; do not share passwords.';
    };
    add.onclick = async () => {
        if (!current?.emailVerified || pending || disposed) return;
        const owner = current.uid, attempt = new document.defaultView.AbortController();
        pending = attempt; add.disabled = true;
        try {
            const player = await requestPlayer(document, { signal: attempt.signal });
            const actual = api?.getAccount ? api.getAccount() : current;
            if (disposed || attempt.signal.aborted || !actual?.emailVerified || actual.uid !== owner) return;
            if (player && visit.add(player, owner)) { drawPlayers(); status.textContent = 'Player verified for this visit. No game or private history was changed.'; }
        } catch { if (!disposed && !attempt.signal.aborted) status.textContent = 'Player sign-in is unavailable. Guest scoring is still available.'; }
        finally { if (pending === attempt) pending = null; if (!disposed) add.disabled = !current?.emailVerified; }
    };
    choose.addEventListener('click', () => {
        if (!current?.emailVerified) return;
        const toggle = document.getElementById('recordCasualStats');
        if (!toggle || toggle.disabled) {
            status.textContent = 'Recorded player setup is unavailable. Guest scoring remains available.';
            return;
        }
        toggle.checked = true;
        toggle.dispatchEvent(new document.defaultView.Event('change', { bubbles: true }));
        toggle.focus();
        toggle.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
        status.textContent = 'Add your player names, then Start Game to choose verified profile links. No game has been started and no profiles have been linked yet.';
    });
    try {
        api = await load();
        await api.initPlatform();
        if (!disposed) unsubscribe = api.subscribeAccount(render);
    } catch {
        render(null);
        status.textContent = 'Account connection unavailable. You can retry on Login or keep scoring as guests.';
    }
    return () => { disposed = true; clearPlayers(); unsubscribe(); document.defaultView.removeEventListener('pagehide', onPageHide); document.defaultView.removeEventListener('pageshow', onPageShow); gameType?.removeEventListener('change', clearPlayers); panel.remove(); };
}

if (typeof document !== 'undefined' && document.body?.classList.contains('dev-build')) mountHomeAccount(document);
