/**
 * Draws public/og-image.png (1200×630 link preview) with the game's own
 * renderer, in the style of the share card.
 *
 *   npx vite --port 5174 --strictPort     # in one terminal
 *   node scripts/make-og-image.mjs        # in another (needs Playwright)
 *
 * The committed image was then reduced to 256 colours (~140 KB) so
 * WhatsApp, which skips large preview images, shows it.
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const out = new URL('../public/og-image.png', import.meta.url);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 630 } });
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:5174/'); await p.waitForTimeout(800);
const data = await p.evaluate(async () => {
  const { Session } = await import('/src/game/session.ts');
  const { LEVELS } = await import('/src/levels/index.ts');
  const { parkOnBay } = await import('/src/levels/proof.ts');
  const { quantize } = await import('/src/game/replay.ts');
  const { drawYard } = await import('/src/render/draw-yard.ts');
  const { drawObstacles } = await import('/src/render/draw-obstacles.ts');
  const { drawArtic } = await import('/src/render/draw-vehicle.ts');
  const { starPath } = await import('/src/share/card.ts');
  const logo = new Image(); logo.src = '/brand/logo-on-dark.webp'; await logo.decode();

  const W = 1200, H = 630, ORANGE = '#f85f00', BG = '#111418';
  const FONT = "'DejaVu Sans', 'Liberation Sans', Arial, sans-serif";
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H);
  const hazard = (y, h) => {
    ctx.save(); ctx.beginPath(); ctx.rect(0, y, W, h); ctx.clip();
    ctx.fillStyle = ORANGE; ctx.fillRect(0, y, W, h); ctx.fillStyle = BG;
    for (let x = -h; x < W + h; x += h * 1.6) { ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + h * 0.8, y + h); ctx.lineTo(x + h * 1.6, y); ctx.lineTo(x + h * 0.8, y); ctx.closePath(); ctx.fill(); }
    ctx.restore();
  };
  hazard(0, 22); hazard(H - 16, 16);

  // Scene: level 3 (Sight Side), rig partway round the swing onto Bay 7.
  const level = LEVELS[2];
  const s = new Session(level); s.recording = false; s.reset(); parkOnBay(s);
  for (const m of [{ t: 1, st: 0, d: 7.5 }, { t: 1, st: 0.6, d: 10 }]) {
    let d = 0; const inp = quantize({ steerMode: 'absolute', steer: m.st, throttle: m.t });
    while (d < m.d) { s.step(inp); d += Math.abs(s.artic.speed) / 120; }
  }
  s.artic.speed = -1; s.artic.gear = 'R';
  const bay = s.bay, a = (bay.heading * Math.PI) / 180;
  const at = (al, la) => [bay.x + Math.cos(a) * al - Math.sin(a) * la, bay.y + Math.sin(a) * al + Math.cos(a) * la];
  const px = 610, py = 50, pw = 540, ph = 530;
  const [cx, cy] = at(18.5, 2);
  const k = pw / 34;
  ctx.save(); ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 24); ctx.clip();
  ctx.translate(px + pw / 2, py + ph / 2); ctx.rotate(-a + Math.PI / 2); ctx.scale(k, k); ctx.translate(-cx, -cy);
  drawYard(ctx, s.yard); drawObstacles(ctx, s.obstacles);
  drawArtic(ctx, s.artic);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(px, py, pw, ph, 24); ctx.stroke();

  // Left column: logo, title, pitch, stars, address.
  const lk = Math.min(300 / logo.naturalWidth, 120 / logo.naturalHeight);
  ctx.drawImage(logo, 60, 62, logo.naturalWidth * lk, logo.naturalHeight * lk);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#ffffff'; ctx.font = `bold 86px ${FONT}`;
  ctx.fillText('YARD', 56, 290); ctx.fillText('MASTER', 56, 378);
  ctx.fillStyle = ORANGE; ctx.font = `bold 30px ${FONT}`;
  ctx.fillText('The HGV reversing game', 60, 428);
  ctx.fillStyle = '#c9ced6'; ctx.font = `24px ${FONT}`;
  ctx.fillText('Back a 13.6 m artic onto the bay.', 60, 470);
  ctx.fillText('10 yards · Daily Yard · Leaderboard', 60, 504);
  for (let i = 0; i < 3; i++) { starPath(ctx, 78 + i * 46, 548, 18); ctx.fillStyle = ORANGE; ctx.fill(); }
  ctx.fillStyle = '#ffffff'; ctx.font = `bold 26px ${FONT}`;
  ctx.fillText('hgv1yardmaster.online', 206, 558);
  return c.toDataURL('image/png');
});
writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
console.log('errors', errs);
await b.close();
