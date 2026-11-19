// Scorecard reader — on-device text detection adapter. DEV only.
//
// The only automated reader used is the browser's own Shape Detection
// `TextDetector`, when the browser provides one. It runs on the device; this
// module makes no network request and sends the photo nowhere. Most desktop
// browsers (and every browser on iOS) do not provide it, and it is not built
// for handwriting — when it is missing or fails, the reader falls back to
// manual entry beside the photo. No OCR library or cloud service is bundled.

export function detectorAvailable(scope = globalThis) {
    return typeof scope.TextDetector === 'function';
}

// Group detected blocks into reading-order lines using their boxes.
export function blocksToLines(blocks) {
    const items = (blocks || []).map(block => {
        const box = block.boundingBox || {};
        return { text: String(block.rawValue ?? '').trim(), x: Number(box.x) || 0, y: Number(box.y) || 0, height: Number(box.height) || 0 };
    }).filter(item => item.text);
    if (!items.length) return [];
    const heights = items.map(item => item.height).filter(Boolean).sort((a, b) => a - b);
    const tolerance = (heights[Math.floor(heights.length / 2)] || 16) * 0.6;
    items.sort((a, b) => (a.y + a.height / 2) - (b.y + b.height / 2));
    const rows = [];
    for (const item of items) {
        const center = item.y + item.height / 2, row = rows.at(-1);
        if (row && Math.abs(center - row.center) <= tolerance) row.items.push(item);
        else rows.push({ center, items: [item] });
    }
    // The API reports no per-character confidence, so none is claimed.
    return rows.map(row => ({ text: row.items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ') }));
}

export async function detectLines(image, scope = globalThis) {
    if (!detectorAvailable(scope)) throw Error('This browser has no on-device text detector.');
    const detector = new scope.TextDetector();
    return blocksToLines(await detector.detect(image));
}
