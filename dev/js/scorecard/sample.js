// Synthetic scorecard sample — invented teams and names, for trying the review
// flow without a real card. It deliberately contains doubtful and missing items.
export const SAMPLE_LINES = Object.freeze([
    { text: 'SYNTHETIC SAMPLE LEAGUE — NOT A REAL CARD' },
    { text: 'Date: 11/12/2026' },
    { text: 'Home: Bullseye Bandits' },
    { text: 'Away: Triple Tr0uble', confidence: 0.55 },
    { text: '1. 501: Ada Quill & Ben Marsh vs Cy Okoro & Dee Lund | 1-0 | W: Home' },
    { text: '2. Cricket: Ada Quill vs Cy Okoro | 0-1 | W: Away' },
    { text: '3. 501: Ben Marsh vs Dee Lund | l-0 | W: Home' },
    { text: '4. Cricket: Eve Tran & Flo Diaz vs Gus Pike & Hal ?ee' },
    { text: 'Totals: 3-1' },
    { text: 'Captain sign: ~~~' },
]);

export function drawSampleCard(canvas) {
    canvas.width = 900; canvas.height = 620;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fbf7ea'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#1c2530'; context.textBaseline = 'top';
    SAMPLE_LINES.forEach((line, index) => {
        context.font = index === 0 ? 'bold 26px sans-serif' : '24px sans-serif';
        context.fillText(line.text, 32, 28 + index * 56);
        context.fillStyle = '#b9c0c8'; context.fillRect(32, 64 + index * 56, canvas.width - 64, 1); context.fillStyle = '#1c2530';
    });
    return canvas;
}
