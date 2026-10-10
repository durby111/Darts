import * as availability from './feature-availability.js';

const base = new URL('../', import.meta.url);
const nav = document.createElement('nav');
nav.className = 'dev-app-nav';
nav.setAttribute('aria-label', 'BlakeOut apps');
for (const [label, path, feature] of [
    ['Scoring', './', null],
    ['Brackets', 'brackets/', 'brackets'],
    ['Players & Records', 'accounts/', 'accounts']
]) {
    const testPath = feature && !availability.isFeatureAvailable(feature) ? availability.featureTestPath?.(feature) : null;
    const locked = feature && !availability.isFeatureAvailable(feature) && !testPath;
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
        badge.textContent = 'Unavailable';
        item.append(badge);
    } else {
        item.href = new URL(testPath || path, base).href;
        if (testPath) {
            item.dataset.appFeature = feature;
            item.title = 'Interactive DEV test with sample data; nothing is saved or sent.';
            const badge = document.createElement('span');
            badge.className = 'feature-test-badge';
            badge.textContent = 'Sample';
            item.append(badge);
        }
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
