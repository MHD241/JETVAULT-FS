// 2D instrument drawing. Every needle position comes from the simulated instrument
// indications (sim/systems), never from the "true" aircraft state.

type Ctx = CanvasRenderingContext2D;
const D2R = Math.PI / 180;

export function bezel(g: Ctx, x: number, y: number, r: number) {
  const grd = g.createRadialGradient(x, y, r * 0.8, x, y, r * 1.12);
  grd.addColorStop(0, '#1a1a1a'); grd.addColorStop(1, '#3a3d40');
  g.fillStyle = grd;
  g.beginPath(); g.arc(x, y, r * 1.12, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0b0c0d';
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}

function needle(g: Ctx, x: number, y: number, ang: number, len: number, w = 4, color = '#f2f2f2', tail = 0.15) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(-w / 2, len * tail); g.lineTo(-w * 0.35, -len * 0.85); g.lineTo(0, -len); g.lineTo(w * 0.35, -len * 0.85); g.lineTo(w / 2, len * tail);
  g.closePath(); g.fill();
  g.restore();
  g.fillStyle = '#222'; g.beginPath(); g.arc(x, y, w * 1.2, 0, Math.PI * 2); g.fill();
}

function ticks(g: Ctx, x: number, y: number, r: number, a0: number, a1: number, n: number, len: number, w = 2, col = '#e8e8e8') {
  g.strokeStyle = col; g.lineWidth = w;
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * D2R - Math.PI / 2;
    g.beginPath();
    g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    g.lineTo(x + Math.cos(a) * (r - len), y + Math.sin(a) * (r - len));
    g.stroke();
  }
}

function arc(g: Ctx, x: number, y: number, r: number, a0: number, a1: number, col: string, w: number) {
  g.strokeStyle = col; g.lineWidth = w;
  g.beginPath(); g.arc(x, y, r, a0 * D2R - Math.PI / 2, a1 * D2R - Math.PI / 2); g.stroke();
}

function label(g: Ctx, text: string, x: number, y: number, size: number, col = '#e8e8e8', align: CanvasTextAlign = 'center') {
  g.fillStyle = col; g.font = `600 ${size}px "Helvetica Neue", Arial, sans-serif`;
  g.textAlign = align; g.textBaseline = 'middle';
  g.fillText(text, x, y);
}

// ---- Airspeed indicator (KIAS)
const asiAngle = (v: number) => (v < 40 ? (v / 40) * 25 : 25 + ((Math.min(v, 200) - 40) / 160) * 310);
export function drawASI(g: Ctx, x: number, y: number, r: number, kias: number) {
  bezel(g, x, y, r);
  arc(g, x, y, r * 0.9, asiAngle(40), asiAngle(85), '#f4f4f4', r * 0.07);
  arc(g, x, y, r * 0.8, asiAngle(48), asiAngle(129), '#1fb24a', r * 0.07);
  arc(g, x, y, r * 0.8, asiAngle(129), asiAngle(163), '#f1c40f', r * 0.07);
  ticks(g, x, y, r * 0.95, asiAngle(163), asiAngle(163), 1, r * 0.25, 4, '#e0281f');
  for (let v = 40; v <= 200; v += 10) ticks(g, x, y, r * 0.95, asiAngle(v), asiAngle(v), 1, v % 20 === 0 ? r * 0.16 : r * 0.09, 2);
  for (let v = 40; v <= 200; v += 20) {
    const a = asiAngle(v) * D2R - Math.PI / 2;
    label(g, String(v), x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.15);
  }
  label(g, 'AIRSPEED', x, y - r * 0.3, r * 0.1);
  label(g, 'KNOTS', x, y + r * 0.32, r * 0.1);
  needle(g, x, y, asiAngle(Math.max(0, kias)) * D2R, r * 0.85, r * 0.06);
}

// ---- Attitude indicator
export function drawAI(g: Ctx, x: number, y: number, r: number, pitch: number, roll: number) {
  bezel(g, x, y, r);
  g.save();
  g.beginPath(); g.arc(x, y, r * 0.97, 0, Math.PI * 2); g.clip();
  g.translate(x, y); g.rotate(-roll * D2R);
  const pp = r * 0.035; // px per degree
  const off = pitch * pp;
  g.fillStyle = '#2d7fd0'; g.fillRect(-r * 2, -r * 3 + off, r * 4, r * 3);
  g.fillStyle = '#7a4a24'; g.fillRect(-r * 2, off, r * 4, r * 3);
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-r * 2, off); g.lineTo(r * 2, off); g.stroke();
  for (let p = -30; p <= 30; p += 5) {
    if (p === 0) continue;
    const w = p % 10 === 0 ? r * 0.3 : r * 0.14;
    const yy = off - p * pp;
    g.beginPath(); g.moveTo(-w / 2, yy); g.lineTo(w / 2, yy); g.stroke();
    if (p % 10 === 0) { label(g, String(Math.abs(p)), -w / 2 - r * 0.1, yy, r * 0.09); label(g, String(Math.abs(p)), w / 2 + r * 0.1, yy, r * 0.09); }
  }
  // roll scale on the rotating card
  for (const a of [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60]) {
    const aa = (a - 90) * D2R;
    g.beginPath(); g.moveTo(Math.cos(aa) * r * 0.8, Math.sin(aa) * r * 0.8);
    g.lineTo(Math.cos(aa) * r * (Math.abs(a) % 30 === 0 ? 0.95 : 0.88), Math.sin(aa) * r * (Math.abs(a) % 30 === 0 ? 0.95 : 0.88)); g.stroke();
  }
  g.restore();
  // fixed sky pointer and aircraft symbol
  g.fillStyle = '#f39c12';
  g.beginPath(); g.moveTo(x, y - r * 0.78); g.lineTo(x - r * 0.06, y - r * 0.66); g.lineTo(x + r * 0.06, y - r * 0.66); g.closePath(); g.fill();
  g.strokeStyle = '#f39c12'; g.lineWidth = r * 0.05;
  g.beginPath(); g.moveTo(x - r * 0.5, y); g.lineTo(x - r * 0.15, y); g.lineTo(x - r * 0.08, y + r * 0.08); g.stroke();
  g.beginPath(); g.moveTo(x + r * 0.5, y); g.lineTo(x + r * 0.15, y); g.lineTo(x + r * 0.08, y + r * 0.08); g.stroke();
  g.fillStyle = '#f39c12'; g.beginPath(); g.arc(x, y, r * 0.03, 0, Math.PI * 2); g.fill();
}

// ---- Altimeter
export function drawALT(g: Ctx, x: number, y: number, r: number, ft: number, kollsmanHpa: number) {
  bezel(g, x, y, r);
  for (let i = 0; i < 50; i++) ticks(g, x, y, r * 0.95, i * 7.2, i * 7.2, 1, i % 5 === 0 ? r * 0.16 : r * 0.08, 2);
  for (let i = 0; i < 10; i++) {
    const a = i * 36 * D2R - Math.PI / 2;
    label(g, String(i), x + Math.cos(a) * r * 0.66, y + Math.sin(a) * r * 0.66, r * 0.18);
  }
  // Kollsman window (hPa)
  g.fillStyle = '#000'; g.fillRect(x + r * 0.28, y - r * 0.09, r * 0.5, r * 0.18);
  label(g, kollsmanHpa.toFixed(0), x + r * 0.53, y, r * 0.12);
  label(g, 'ALT', x, y - r * 0.3, r * 0.1);
  const a = Math.max(ft, -1000);
  needle(g, x, y, ((a / 100000) * 360) * D2R, r * 0.95, r * 0.025, '#ddd', 0); // 10,000s pointer (thin)
  needle(g, x, y, ((a / 10000) * 360) * D2R, r * 0.5, r * 0.09);
  needle(g, x, y, ((a / 1000) * 360) * D2R, r * 0.85, r * 0.05);
}

// ---- Turn coordinator
export function drawTC(g: Ctx, x: number, y: number, r: number, rate: number, ball: number, flag: boolean) {
  bezel(g, x, y, r);
  label(g, 'L', x - r * 0.72, y + r * 0.32, r * 0.13); label(g, 'R', x + r * 0.72, y + r * 0.32, r * 0.13);
  label(g, '2 MIN', x, y + r * 0.62, r * 0.09);
  label(g, 'TURN COORDINATOR', x, y - r * 0.55, r * 0.075);
  g.strokeStyle = '#eee'; g.lineWidth = 3;
  for (const s of [-1, 1]) {
    for (const a of [0, 20]) {
      const aa = (s * a + (s < 0 ? 180 : 0)) * D2R;
      const ca = Math.cos(aa) * (s < 0 ? 1 : 1), sa = Math.sin(aa);
      g.beginPath(); g.moveTo(x + ca * r * 0.72, y + sa * r * 0.72); g.lineTo(x + ca * r * 0.9, y + sa * r * 0.9); g.stroke();
    }
  }
  // aircraft symbol banks 20 deg at standard rate (3 deg/s)
  const bank = Math.max(-35, Math.min(35, (rate / 3) * 20));
  g.save(); g.translate(x, y); g.rotate(bank * D2R);
  g.strokeStyle = '#fff'; g.lineWidth = r * 0.06; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-r * 0.62, 0); g.lineTo(r * 0.62, 0); g.stroke();
  g.beginPath(); g.moveTo(0, -r * 0.2); g.lineTo(0, 0); g.stroke();
  g.beginPath(); g.arc(0, 0, r * 0.08, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
  g.restore();
  // inclinometer
  const tw = r * 0.9, th = r * 0.2, ty = y + r * 0.38;
  g.fillStyle = '#d6d0b4'; g.beginPath(); g.ellipse(x, ty, tw / 2, th / 2, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#111'; g.lineWidth = 2;
  for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x + s * th * 0.62, ty - th / 2); g.lineTo(x + s * th * 0.62, ty + th / 2); g.stroke(); }
  g.fillStyle = '#111'; g.beginPath(); g.arc(x + ball * tw * 0.4, ty, th * 0.42, 0, Math.PI * 2); g.fill();
  if (flag) { g.fillStyle = '#d32f2f'; g.fillRect(x - r * 0.25, y - r * 0.38, r * 0.5, r * 0.14); label(g, 'OFF', x, y - r * 0.31, r * 0.1, '#fff'); }
}

// ---- Heading indicator (DG)
export function drawHI(g: Ctx, x: number, y: number, r: number, hdg: number, bug: number) {
  bezel(g, x, y, r);
  g.save(); g.translate(x, y); g.rotate(-hdg * D2R);
  for (let i = 0; i < 72; i++) {
    const a = i * 5 * D2R - Math.PI / 2;
    const l = i % 6 === 0 ? r * 0.16 : i % 2 === 0 ? r * 0.1 : r * 0.06;
    g.strokeStyle = '#eee'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(Math.cos(a) * r * 0.93, Math.sin(a) * r * 0.93); g.lineTo(Math.cos(a) * (r * 0.93 - l), Math.sin(a) * (r * 0.93 - l)); g.stroke();
  }
  const names: Record<number, string> = { 0: 'N', 9: 'E', 18: 'S', 27: 'W' };
  for (let i = 0; i < 36; i += 3) {
    g.save(); g.rotate(i * 10 * D2R);
    label(g, names[i] ?? String(i), 0, -r * 0.62, r * (names[i] ? 0.18 : 0.14));
    g.restore();
  }
  // heading bug
  g.save(); g.rotate(bug * D2R);
  g.fillStyle = '#f39c12';
  g.fillRect(-r * 0.09, -r * 0.99, r * 0.06, r * 0.1); g.fillRect(r * 0.03, -r * 0.99, r * 0.06, r * 0.1);
  g.restore();
  g.restore();
  // lubber line and aircraft symbol
  g.fillStyle = '#f39c12';
  g.beginPath(); g.moveTo(x, y - r * 0.82); g.lineTo(x - r * 0.05, y - r * 0.94); g.lineTo(x + r * 0.05, y - r * 0.94); g.closePath(); g.fill();
  g.strokeStyle = '#f39c12'; g.lineWidth = r * 0.04;
  g.beginPath(); g.moveTo(x, y - r * 0.3); g.lineTo(x, y + r * 0.3); g.moveTo(x - r * 0.25, y - r * 0.02); g.lineTo(x + r * 0.25, y - r * 0.02); g.moveTo(x - r * 0.1, y + r * 0.25); g.lineTo(x + r * 0.1, y + r * 0.25); g.stroke();
}

// ---- Vertical speed indicator (fpm)
export function drawVSI(g: Ctx, x: number, y: number, r: number, fpm: number) {
  bezel(g, x, y, r);
  const ang = (v: number) => -90 + (Math.max(-2000, Math.min(2000, v)) / 2000) * 170;
  for (let v = -2000; v <= 2000; v += 100) ticks(g, x, y, r * 0.95, ang(v), ang(v), 1, v % 500 === 0 ? r * 0.16 : r * 0.08, 2);
  for (const v of [0, 5, 10, 15, 20]) {
    for (const s of v === 0 ? [1] : [-1, 1]) {
      const a = ang(s * v * 100) * D2R - Math.PI / 2;
      label(g, String(v), x + Math.cos(a) * r * 0.64, y + Math.sin(a) * r * 0.64, r * 0.16);
    }
  }
  label(g, 'UP', x - r * 0.3, y - r * 0.3, r * 0.1); label(g, 'DOWN', x - r * 0.3, y + r * 0.3, r * 0.1);
  label(g, 'VERTICAL SPEED', x + r * 0.15, y - r * 0.12, r * 0.07); label(g, '100 FT PER MIN', x + r * 0.15, y + r * 0.12, r * 0.07);
  needle(g, x, y, ang(fpm) * D2R, r * 0.85, r * 0.06);
}

// ---- Tachometer
export function drawTach(g: Ctx, x: number, y: number, r: number, rpm: number, hobbs: number) {
  bezel(g, x, y, r);
  const ang = (v: number) => -130 + (Math.min(v, 3500) / 3500) * 260;
  arc(g, x, y, r * 0.85, ang(2100), ang(2700), '#1fb24a', r * 0.08);
  ticks(g, x, y, r * 0.95, ang(2700), ang(2700), 1, r * 0.25, 4, '#e0281f');
  for (let v = 0; v <= 3500; v += 100) ticks(g, x, y, r * 0.95, ang(v), ang(v), 1, v % 500 === 0 ? r * 0.15 : r * 0.07, 2);
  for (let v = 0; v <= 35; v += 5) {
    const a = ang(v * 100) * D2R - Math.PI / 2;
    label(g, String(v), x + Math.cos(a) * r * 0.63, y + Math.sin(a) * r * 0.63, r * 0.15);
  }
  label(g, 'RPM', x, y - r * 0.3, r * 0.1); label(g, 'X100', x, y - r * 0.17, r * 0.08);
  g.fillStyle = '#000'; g.fillRect(x - r * 0.3, y + r * 0.35, r * 0.6, r * 0.17);
  label(g, hobbs.toFixed(1).padStart(6, '0'), x, y + r * 0.44, r * 0.12);
  needle(g, x, y, ang(rpm) * D2R, r * 0.85, r * 0.06);
}

/** Small dual or single gauge for the engine cluster. */
export function drawMini(g: Ctx, x: number, y: number, w: number, h: number, title: string, value: number, min: number, max: number,
  green: [number, number] | null, red: [number, number] | null, fmt: (v: number) => string, powered = true) {
  g.fillStyle = '#0b0c0d'; g.fillRect(x, y, w, h);
  g.strokeStyle = '#3a3d40'; g.lineWidth = 3; g.strokeRect(x, y, w, h);
  label(g, title, x + w / 2, y + h * 0.16, h * 0.15);
  const bx = x + w * 0.1, bw = w * 0.8, by = y + h * 0.5;
  const pos = (v: number) => bx + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * bw;
  g.strokeStyle = '#e8e8e8'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + bw, by); g.stroke();
  if (green) { g.strokeStyle = '#1fb24a'; g.lineWidth = 6; g.beginPath(); g.moveTo(pos(green[0]), by); g.lineTo(pos(green[1]), by); g.stroke(); }
  if (red) { g.strokeStyle = '#e0281f'; g.lineWidth = 6; g.beginPath(); g.moveTo(pos(red[0]), by); g.lineTo(pos(red[1]), by); g.stroke(); }
  for (let i = 0; i <= 4; i++) { const tx = bx + (bw * i) / 4; g.strokeStyle = '#ddd'; g.lineWidth = 2; g.beginPath(); g.moveTo(tx, by - 6); g.lineTo(tx, by + 6); g.stroke(); }
  if (powered) {
    const px = pos(value);
    g.fillStyle = '#f2f2f2';
    g.beginPath(); g.moveTo(px, by + 4); g.lineTo(px - 7, by + 20); g.lineTo(px + 7, by + 20); g.closePath(); g.fill();
    label(g, fmt(value), x + w / 2, y + h * 0.82, h * 0.15, '#bbb');
  }
}

export function drawAnnunciator(g: Ctx, x: number, y: number, w: number, h: number, items: [string, boolean, string][]) {
  g.fillStyle = '#060606'; g.fillRect(x, y, w, h);
  const cw = w / items.length;
  items.forEach(([t, on, col], i) => {
    g.fillStyle = on ? col : '#1d1d1d';
    g.fillRect(x + i * cw + 4, y + 4, cw - 8, h - 8);
    label(g, t, x + i * cw + cw / 2, y + h / 2, h * 0.32, on ? '#000' : '#444');
  });
}

export { label, needle, bezel as drawBezel };
