/* ============================================
   Minimal QR Code generator — byte mode, ECL=M,
   QR version 3 (29x29). Capacity 53 bytes; only
   used here for the prod-URL QR on the setup
   screen, so the fixed version keeps this tiny.
   Algorithm per ISO/IEC 18004.
   ============================================ */

const SIZE = 29;
const DATA_CW = 44;
const EC_CW = 26;
const ALIGN_POS = [22];

// --- GF(256) tables (primitive 0x11D) ---
const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(function () {
    let x = 1;
    for (let i = 0; i < 255; i++) {
        EXP[i] = x;
        LOG[x] = i;
        x <<= 1;
        if (x & 0x100) x ^= 0x11D;
    }
})();

function gfMul(a, b) {
    if (!a || !b) return 0;
    return EXP[(LOG[a] + LOG[b]) % 255];
}

function rsGenPoly(degree) {
    // Returns coefficients [leading=1, ..., constant], length degree+1.
    let g = new Uint8Array(1);
    g[0] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
        const next = new Uint8Array(g.length + 1);
        for (let j = 0; j < g.length; j++) {
            next[j] ^= g[j];
            next[j + 1] ^= gfMul(g[j], root);
        }
        g = next;
        root <<= 1;
        if (root & 0x100) root ^= 0x11D;
    }
    return g;
}

function rsRemainder(data) {
    const gen = rsGenPoly(EC_CW);
    const buf = new Uint8Array(data.length + EC_CW);
    buf.set(data);
    for (let i = 0; i < data.length; i++) {
        const coef = buf[i];
        if (!coef) continue;
        for (let j = 0; j < gen.length; j++) {
            buf[i + j] ^= gfMul(gen[j], coef);
        }
    }
    return buf.slice(data.length);
}

// --- Bit buffer ---
function encodeBytes(text) {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
        const cc = text.charCodeAt(i);
        if (cc > 255) throw new Error('QR: non-Latin-1 char not supported');
        bytes.push(cc);
    }
    if (bytes.length > 53) throw new Error('QR: text too long for v3-M (>53 bytes)');

    const totalBits = DATA_CW * 8;
    let bits = [];
    function pushBits(value, count) {
        for (let i = count - 1; i >= 0; i--) bits.push((value >> i) & 1);
    }
    pushBits(0b0100, 4);                  // byte mode indicator
    pushBits(bytes.length, 8);            // 8-bit count for v1-9 byte mode
    for (const b of bytes) pushBits(b, 8);

    // Terminator (up to 4 zeros)
    const term = Math.min(4, totalBits - bits.length);
    for (let i = 0; i < term; i++) bits.push(0);

    // Pad to byte boundary
    while (bits.length % 8 !== 0) bits.push(0);

    // Fill with 0xEC, 0x11 alternating
    const pad = [0xEC, 0x11];
    let pi = 0;
    while (bits.length < totalBits) {
        pushBits(pad[pi++ % 2], 8);
    }

    const data = new Uint8Array(DATA_CW);
    for (let i = 0; i < DATA_CW; i++) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
        data[i] = b;
    }
    return data;
}

// --- Matrix construction ---
function newMatrix() {
    const modules = new Int8Array(SIZE * SIZE).fill(-1);
    const isFn = new Uint8Array(SIZE * SIZE);
    return { modules, isFn };
}
const idx = (r, c) => r * SIZE + c;

function setFn(mx, r, c, v) {
    mx.modules[idx(r, c)] = v;
    mx.isFn[idx(r, c)] = 1;
}

function drawFinder(mx, R, C) {
    for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
            const r = R + dr, c = C + dc;
            if (r < 0 || r >= SIZE || c < 0 || c >= SIZE) continue;
            if (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) {
                const ring = dr === 0 || dr === 6 || dc === 0 || dc === 6;
                const center = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
                setFn(mx, r, c, (ring || center) ? 1 : 0);
            } else {
                setFn(mx, r, c, 0); // separator
            }
        }
    }
}

function drawAlignment(mx, R, C) {
    for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
            const m = Math.max(Math.abs(dr), Math.abs(dc));
            setFn(mx, R + dr, C + dc, m !== 1 ? 1 : 0);
        }
    }
}

function drawFunctionPatterns(mx) {
    drawFinder(mx, 0, 0);
    drawFinder(mx, 0, SIZE - 7);
    drawFinder(mx, SIZE - 7, 0);

    for (let i = 8; i < SIZE - 8; i++) {
        setFn(mx, 6, i, i % 2 === 0 ? 1 : 0);
        setFn(mx, i, 6, i % 2 === 0 ? 1 : 0);
    }

    for (const ar of ALIGN_POS) {
        for (const ac of ALIGN_POS) {
            const inFinder =
                (ar < 8 && ac < 8) ||
                (ar < 8 && ac > SIZE - 9) ||
                (ar > SIZE - 9 && ac < 8);
            if (inFinder) continue;
            drawAlignment(mx, ar, ac);
        }
    }

    setFn(mx, SIZE - 8, 8, 1); // dark module

    // Reserve format info area
    for (let i = 0; i < 9; i++) {
        if (mx.modules[idx(8, i)] === -1) setFn(mx, 8, i, 0);
        if (mx.modules[idx(i, 8)] === -1) setFn(mx, i, 8, 0);
    }
    for (let i = SIZE - 8; i < SIZE; i++) {
        if (mx.modules[idx(8, i)] === -1) setFn(mx, 8, i, 0);
    }
    for (let i = SIZE - 7; i < SIZE; i++) {
        if (mx.modules[idx(i, 8)] === -1) setFn(mx, i, 8, 0);
    }
}

// --- Data placement (zigzag, right-to-left, skipping col 6) ---
function placeData(mx, allCodewords) {
    let bitIdx = 0;
    const totalBits = allCodewords.length * 8;
    let upward = true;
    let col = SIZE - 1;
    while (col > 0) {
        if (col === 6) col--; // skip vertical timing
        for (let i = 0; i < SIZE; i++) {
            const r = upward ? SIZE - 1 - i : i;
            for (let dc = 0; dc < 2; dc++) {
                const c = col - dc;
                if (mx.isFn[idx(r, c)]) continue;
                if (bitIdx >= totalBits) { mx.modules[idx(r, c)] = 0; continue; }
                const byte = allCodewords[bitIdx >> 3];
                const bit = (byte >> (7 - (bitIdx & 7))) & 1;
                mx.modules[idx(r, c)] = bit;
                bitIdx++;
            }
        }
        upward = !upward;
        col -= 2;
    }
}

// --- Masking ---
function maskBit(mask, r, c) {
    switch (mask) {
        case 0: return (r + c) % 2 === 0;
        case 1: return r % 2 === 0;
        case 2: return c % 3 === 0;
        case 3: return (r + c) % 3 === 0;
        case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
        case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
        case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
        case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
    return false;
}

function applyMask(mx, mask) {
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (mx.isFn[idx(r, c)]) continue;
            if (maskBit(mask, r, c)) mx.modules[idx(r, c)] ^= 1;
        }
    }
}

function penalty(mx) {
    // Rule 1: runs of 5+ same color
    let p = 0;
    for (let r = 0; r < SIZE; r++) {
        let run = 1;
        for (let c = 1; c < SIZE; c++) {
            if (mx.modules[idx(r, c)] === mx.modules[idx(r, c - 1)]) {
                run++;
                if (run === 5) p += 3;
                else if (run > 5) p += 1;
            } else run = 1;
        }
    }
    for (let c = 0; c < SIZE; c++) {
        let run = 1;
        for (let r = 1; r < SIZE; r++) {
            if (mx.modules[idx(r, c)] === mx.modules[idx(r - 1, c)]) {
                run++;
                if (run === 5) p += 3;
                else if (run > 5) p += 1;
            } else run = 1;
        }
    }
    // Rule 2: 2x2 blocks
    for (let r = 0; r < SIZE - 1; r++) {
        for (let c = 0; c < SIZE - 1; c++) {
            const v = mx.modules[idx(r, c)];
            if (v === mx.modules[idx(r, c + 1)] &&
                v === mx.modules[idx(r + 1, c)] &&
                v === mx.modules[idx(r + 1, c + 1)]) p += 3;
        }
    }
    // Rule 3: finder-pattern-like sequences
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    const matchAt = (r, c, horiz, pat) => {
        for (let i = 0; i < pat.length; i++) {
            const rr = horiz ? r : r + i;
            const cc = horiz ? c + i : c;
            if (rr >= SIZE || cc >= SIZE) return false;
            if (mx.modules[idx(rr, cc)] !== pat[i]) return false;
        }
        return true;
    };
    for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
            if (matchAt(r, c, true, pat1)) p += 40;
            if (matchAt(r, c, true, pat2)) p += 40;
            if (matchAt(r, c, false, pat1)) p += 40;
            if (matchAt(r, c, false, pat2)) p += 40;
        }
    }
    // Rule 4: dark module ratio
    let dark = 0;
    for (let i = 0; i < SIZE * SIZE; i++) if (mx.modules[i]) dark++;
    const ratio = Math.abs((dark * 100) / (SIZE * SIZE) - 50) / 5;
    p += Math.floor(ratio) * 10;
    return p;
}

// --- Format info (ECL M = 0b00, mask 3 bits) ---
function drawFormatInfo(mx, mask) {
    const data = (0b00 << 3) | mask;            // 5 bits
    let rem = data;
    for (let i = 0; i < 10; i++) {
        rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    }
    const bits = ((data << 10) | (rem & 0x3FF)) ^ 0x5412;  // 15 bits, masked

    // Copy 1: around top-left finder
    const positions1 = [
        [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
        [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
    ];
    // Copy 2: split between bottom-left col and top-right row
    const positions2 = [
        [SIZE - 1, 8], [SIZE - 2, 8], [SIZE - 3, 8], [SIZE - 4, 8],
        [SIZE - 5, 8], [SIZE - 6, 8], [SIZE - 7, 8],
        [8, SIZE - 8], [8, SIZE - 7], [8, SIZE - 6], [8, SIZE - 5],
        [8, SIZE - 4], [8, SIZE - 3], [8, SIZE - 2], [8, SIZE - 1]
    ];
    for (let i = 0; i < 15; i++) {
        const bit = (bits >> i) & 1;
        const [r1, c1] = positions1[i];
        const [r2, c2] = positions2[i];
        mx.modules[idx(r1, c1)] = bit;
        mx.isFn[idx(r1, c1)] = 1;
        mx.modules[idx(r2, c2)] = bit;
        mx.isFn[idx(r2, c2)] = 1;
    }
}

// --- Public API ---
export function generateQR(text) {
    const data = encodeBytes(text);
    const ec = rsRemainder(data);
    const all = new Uint8Array(data.length + ec.length);
    all.set(data);
    all.set(ec, data.length);

    const base = newMatrix();
    drawFunctionPatterns(base);
    placeData(base, all);

    let best = null;
    for (let m = 0; m < 8; m++) {
        const trial = {
            modules: new Int8Array(base.modules),
            isFn: new Uint8Array(base.isFn)
        };
        applyMask(trial, m);
        drawFormatInfo(trial, m);
        const score = penalty(trial);
        if (!best || score < best.score) best = { mx: trial, mask: m, score };
    }
    return { size: SIZE, modules: best.mx.modules };
}

export function renderQRToCanvas(canvas, text, options = {}) {
    const { scale = 6, margin = 2, dark = '#000', light = '#fff' } = options;
    const qr = generateQR(text);
    const dim = (qr.size + margin * 2) * scale;
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = dark;
    for (let r = 0; r < qr.size; r++) {
        for (let c = 0; c < qr.size; c++) {
            if (qr.modules[r * qr.size + c]) {
                ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
            }
        }
    }
}
