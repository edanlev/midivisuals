export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

export const noteToHue = (n: number): number => (n % 12) * 30; // Use modulo for more distinct colors

export const noteToX = (n: number, range = 127): number => n / range;