import fs from "fs";
import path from "path";
import sharp from "sharp";

const SVG_CONTENT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <!-- Background Gradient -->
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4338ca"/>
      <stop offset="50%" stop-color="#4f46e5"/>
      <stop offset="100%" stop-color="#7c3aed"/>
    </linearGradient>

    <!-- Top Glow / Rim -->
    <linearGradient id="rimGlow" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ffffff" stop-opacity="0.05"/>
    </linearGradient>

    <!-- Folder Body Gradient -->
    <linearGradient id="folderGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#e0e7ff"/>
    </linearGradient>

    <!-- Lens Inset Gradient -->
    <linearGradient id="lensBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1e1b4b"/>
      <stop offset="100%" stop-color="#312e81"/>
    </linearGradient>

    <!-- AI Sparkle Gradient -->
    <linearGradient id="sparkleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8"/>
      <stop offset="100%" stop-color="#818cf8"/>
    </linearGradient>

    <!-- Drop Shadows for 3D depth -->
    <filter id="folderShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#1e1b4b" flood-opacity="0.45"/>
    </filter>

    <filter id="lensShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#1e1b4b" flood-opacity="0.55"/>
    </filter>
  </defs>

  <!-- Background Squircle -->
  <rect width="512" height="512" rx="120" fill="url(#bgGrad)"/>
  
  <!-- Subtle Internal Glow Rim -->
  <rect x="6" y="6" width="500" height="500" rx="114" fill="none" stroke="url(#rimGlow)" stroke-width="7"/>

  <!-- Enterprise Folder Graphic -->
  <g filter="url(#folderShadow)">
    <!-- Back Tab & Main Folder Body -->
    <path d="M 96 168 C 96 150 110 136 128 136 L 204 136 C 216 136 228 143 234 154 L 254 186 C 260 196 272 202 284 202 L 384 C 402 202 416 216 416 234 L 416 348 C 416 366 402 380 384 380 L 128 380 C 110 380 96 366 96 348 Z" 
          fill="url(#folderGrad)"/>
    
    <!-- Folder tab separator line -->
    <path d="M 96 228 L 416 228" stroke="#cbd5e1" stroke-width="4" stroke-linecap="round"/>
  </g>

  <!-- AI Finder / Media Locator Lens & Sparkle -->
  <g filter="url(#lensShadow)">
    <!-- Magnifier Ring -->
    <circle cx="240" cy="296" r="62" fill="url(#lensBg)" stroke="#ffffff" stroke-width="16"/>
    
    <!-- Magnifier Handle -->
    <path d="M 284 340 L 338 394" stroke="#ffffff" stroke-width="20" stroke-linecap="round"/>

    <!-- Handle Accent Tip -->
    <circle cx="338" cy="394" r="5" fill="#38bdf8"/>

    <!-- Central AI Media Sparkle (4-point star) -->
    <path d="M 240 258 C 240 282 222 296 206 296 C 222 296 240 310 240 334 C 240 310 258 296 274 296 C 258 296 240 282 240 258 Z" 
          fill="url(#sparkleGrad)"/>
    
    <!-- Center Glow Dot -->
    <circle cx="240" cy="296" r="6" fill="#ffffff"/>
  </g>
</svg>`;

/**
 * Builds a multi-resolution ICO file from PNG buffers (16, 32, 48)
 */
function createIco(images) {
  // images: array of { width, height, buffer }
  const count = images.length;
  const headerSize = 6;
  const entrySize = 16;
  let offset = headerSize + count * entrySize;

  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // Type: 1 = ICO
  header.writeUInt16LE(count, 4); // Number of images

  const entries = [];
  const buffers = [];

  for (const img of images) {
    const entry = Buffer.alloc(entrySize);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2); // Color palette
    entry.writeUInt8(0, 3); // Reserved
    entry.writeUInt16LE(1, 4); // Color planes
    entry.writeUInt16LE(32, 6); // Bits per pixel
    entry.writeUInt32LE(img.buffer.length, 8); // Image size in bytes
    entry.writeUInt32LE(offset, 12); // Image offset

    entries.push(entry);
    buffers.push(img.buffer);
    offset += img.buffer.length;
  }

  return Buffer.concat([header, ...entries, ...buffers]);
}

async function run() {
  const rootDir = process.cwd();
  const svgBuffer = Buffer.from(SVG_CONTENT);

  // 1. Write SVG icons
  fs.writeFileSync(path.join(rootDir, "src/app/icon.svg"), SVG_CONTENT, "utf8");
  fs.writeFileSync(path.join(rootDir, "public/favicon.svg"), SVG_CONTENT, "utf8");
  console.log("Written src/app/icon.svg and public/favicon.svg");

  // 2. Generate PNG sizes
  const p16 = await sharp(svgBuffer).resize(16, 16).png().toBuffer();
  const p32 = await sharp(svgBuffer).resize(32, 32).png().toBuffer();
  const p48 = await sharp(svgBuffer).resize(48, 48).png().toBuffer();
  const p180 = await sharp(svgBuffer).resize(180, 180).png().toBuffer();
  const p192 = await sharp(svgBuffer).resize(192, 192).png().toBuffer();
  const p512 = await sharp(svgBuffer).resize(512, 512).png().toBuffer();

  // Save Apple Touch Icon and standard icon PNGs
  fs.writeFileSync(path.join(rootDir, "src/app/apple-icon.png"), p180);
  fs.writeFileSync(path.join(rootDir, "public/apple-icon.png"), p180);
  fs.writeFileSync(path.join(rootDir, "src/app/icon.png"), p192);
  fs.writeFileSync(path.join(rootDir, "public/icon-192.png"), p192);
  fs.writeFileSync(path.join(rootDir, "public/icon-512.png"), p512);
  console.log("Written PNG icons (180, 192, 512)");

  // 3. Create ICO with 16, 32, 48 resolutions
  const icoBuffer = createIco([
    { width: 16, height: 16, buffer: p16 },
    { width: 32, height: 32, buffer: p32 },
    { width: 48, height: 48, buffer: p48 },
  ]);

  fs.writeFileSync(path.join(rootDir, "src/app/favicon.ico"), icoBuffer);
  fs.writeFileSync(path.join(rootDir, "public/favicon.ico"), icoBuffer);
  console.log("Written multi-resolution favicon.ico to src/app and public/");
}

run().catch(console.error);
