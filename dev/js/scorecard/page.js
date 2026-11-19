// Scorecard reader page — DEV only. Local processing; no uploads; no tracker writes.
import '../feature-appearance.js';
import {
    STATUS, HEADER_FIELDS, GAME_FIELDS, createDraft, draftFromTextLines, setField, confirmField, markBlank,
    addGame, removeGame, dismissUnparsed, openFlags, consistencyWarnings, markReviewed, exportDraft, isDraft,
} from './draft.js';
import { detectorAvailable, detectLines } from './extract.js';
import { SAMPLE_LINES, drawSampleCard } from './sample.js';

// Draft text only. The photo is held in memory for this page view and is never stored.
export const DRAFT_KEY = 'blakeout_dev_scorecard_draft_v1';
const $ = id => document.getElementById(id);
const STATUS_TEXT = {
    [STATUS.EMPTY]: '⚠ Missing', [STATUS.EXTRACTED]: '⚑ Check', [STATUS.UNCERTAIN]: '⚠ Uncertain',
    [STATUS.ENTERED]: '✓ Entered', [STATUS.CONFIRMED]: '✓ Confirmed', [STATUS.BLANK]: '✓ Blank on card',
};
let draft = null, photoFile = null, photoURL = null;

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function note(text) { $('extractNote').textContent = text; }

function persist() {
    try {
        if (draft) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        else localStorage.removeItem(DRAFT_KEY);
    } catch { $('reviewStatus').textContent = 'This draft could not be saved in browser storage. Keep this page open until you finish.'; }
}

function apply(change) {
    try { draft = change(draft); persist(); render(); }
    catch (error) { $('reviewStatus').textContent = error.message; }
}

function fieldRow(path, label, field) {
    const id = `f-${path.game || 'card'}-${path.key}`;
    const row = el('div', `scorecard-field status-${field.status}`);
    row.dataset.status = field.status;
    row.dataset.field = id;
    const caption = el('label', '', label);
    caption.htmlFor = id;
    let input;
    if (path.key === 'winner') {
        input = el('select');
        for (const [value, text] of [['', 'Not set'], ['home', 'Home'], ['away', 'Away']]) input.append(new Option(text, value));
        input.value = field.value;
    } else {
        input = el('input');
        input.value = field.value;
        input.maxLength = 80;
        input.autocomplete = 'off';
        if (/Score|Total/.test(path.key)) input.inputMode = 'numeric';
    }
    input.id = id;
    input.addEventListener('change', () => {
        // Defer so the control the person moved to can be found and refocused.
        setTimeout(() => {
            const next = document.activeElement?.id || null;
            apply(current => setField(current, path, input.value));
            if (next) document.getElementById(next)?.focus();
        }, 0);
    });
    const chip = el('span', 'scorecard-chip', STATUS_TEXT[field.status]);
    row.append(caption, input, chip);
    const actions = el('div', 'scorecard-field-actions');
    if ([STATUS.EXTRACTED, STATUS.UNCERTAIN].includes(field.status)) {
        const confirm = el('button', '', 'Matches the card');
        confirm.type = 'button'; confirm.dataset.action = 'confirm';
        confirm.addEventListener('click', () => apply(current => confirmField(current, path)));
        actions.append(confirm);
    }
    if (field.status !== STATUS.BLANK && [STATUS.EMPTY, STATUS.EXTRACTED, STATUS.UNCERTAIN].includes(field.status)) {
        const blank = el('button', '', 'Blank on the card');
        blank.type = 'button'; blank.dataset.action = 'blank';
        blank.addEventListener('click', () => apply(current => markBlank(current, path)));
        actions.append(blank);
    }
    if (actions.childElementCount) row.append(actions);
    if (field.reason) row.append(el('p', 'scorecard-reason', field.reason));
    return row;
}

function render() {
    const active = !!draft;
    $('draftPanel').hidden = !active;
    $('reviewPanel').hidden = !active;
    if (!active) return;
    const header = $('headerFields');
    header.replaceChildren(...HEADER_FIELDS.map(([key, label]) => fieldRow({ key }, label, draft.fields[key])));
    const games = $('games');
    games.replaceChildren();
    for (const game of draft.games) {
        const card = el('fieldset', 'scorecard-game');
        card.append(el('legend', '', `Game ${game.number}`));
        const grid = el('div', 'scorecard-fields');
        for (const [key, label] of GAME_FIELDS) grid.append(fieldRow({ game: game.id, key }, label, game.fields[key]));
        const remove = el('button', 'scorecard-remove', `Remove game ${game.number}`);
        remove.type = 'button';
        remove.addEventListener('click', () => { if (confirm(`Remove game ${game.number} from the draft?`)) apply(current => removeGame(current, game.id)); });
        card.append(grid, remove);
        games.append(card);
    }
    $('unparsedPanel').hidden = !draft.unparsed.length;
    $('unparsed').replaceChildren(...draft.unparsed.map((text, index) => {
        const item = el('li');
        const dismiss = el('button', '', 'Dismiss');
        dismiss.type = 'button';
        dismiss.addEventListener('click', () => apply(current => dismissUnparsed(current, index)));
        item.append(el('span', '', text), dismiss);
        return item;
    }));
    $('warnings').replaceChildren(...consistencyWarnings(draft).map(text => el('li', '', text)));
    const flags = openFlags(draft);
    $('reviewSummary').textContent = draft.reviewed ? 'Reviewed. Any further edit re-opens the review.'
        : flags.length ? `${flags.length} item${flags.length === 1 ? '' : 's'} still need your review. Flagged fields are marked ⚑ or ⚠.`
            : 'Every field has been checked. Complete the manual review below.';
    $('markReviewed').disabled = draft.reviewed || flags.length > 0;
    $('attest').checked = draft.reviewed;
    $('attest').disabled = draft.reviewed || flags.length > 0;
    $('download').disabled = !draft.reviewed;
    $('exportText').value = draft.reviewed ? JSON.stringify(exportDraft(draft), null, 2) : '';
    $('reviewStatus').textContent = draft.reviewed ? `Reviewed ${new Date(draft.reviewedAt).toLocaleString()}. Not sent anywhere — download it or copy the text yourself.` : '';
}

function replaceDraft(next, message) {
    if (draft && !confirm('Replace the current draft? Its entries will be lost.')) return false;
    draft = next; persist(); render(); note(message);
    return true;
}

function showPhoto(kind) {
    $('photoFrame').hidden = false;
    $('photo').hidden = kind !== 'photo';
    $('sampleCanvas').hidden = kind !== 'sample';
}

$('photoInput').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { note('That file is not an image. Choose a photo of the scorecard.'); return; }
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoFile = file;
    photoURL = URL.createObjectURL(file);
    $('photo').src = photoURL;
    showPhoto('photo');
    $('detectText').hidden = !detectorAvailable();
    note(detectorAvailable()
        ? 'Photo loaded on this device. You can try on-device text reading, or start a blank draft and type from the photo. Either way you check every field.'
        : 'Photo loaded on this device. This browser has no on-device text reader, so automatic reading is unavailable here: start a blank draft and type the result while looking at the photo.');
});

$('detectText').addEventListener('click', async () => {
    if (!photoFile) return;
    const button = $('detectText');
    button.disabled = true;
    note('Reading text on this device…');
    try {
        const bitmap = await createImageBitmap(photoFile);
        const lines = await detectLines(bitmap);
        bitmap.close?.();
        if (!lines.length) { note('No text was detected in this photo. Start a blank draft and type the result from the photo.'); return; }
        replaceDraft(draftFromTextLines(lines, { extraction: 'on-device-text-detector' }),
            `Read ${lines.length} line${lines.length === 1 ? '' : 's'} on this device. Automatic reading is experimental and unreliable for handwriting: every detected value is flagged until you check it, and nothing missing was filled in.`);
    } catch (error) {
        note(`On-device text reading failed (${error.message}). Start a blank draft and type the result from the photo.`);
    } finally { button.disabled = false; }
});

$('loadSample').addEventListener('click', () => {
    if (!replaceDraft(draftFromTextLines(SAMPLE_LINES, { extraction: 'synthetic-sample' }),
        'Synthetic sample loaded: invented teams and players, with deliberately doubtful and missing items so you can try the review. It was not read from a real card.')) return;
    drawSampleCard($('sampleCanvas'));
    showPhoto('sample');
});
$('startBlank').addEventListener('click', () => replaceDraft(createDraft(), 'Blank draft started. Type each value from the scorecard.'));
$('addGame').addEventListener('click', () => apply(addGame));
$('photoZoom').addEventListener('input', event => {
    for (const id of ['photo', 'sampleCanvas']) $(id).style.width = `${event.target.value}%`;
});
$('markReviewed').addEventListener('click', () => apply(current => markReviewed(current, { attested: $('attest').checked })));
$('download').addEventListener('click', () => {
    if (!draft?.reviewed) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportDraft(draft), null, 2)], { type: 'application/json' }));
    const link = el('a');
    link.href = url; link.download = 'blakeout-league-result-draft.json';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('discard').addEventListener('click', () => {
    if (!confirm('Discard this draft? This cannot be undone.')) return;
    draft = null; persist(); render(); note('Draft discarded.');
});

try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (isDraft(saved)) { draft = saved; note('Restored the draft saved in this browser. The photo is not stored — choose it again to compare.'); }
} catch { /* An unreadable saved draft is ignored and left in place until replaced. */ }
if (!$('extractNote').textContent) {
    note(detectorAvailable()
        ? 'Choose a photo to begin. This browser offers an on-device text reader you can try; you will still check every field.'
        : 'Choose a photo to begin. This browser has no on-device text reader, so you will type the result while looking at the photo.');
}
render();
