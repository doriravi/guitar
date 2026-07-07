// Rasterize scripts/icon.svg into the PWA icon set under public/.
// Run: node scripts/gen-icons.mjs
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(resolve(__dirname, 'icon.svg'));
const pub = resolve(__dirname, '..', 'public');
mkdirSync(pub, { recursive: true });

// Standard (transparent-safe) square icons.
const sizes = [64, 192, 512];
for (const s of sizes) {
  await sharp(svg).resize(s, s).png().toFile(resolve(pub, `pwa-${s}x${s}.png`));
  console.log(`pwa-${s}x${s}.png`);
}

// Apple touch icon (180, no transparency — iOS ignores it anyway).
await sharp(svg).resize(180, 180).png().toFile(resolve(pub, 'apple-touch-icon.png'));
console.log('apple-touch-icon.png');

// Maskable icon: same art but with safe-zone padding (~10%) so Android's
// adaptive-icon mask never clips the mark.
const M = 512, pad = Math.round(M * 0.1);
const inner = await sharp(svg).resize(M - pad * 2, M - pad * 2).png().toBuffer();
await sharp({
  create: { width: M, height: M, channels: 4, background: '#0b0a08' },
})
  .composite([{ input: inner, top: pad, left: pad }])
  .png()
  .toFile(resolve(pub, 'maskable-512x512.png'));
console.log('maskable-512x512.png');

// Favicon (32px png; browsers accept png favicons fine).
await sharp(svg).resize(32, 32).png().toFile(resolve(pub, 'favicon.png'));
console.log('favicon.png');
