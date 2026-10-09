import { isFeatureAvailable } from './feature-availability.js';

const base = new URL('../', import.meta.url);
const nav = document.createElement('nav');
nav.className = 'dev-app-nav';
nav.setAttribute('aria-label', 'BlakeOut apps');
for (const [label, path, feature] of [
    ['Scoring', './', null],
    ['Brackets', 'brackets/', 'brackets'],
    ['Players & Records', 'accounts/', 'accounts']
]) {
    const locked = feature && !isFeatureAvailable(feature);
    // Native disabled buttons have no link target and remain disabled after
    // cloneNode into Game Menu (event-only anchor guards would not survive).
    const item = document.createElement(locked ? 'button' : 'a');
    item.textContent = label;
    if (locked) {
        item.type = 'button';
        item.disabled = true;
        item.dataset.appFeature = feature;
        item.className = 'feature-nav-disabled';
        const badge = document.createElement('span');
        badge.className = 'feature-coming-soon-badge';
        badge.textContent = 'Coming soon';
        item.append(badge);
    } else {
        item.href = new URL(path, base).href;
        if (path === './') item.setAttribute('aria-current', 'page');
    }
    nav.append(item);
}
const setup = document.querySelector('.setup-header');
if (setup) setup.after(nav);
const gameNav = nav.cloneNode(true);
gameNav.classList.add('dev-game-nav');
const gameMenu = document.querySelector('#gameMenuModal .modal-content');
if (gameMenu) gameMenu.append(gameNav);
