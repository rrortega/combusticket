import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

// 1. Master Icon (512x512 with squircle)
const masterIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#111c33" />
      <stop offset="50%" stop-color="#0a0f1d" />
      <stop offset="100%" stop-color="#050811" />
    </linearGradient>

    <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399" />
      <stop offset="60%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>

    <linearGradient id="glowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.3" />
      <stop offset="100%" stop-color="#06b6d4" stop-opacity="0" />
    </linearGradient>

    <linearGradient id="boltGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="50%" stop-color="#34d399" />
      <stop offset="100%" stop-color="#fbbf24" />
    </linearGradient>

    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="24" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>

    <filter id="subtleShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="16" stdDeviation="20" flood-color="#000000" flood-opacity="0.6" />
    </filter>
  </defs>

  <!-- Squircle Base Canvas -->
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#bgGrad)" stroke="rgba(255, 255, 255, 0.12)" stroke-width="4" filter="url(#subtleShadow)" />
  
  <!-- Subtle Internal Glow Ring -->
  <rect x="22" y="22" width="468" height="468" rx="106" fill="none" stroke="url(#glowGrad)" stroke-width="3" opacity="0.6" />

  <!-- Ambient Glow Behind Symbol -->
  <circle cx="256" cy="256" r="140" fill="#10b981" opacity="0.18" filter="url(#glow)" />

  <!-- The Digital Invoice Ticket Base (Behind) -->
  <g transform="translate(136, 110)">
    <!-- Ticket Card Shape with Zig-Zag Top/Bottom -->
    <path d="M 0,20 
             C 0,9 9,0 20,0 
             L 180,0 
             C 191,0 200,9 200,20 
             L 200,270 
             L 180,260 L 160,270 L 140,260 L 120,270 L 100,260 L 80,270 L 60,260 L 40,270 L 20,260 L 0,270 Z" 
          fill="#13213a" 
          stroke="rgba(255,255,255,0.15)" 
          stroke-width="3.5" 
          filter="url(#subtleShadow)" />

    <!-- Receipt Header Bar -->
    <rect x="24" y="28" width="152" height="14" rx="7" fill="url(#primaryGrad)" opacity="0.85" />
    
    <!-- Receipt Lines (Data placeholder lines) -->
    <rect x="24" y="60" width="110" height="8" rx="4" fill="#94a3b8" opacity="0.5" />
    <rect x="24" y="80" width="80" height="8" rx="4" fill="#64748b" opacity="0.4" />
    <rect x="24" y="100" width="130" height="8" rx="4" fill="#64748b" opacity="0.4" />
    
    <!-- Dotted Divider Line -->
    <line x1="20" y1="130" x2="180" y2="130" stroke="#475569" stroke-width="2.5" stroke-dasharray="6,6" />
    
    <!-- Receipt Total Line -->
    <rect x="24" y="152" width="70" height="10" rx="5" fill="#94a3b8" opacity="0.6" />
    <rect x="120" y="150" width="56" height="14" rx="7" fill="url(#primaryGrad)" />
  </g>

  <!-- Gas Pump Nozzle & Holographic Lightning Flow (Front) -->
  <g transform="translate(195, 155)" filter="url(#subtleShadow)">
    <!-- Gas Pump Body / Meter -->
    <path d="M 40,30 L 130,30 C 146,30 160,44 160,60 L 160,190 C 160,206 146,220 130,220 L 40,220 C 24,220 10,206 10,190 L 10,60 C 10,44 24,30 40,30 Z" 
          fill="url(#primaryGrad)" />
    
    <!-- Inner Screen of Pump -->
    <rect x="28" y="52" width="114" height="65" rx="10" fill="#09121f" stroke="rgba(255,255,255,0.15)" stroke-width="2" />
    
    <!-- Display Digits (Digital Fuel Liter / CFDI symbol) -->
    <path d="M 46,75 L 56,65 L 66,75 L 56,85 Z" fill="#34d399" />
    <rect x="74" y="70" width="48" height="6" rx="3" fill="#38bdf8" />
    <rect x="74" y="82" width="32" height="6" rx="3" fill="#10b981" />

    <!-- Nozzle Handle / Hose Connection Curve -->
    <path d="M 160,85 C 190,85 200,105 200,135 L 200,190 C 200,215 180,230 160,230" 
          fill="none" 
          stroke="url(#primaryGrad)" 
          stroke-width="14" 
          stroke-linecap="round" />

    <!-- Dispenser Nozzle Head -->
    <path d="M 200,135 L 215,115 L 210,105 L 185,120 Z" fill="#38bdf8" />

    <!-- Pure Fuel Drop / Automation Energy Spark -->
    <path d="M 175,255 C 175,255 195,280 195,295 C 195,306 186,315 175,315 C 164,315 155,306 155,295 C 155,280 175,255 175,255 Z" 
          fill="url(#boltGrad)" 
          filter="url(#glow)" />

    <!-- High-Energy Lightning Bolt (Speed & Automation) -->
    <polygon points="88,140 102,140 94,165 110,165 78,205 84,175 74,175" 
             fill="#ffffff" 
             opacity="0.95" 
             filter="url(#glow)" />
  </g>
</svg>
`;

// 2. Maskable Icon (Full bleed background, 75% safe area)
const maskableIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#111c33" />
      <stop offset="50%" stop-color="#0a0f1d" />
      <stop offset="100%" stop-color="#050811" />
    </linearGradient>

    <linearGradient id="primaryGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399" />
      <stop offset="60%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>

    <linearGradient id="boltGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38bdf8" />
      <stop offset="50%" stop-color="#34d399" />
      <stop offset="100%" stop-color="#fbbf24" />
    </linearGradient>

    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="20" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>

  <!-- Edge-to-Edge Solid Background for Android Masking -->
  <rect x="0" y="0" width="512" height="512" fill="url(#bgGrad)" />

  <!-- Centered & Scaled to 75% inside safe zone -->
  <g transform="translate(64, 64) scale(0.75)">
    <!-- Ambient Glow Behind Symbol -->
    <circle cx="256" cy="256" r="140" fill="#10b981" opacity="0.22" filter="url(#glow)" />

    <!-- The Digital Invoice Ticket Base -->
    <g transform="translate(136, 110)">
      <path d="M 0,20 C 0,9 9,0 20,0 L 180,0 C 191,0 200,9 200,20 L 200,270 L 180,260 L 160,270 L 140,260 L 120,270 L 100,260 L 80,270 L 60,260 L 40,270 L 20,260 L 0,270 Z" 
            fill="#13213a" 
            stroke="rgba(255,255,255,0.18)" 
            stroke-width="4" />
      <rect x="24" y="28" width="152" height="14" rx="7" fill="url(#primaryGrad)" opacity="0.9" />
      <rect x="24" y="60" width="110" height="8" rx="4" fill="#94a3b8" opacity="0.6" />
      <rect x="24" y="80" width="80" height="8" rx="4" fill="#64748b" opacity="0.5" />
      <rect x="24" y="100" width="130" height="8" rx="4" fill="#64748b" opacity="0.5" />
      <line x1="20" y1="130" x2="180" y2="130" stroke="#475569" stroke-width="3" stroke-dasharray="6,6" />
      <rect x="24" y="152" width="70" height="10" rx="5" fill="#94a3b8" opacity="0.7" />
      <rect x="120" y="150" width="56" height="14" rx="7" fill="url(#primaryGrad)" />
    </g>

    <!-- Gas Pump Nozzle & Energy -->
    <g transform="translate(195, 155)">
      <path d="M 40,30 L 130,30 C 146,30 160,44 160,60 L 160,190 C 160,206 146,220 130,220 L 40,220 C 24,220 10,206 10,190 L 10,60 C 10,44 24,30 40,30 Z" 
            fill="url(#primaryGrad)" />
      <rect x="28" y="52" width="114" height="65" rx="10" fill="#09121f" stroke="rgba(255,255,255,0.2)" stroke-width="2.5" />
      <path d="M 46,75 L 56,65 L 66,75 L 56,85 Z" fill="#34d399" />
      <rect x="74" y="70" width="48" height="6" rx="3" fill="#38bdf8" />
      <rect x="74" y="82" width="32" height="6" rx="3" fill="#10b981" />

      <path d="M 160,85 C 190,85 200,105 200,135 L 200,190 C 200,215 180,230 160,230" 
            fill="none" 
            stroke="url(#primaryGrad)" 
            stroke-width="15" 
            stroke-linecap="round" />
      <path d="M 200,135 L 215,115 L 210,105 L 185,120 Z" fill="#38bdf8" />

      <path d="M 175,255 C 175,255 195,280 195,295 C 195,306 186,315 175,315 C 164,315 155,306 155,295 C 155,280 175,255 175,255 Z" 
            fill="url(#boltGrad)" 
            filter="url(#glow)" />

      <polygon points="88,140 102,140 94,165 110,165 78,205 84,175 74,175" 
               fill="#ffffff" 
               opacity="0.95" />
    </g>
  </g>
</svg>
`;

// 3. OpenGraph Banner Card (1200x630)
const ogBannerSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630" width="1200" height="630">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0e172a" />
      <stop offset="50%" stop-color="#0a0f1d" />
      <stop offset="100%" stop-color="#040711" />
    </linearGradient>

    <linearGradient id="brandGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#34d399" />
      <stop offset="50%" stop-color="#10b981" />
      <stop offset="100%" stop-color="#06b6d4" />
    </linearGradient>

    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#17243c" stop-opacity="0.8" />
      <stop offset="100%" stop-color="#0d1527" stop-opacity="0.9" />
    </linearGradient>

    <filter id="blurGlow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="70" result="blur" />
    </filter>

    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="20" stdDeviation="24" flood-color="#000000" flood-opacity="0.6" />
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bgGrad)" />

  <!-- Ambient Light Orbs -->
  <circle cx="200" cy="150" r="220" fill="#10b981" opacity="0.12" filter="url(#blurGlow)" />
  <circle cx="1050" cy="480" r="260" fill="#06b6d4" opacity="0.14" filter="url(#blurGlow)" />

  <!-- Subtle High-Tech Grid Pattern -->
  <g stroke="rgba(255,255,255,0.03)" stroke-width="1">
    <line x1="0" y1="100" x2="1200" y2="100" />
    <line x1="0" y1="200" x2="1200" y2="200" />
    <line x1="0" y1="300" x2="1200" y2="300" />
    <line x1="0" y1="400" x2="1200" y2="400" />
    <line x1="0" y1="500" x2="1200" y2="500" />
    <line x1="200" y1="0" x2="200" y2="630" />
    <line x1="400" y1="0" x2="400" y2="630" />
    <line x1="600" y1="0" x2="600" y2="630" />
    <line x1="800" y1="0" x2="800" y2="630" />
    <line x1="1000" y1="0" x2="1000" y2="630" />
  </g>

  <!-- Top Pill Badge -->
  <g transform="translate(100, 80)">
    <rect width="270" height="38" rx="19" fill="#13213d" stroke="rgba(16, 185, 129, 0.4)" stroke-width="1.5" />
    <circle cx="20" cy="19" r="6" fill="#10b981" />
    <text x="36" y="24" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="14" font-weight="700" fill="#34d399" letter-spacing="1">CFDI 4.0 AUTOMATION AGENT</text>
  </g>

  <!-- Left: Main Title & Value Proposition -->
  <text x="100" y="195" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="64" font-weight="900" fill="#ffffff" letter-spacing="-1.5">Combus<tspan fill="url(#brandGrad)">Ticket</tspan></text>
  <text x="100" y="250" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="24" font-weight="600" fill="#94a3b8">Facturación Inteligente de Combustible en México</text>

  <text x="100" y="325" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="19" font-weight="400" fill="#cbd5e1" width="550">
    <tspan x="100" dy="0">Extracción heurística mediante OCR local, evasión anti-bot</tspan>
    <tspan x="100" dy="28">con Playwright CDP y arquitectura Clean / SOLID desacoplada.</tspan>
  </text>

  <!-- Feature Pills -->
  <g transform="translate(100, 415)">
    <rect x="0" y="0" width="130" height="34" rx="17" fill="#17223b" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
    <text x="65" y="22" font-family="sans-serif" font-size="13" font-weight="600" fill="#38bdf8" text-anchor="middle">⚡ Playwright CDP</text>

    <rect x="145" y="0" width="125" height="34" rx="17" fill="#17223b" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
    <text x="207" y="22" font-family="sans-serif" font-size="13" font-weight="600" fill="#34d399" text-anchor="middle">📦 BullMQ Queue</text>

    <rect x="285" y="0" width="115" height="34" rx="17" fill="#17223b" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
    <text x="342" y="22" font-family="sans-serif" font-size="13" font-weight="600" fill="#a78bfa" text-anchor="middle">☁️ S3 / MinIO</text>

    <rect x="415" y="0" width="105" height="34" rx="17" fill="#17223b" stroke="rgba(255,255,255,0.08)" stroke-width="1" />
    <text x="467" y="22" font-family="sans-serif" font-size="13" font-weight="600" fill="#f59e0b" text-anchor="middle">🤖 MCP SDK</text>
  </g>

  <!-- Right: Glassmorphic App Showcase Card -->
  <g transform="translate(730, 95)" filter="url(#shadow)">
    <!-- Container -->
    <rect width="370" height="440" rx="28" fill="url(#cardGrad)" stroke="rgba(255,255,255,0.12)" stroke-width="2" />

    <!-- Card Header -->
    <rect x="24" y="24" width="60" height="60" rx="16" fill="url(#brandGrad)" />
    
    <!-- Mini Logo inside card -->
    <path d="M 44,42 L 64,42 L 54,64 L 66,64 L 46,80 L 50,66 L 40,66 Z" fill="#ffffff" />

    <text x="96" y="48" font-family="sans-serif" font-size="18" font-weight="800" fill="#ffffff">CombusTicket PWA</text>
    <text x="96" y="68" font-family="sans-serif" font-size="13" font-weight="500" fill="#34d399">● Sistema Operativo Activo</text>

    <!-- Simulated Stats / Action Panel -->
    <rect x="24" y="110" width="322" height="74" rx="14" fill="#0c1322" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
    <text x="42" y="138" font-family="sans-serif" font-size="12" font-weight="600" fill="#64748b">ESTADO DE COLA</text>
    <text x="42" y="165" font-family="sans-serif" font-size="18" font-weight="700" fill="#f8fafc">Facturación en Lote</text>
    <text x="270" y="155" font-family="sans-serif" font-size="14" font-weight="800" fill="#10b981">100% OK</text>

    <rect x="24" y="200" width="322" height="74" rx="14" fill="#0c1322" stroke="rgba(255,255,255,0.06)" stroke-width="1" />
    <text x="42" y="228" font-family="sans-serif" font-size="12" font-weight="600" fill="#64748b">STORAGE ACTIVO</text>
    <text x="42" y="255" font-family="sans-serif" font-size="18" font-weight="700" fill="#f8fafc">AWS S3 / MinIO</text>
    <text x="280" y="245" font-family="sans-serif" font-size="16" fill="#38bdf8">☁️</text>

    <!-- Simulated Action Button -->
    <rect x="24" y="295" width="322" height="50" rx="12" fill="url(#brandGrad)" />
    <text x="185" y="326" font-family="sans-serif" font-size="15" font-weight="700" fill="#04121a" text-anchor="middle">⚡ Solicitar Facturas</text>

    <text x="185" y="380" font-family="sans-serif" font-size="12" font-weight="500" fill="#64748b" text-anchor="middle">Instalable como Progressive Web App (PWA)</text>
    <text x="185" y="405" font-family="sans-serif" font-size="11" font-weight="500" fill="#475569" text-anchor="middle">Multiplataforma · iOS · Android · Desktop</text>
  </g>
</svg>
`;

async function generateAssets() {
  console.log('Generating PWA Icons and OpenGraph Assets...');

  // 1. Write SVG masters
  fs.writeFileSync(path.resolve('public/favicon.svg'), masterIconSvg.trim());
  console.log('✓ Wrote public/favicon.svg');

  // 2. Generate PNG icons
  const iconBuffer = Buffer.from(masterIconSvg);
  const maskableBuffer = Buffer.from(maskableIconSvg);
  const ogBuffer = Buffer.from(ogBannerSvg);

  // Favicon PNGs
  await sharp(iconBuffer).resize(16, 16).png().toFile('public/favicon-16x16.png');
  await sharp(iconBuffer).resize(32, 32).png().toFile('public/favicon-32x32.png');
  await sharp(iconBuffer).resize(48, 48).png().toFile('public/favicon.ico');
  console.log('✓ Generated favicons (16x16, 32x32, ico)');

  // Apple Touch Icon
  await sharp(iconBuffer).resize(180, 180).png().toFile('public/icons/apple-touch-icon.png');
  console.log('✓ Generated public/icons/apple-touch-icon.png (180x180)');

  // Standard PWA Icons
  await sharp(iconBuffer).resize(192, 192).png().toFile('public/icons/icon-192x192.png');
  await sharp(iconBuffer).resize(512, 512).png().toFile('public/icons/icon-512x512.png');
  console.log('✓ Generated standard PWA icons (192x192, 512x512)');

  // Maskable PWA Icons (Safe zone padding)
  await sharp(maskableBuffer).resize(192, 192).png().toFile('public/icons/icon-maskable-192x192.png');
  await sharp(maskableBuffer).resize(512, 512).png().toFile('public/icons/icon-maskable-512x512.png');
  console.log('✓ Generated maskable PWA icons (192x192, 512x512)');

  // OpenGraph Image
  await sharp(ogBuffer).resize(1200, 630).png().toFile('public/og-image.png');
  console.log('✓ Generated public/og-image.png (1200x630)');

  console.log('\n--- All PWA & OpenGraph Assets Successfully Generated! ---');
}

generateAssets().catch((err) => {
  console.error('Error generating assets:', err);
  process.exit(1);
});
