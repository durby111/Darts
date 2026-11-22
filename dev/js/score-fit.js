// Presentation only: keep short DC scores big without clipping longer totals.
export function initDcScoreFit(header = document.getElementById('scoreHeader')) {
    if (!header) return;
    const scores = header.querySelectorAll('.score-big');
    const sync = (score) => {
        const text = score.textContent.trim();
        const match = /^([+\-−]?)(\d+)$/.exec(text);
        // Tabular Arial-family digits are about 0.56em. Reserve headroom
        // for font fallbacks, the optional sign, and browser rounding.
        const units = match
            ? 0.62 * match[2].length + (match[1] ? 0.65 : 0) + 0.14
            : Math.max(2.85, [...text].length * 0.75);
        score.style.setProperty('--dc-score-fit-units', units.toFixed(2));
    };
    const observer = new MutationObserver((records) => {
        const changed = new Set(records.map(({ target }) =>
            target.nodeType === 1 ? target : target.parentElement
        ));
        for (const score of scores) {
            if (changed.has(score) || [...changed].some((node) => score.contains(node))) sync(score);
        }
    });
    for (const score of scores) {
        sync(score);
        observer.observe(score, { childList: true, characterData: true, subtree: true });
    }
}
