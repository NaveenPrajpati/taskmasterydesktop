// Microsoft Store tile images (assets/appx/*.png) from assets/icon.png.
// Without them electron-builder ships Electron's sample logos.
// Run after changing the icon: npm run store-assets
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const icon = path.join(root, 'assets', 'icon.png');
const outDir = path.join(root, 'assets', 'appx');
fs.mkdirSync(outDir, {recursive: true});

// name: [width, height, share of the height the icon fills]
const assets = {
  'StoreLogo.png': [50, 50, 0.9],
  'Square44x44Logo.png': [44, 44, 0.9],
  'SmallTile.png': [71, 71, 0.6],
  'Square150x150Logo.png': [150, 150, 0.6],
  'Wide310x150Logo.png': [310, 150, 0.6],
  'LargeTile.png': [310, 310, 0.6],
};

for (const [name, [width, height, share]] of Object.entries(assets)) {
  const size = Math.round(height * share);
  const glyph = await sharp(icon).resize(size, size).toBuffer();
  await sharp({create: {width, height, channels: 4, background: {r: 0, g: 0, b: 0, alpha: 0}}})
    .composite([{input: glyph, gravity: 'center'}])
    .png()
    .toFile(path.join(outDir, name));
  console.log(`${name} ${width}x${height}`);
}
