// Manual zoom settles on readable presets; Fit remains viewport-dependent.
export const ZOOM_STEPS = Object.freeze([.1, .25, .5, .75, 1, 1.25, 1.5, 2, 2.5]);
export function zoomSteps(minimum) { return [...new Set([minimum, ...ZOOM_STEPS.filter(n => n >= minimum)])].sort((a,b)=>a-b); }
export function nearestZoom(value, minimum) { return zoomSteps(minimum).reduce((best,n)=>Math.abs(n-value)<Math.abs(best-value)?n:best); }
export function adjacentZoom(value, direction, minimum) { const steps=zoomSteps(minimum); return direction>0 ? steps.find(n=>n>value+.0001) ?? steps.at(-1) : steps.findLast(n=>n<value-.0001) ?? steps[0]; }
