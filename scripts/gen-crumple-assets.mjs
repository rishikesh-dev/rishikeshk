import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const outBall = join(root, 'public', 'crumple-ball.webp');
const outMask = join(root, 'public', 'torn-mask.png');

let used = 'none';

try {
  const sharp = await import('sharp');
  const canvas = Buffer.alloc(192 * 192 * 4);
  for (let i = 0; i < canvas.length; i += 4) {
    canvas[i] = 0xe9;
    canvas[i + 1] = 0xdb;
    canvas[i + 2] = 0xbe;
    canvas[i + 3] = 255;
  }
  const img = sharp(canvas, { raw: { width: 192, height: 192, channels: 4 } });
  const svg = `<svg width="192" height="192" xmlns="http://www.w3.org/2000/svg"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4"/></filter><rect width="192" height="192" fill="#E9DBBE" filter="url(#n)"/></svg>`;
  await img.composite([{ input: Buffer.from(svg), blend: 'multiply' }]).webp({ quality: 70 }).toFile(outBall);
  used = 'sharp';
} catch (e) {
  used = 'python-pil';
  const py = `
from PIL import Image, ImageFilter, ImageDraw
import random
random.seed(7)
img = Image.new('RGBA', (192,192), (233,219,190,255))
draw = ImageDraw.Draw(img)
for i in range(800):
  x = random.randint(0,191)
  y = random.randint(0,191)
  r = random.randint(0,8)
  draw.ellipse((x-r,y-r,x+r,y+r), fill=(200,190,170,40))
img = img.filter(ImageFilter.GaussianBlur(radius=1))
img.save('public/crumple-ball.webp', 'WEBP', quality=70)
`;
  writeFileSync(join(root, 'scripts', '_gen.py'), py);
  spawnSync('python3', [join(root, 'scripts', '_gen.py')], { cwd: root });
}

try {
  const sharp = await import('sharp');
  const svg = `<svg width="1440" height="200" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="200" fill="white"/><path d="M720 0 L1440 0 L1440 200 L720 200 L725 10 L735 40 L745 5 L760 30 L775 8 L790 35 L810 12 L830 40 L850 10 L870 38 L900 15 L950 45 L1000 20 L1100 50 L1200 25 L1300 55 L1440 40 L1440 200 Z" fill="white"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(outMask);
  used = used === 'sharp' ? 'sharp' : 'sharp';
} catch {
  const py = `
from PIL import Image, ImageDraw
import random
random.seed(9)
img = Image.new('RGBA', (1440,200), (0,0,0,0))
draw = ImageDraw.Draw(img)
draw.rectangle((0,0,720,200), fill=(255,255,255,255))
pts = [(720,0)]
x = 720
for i in range(80):
  x += 9
  y = random.randint(5,60)
  pts.append((x,y))
pts.append((1440,40))
pts.append((1440,200))
pts.append((720,200))
draw.polygon(pts, fill=(255,255,255,255))
img.save('public/torn-mask.png', 'PNG')
`;
  writeFileSync(join(root, 'scripts', '_gen2.py'), py);
  spawnSync('python3', [join(root, 'scripts', '_gen2.py')], { cwd: root });
}

console.log('used', used);
console.log('ball', readFileSync(outBall).length);
console.log('mask', readFileSync(outMask).length);
