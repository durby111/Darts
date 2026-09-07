const base = new URL('../', import.meta.url);
const nav = document.createElement('nav');
nav.className = 'dev-app-nav';
nav.setAttribute('aria-label', 'Blake Out apps');
for (const [label, path] of [['Scoring', './'], ['Brackets', 'brackets/'], ['Players & Records', 'accounts/']]) {
    const link = document.createElement('a');
    link.href = new URL(path, base).href;
    link.textContent = label;
    if (path === './') link.setAttribute('aria-current', 'page');
    nav.append(link);
}
const setup = document.querySelector('.setup-header');
if (setup) setup.after(nav);
const gameNav = nav.cloneNode(true);
gameNav.classList.add('dev-game-nav');
const gameMenu = document.querySelector('#gameMenuModal .modal-content');
if (gameMenu) gameMenu.append(gameNav);
