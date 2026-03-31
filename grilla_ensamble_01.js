// ── Canvas setup ──────────────────────────────────────────────────────────────
let canvas, ctx, overlay, octx;
let W, H, curves = [], nodes = [];
let mul = 1.2, connCount = 18, strokeW = 1.6;
const DPI = 96;
const CM_TO_PX = DPI / 2.54;
const OVERFLOW_PREVIEW_SCALE = 0.9;
const AUDIO_VOICE_LIMITS = {
  bezier: 1,
  sine: 4,
  arc: 2,
  angular: 2,
  spiral: 4,
  catenary: 4,
  clothoid: 2,
  irregular: 2,
  lissajous: 3,
  epitrochoid: 3,
  pursuit: 2,
};
let p5Main = null;
let p5Overlay = null;
let p5MainReady = false;
let p5OverlayReady = false;
let appBooted = false;

function audioVoiceLimitFor(type) {
  return AUDIO_VOICE_LIMITS[type] ?? 3;
}

// Arranca la app una sola vez, cuando ambos layers p5 ya existen.
function tryBootApp() {
  if (appBooted || !p5MainReady || !p5OverlayReady) return;
  canvas  = document.getElementById('c');
  overlay = document.getElementById('cOverlay');
  if (!canvas || !overlay) return;
  ctx  = canvas.getContext('2d');
  octx = overlay.getContext('2d');
  appBooted = true;
  applyCanvasSize();
  generateCurves();
  render();
}

// Crea dos canvases p5:
// 1) `c` para la obra
// 2) `cOverlay` para guias y previsualizaciones por encima
function initP5Layers() {
  const wrap = document.getElementById('canvasWrap');
  p5MainReady = false;
  p5OverlayReady = false;
  appBooted = false;
  const prevMain = document.getElementById('c');
  const prevOverlay = document.getElementById('cOverlay');
  if (prevMain) prevMain.remove();
  if (prevOverlay) prevOverlay.remove();
  if (p5Main) p5Main.remove();
  if (p5Overlay) p5Overlay.remove();

  p5Main = new p5((p) => {
    p.setup = () => {
      const cnv = p.createCanvas(1, 1);
      cnv.parent(wrap);
      cnv.id('c');
      cnv.style('z-index', '1');
      p.noLoop();
      p5MainReady = true;
      tryBootApp();
    };
  });

  p5Overlay = new p5((p) => {
    p.setup = () => {
      const cnv = p.createCanvas(1, 1);
      cnv.parent(wrap);
      cnv.id('cOverlay');
      cnv.style('position', 'absolute');
      cnv.style('top', '0');
      cnv.style('left', '0');
      cnv.style('width', '100%');
      cnv.style('height', '100%');
      cnv.style('transform', 'none');
      cnv.style('margin', '0');
      cnv.style('pointer-events', 'none');
      cnv.style('z-index', '2');
      p.noLoop();
      p5OverlayReady = true;
      tryBootApp();
    };
  });

}

// ── RNG seeded (Mulberry32) ───────────────────────────────────────────────────
let _seed = 1024;
function seedRNG(s) { _seed = s >>> 0; }
function srng() {
  _seed += 0x6D2B79F5;
  let t = _seed;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
}

function getCmDims() {
  const wCm = parseFloat(document.getElementById('cwCm').value) || 29;
  const hCm = parseFloat(document.getElementById('chCm').value) || 52;
  return { wCm, hCm };
}

function applyCanvasSize() {
  if (!canvas) return;
  const { wCm, hCm } = getCmDims();
  // Resolucion interna real (pixeles de trabajo).
  W = Math.round(wCm * CM_TO_PX);
  H = Math.round(hCm * CM_TO_PX);
  if (p5Main) p5Main.resizeCanvas(W, H, true);
  canvas.width  = W;
  canvas.height = H;
  const wrap  = canvas.parentElement;
  const rect  = wrap.getBoundingClientRect();
  // Escala visual CSS: mantiene la obra completa visible y deja margen para overflow.
  const margin = showOverflow ? 80 : 32;
  const fitScale = Math.min((rect.width - margin) / W, (rect.height - margin) / H, 1);
  const scale  = showOverflow ? Math.min(fitScale, OVERFLOW_PREVIEW_SCALE) : fitScale;
  canvas.style.width  = (W * scale) + 'px';
  canvas.style.height = (H * scale) + 'px';
  requestAnimationFrame(drawRulers);
}

// ── Rulers ───────────────────────────────────────────────────────────────────
function drawRulers() {
  const { wCm, hCm } = getCmDims();

  // Obtener posición y tamaño visual del canvas en pantalla
  const c      = document.getElementById('c');
  const wrap   = document.getElementById('canvasWrap');
  const wRect  = wrap.getBoundingClientRect();
  const cRect  = c.getBoundingClientRect();

  // Offset del canvas dentro del wrap — redondeado a píxel entero para evitar jitter
  const offX = Math.round(cRect.left - wRect.left);
  const offY = Math.round(cRect.top  - wRect.top);
  const visW = cRect.width;
  const visH = cRect.height;

  // px por cm en pantalla (escala visual, no real)
  const pxPerCmX = visW / wCm;
  const pxPerCmY = visH / hCm;

  const RULER_H  = 20;
  const COL_BG   = 'rgba(9,11,14,0.94)';
  const COL_TK   = 'rgba(255,255,255,0.14)';   // ticks silenciosos
  const COL_TK_M = 'rgba(255,255,255,0.22)';   // tick major (cada 5cm)
  const COL_AX   = 'rgba(255,255,255,0.7)';    // tick de eje activo
  const COL_AX_N = 'rgba(255,255,255,0.55)';   // número del eje
  const FONT_AX  = "7.5px 'DM Mono', monospace"; // números de ejes — pequeños

  // ── Ruler superior ──────────────────────────────────────────────
  const rtCanvas = document.getElementById('rulerTop');
  const rtDiv    = rtCanvas.parentElement;
  rtDiv.style.left   = '0';
  rtDiv.style.top    = offY + 'px';
  rtDiv.style.height = RULER_H + 'px';
  rtDiv.style.width  = wRect.width + 'px';

  rtCanvas.width  = wRect.width;
  rtCanvas.height = RULER_H;
  const rtx = rtCanvas.getContext('2d');

  rtx.fillStyle = COL_BG;
  rtx.fillRect(0, 0, rtCanvas.width, RULER_H);

  // Solo ticks, sin números — ritmo visual silencioso
  for (let cm = 0; cm <= wCm; cm++) {
    const x       = offX + cm * pxPerCmX;
    const isMajor = cm % 5 === 0;
    const tkH     = isMajor ? 8 : 4;
    rtx.strokeStyle = isMajor ? COL_TK_M : COL_TK;
    rtx.lineWidth   = isMajor ? 0.7 : 0.5;
    rtx.beginPath();
    rtx.moveTo(x, RULER_H);
    rtx.lineTo(x, RULER_H - tkH);
    rtx.stroke();
  }

  // Ejes activos — línea + número único
  if (showGuides && gridAxes.colX.length) {
    for (const px of gridAxes.colX) {
      const screenX = offX + (px / W) * visW;
      const cm      = (px / W * wCm).toFixed(1);
      // línea fina de borde a borde del ruler
      rtx.strokeStyle = COL_AX;
      rtx.lineWidth   = 0.8;
      rtx.beginPath();
      rtx.moveTo(screenX, 0);
      rtx.lineTo(screenX, RULER_H);
      rtx.stroke();
      // número pequeño centrado en la mitad superior
      rtx.fillStyle   = COL_AX_N;
      rtx.font        = FONT_AX;
      rtx.textAlign   = 'center';
      rtx.textBaseline = 'middle';
      rtx.fillText(cm, screenX, 7);
    }
  }

  // Nodos acústicos — marca en ruler superior (posición X del centro)
  if (acousticMode && acousticNodes.length) {
    for (const n of acousticNodes) {
      const screenX = offX + (n.cx / W) * visW;
      const cm      = (n.cx / W * wCm).toFixed(1);
      rtx.strokeStyle = 'rgba(60,216,160,0.7)';
      rtx.lineWidth   = 0.8;
      rtx.beginPath();
      rtx.moveTo(screenX, RULER_H);
      rtx.lineTo(screenX, RULER_H * 0.3);
      rtx.stroke();
      // pequeño triángulo apuntando hacia abajo
      rtx.fillStyle = 'rgba(60,216,160,0.7)';
      rtx.beginPath();
      rtx.moveTo(screenX - 3, RULER_H * 0.3);
      rtx.lineTo(screenX + 3, RULER_H * 0.3);
      rtx.lineTo(screenX, RULER_H * 0.6);
      rtx.closePath();
      rtx.fill();
      rtx.fillStyle   = 'rgba(60,216,160,0.85)';
      rtx.font        = FONT_AX;
      rtx.textAlign   = 'center';
      rtx.textBaseline = 'middle';
      rtx.fillText(cm, screenX, 6);
    }
  }

  // ── Ruler izquierdo ─────────────────────────────────────────────
  const rlCanvas = document.getElementById('rulerLeft');
  const rlDiv    = rlCanvas.parentElement;
  rlDiv.style.top    = '0';
  rlDiv.style.left   = offX + 'px';
  rlDiv.style.width  = RULER_H + 'px';
  rlDiv.style.height = wRect.height + 'px';

  rlCanvas.width  = RULER_H;
  rlCanvas.height = wRect.height;
  const rlx = rlCanvas.getContext('2d');

  rlx.fillStyle = COL_BG;
  rlx.fillRect(0, 0, RULER_H, rlCanvas.height);

  // Solo ticks
  for (let cm = 0; cm <= hCm; cm++) {
    const y       = offY + cm * pxPerCmY;
    const isMajor = cm % 5 === 0;
    const tkH     = isMajor ? 8 : 4;
    rlx.strokeStyle = isMajor ? COL_TK_M : COL_TK;
    rlx.lineWidth   = isMajor ? 0.7 : 0.5;
    rlx.beginPath();
    rlx.moveTo(RULER_H, y);
    rlx.lineTo(RULER_H - tkH, y);
    rlx.stroke();
  }

  // Ejes activos — línea + número rotado
  if (showGuides && gridAxes.rowY.length) {
    for (const py of gridAxes.rowY) {
      const screenY = offY + (py / H) * visH;
      const cm      = (py / H * hCm).toFixed(1);
      rlx.strokeStyle = COL_AX;
      rlx.lineWidth   = 0.8;
      rlx.beginPath();
      rlx.moveTo(0, screenY);
      rlx.lineTo(RULER_H, screenY);
      rlx.stroke();
      // número rotado, centrado en la mitad izquierda del ruler
      rlx.save();
      rlx.translate(7, screenY);
      rlx.rotate(-Math.PI / 2);
      rlx.fillStyle    = COL_AX_N;
      rlx.font         = FONT_AX;
      rlx.textAlign    = 'center';
      rlx.textBaseline = 'middle';
      rlx.fillText(cm, 0, 0);
      rlx.restore();
    }
  }

  // Nodos acústicos — marca en ruler izquierdo (posición Y del centro)
  if (acousticMode && acousticNodes.length) {
    for (const n of acousticNodes) {
      const screenY = offY + (n.cy / H) * visH;
      const cm      = (n.cy / H * hCm).toFixed(1);
      rlx.strokeStyle = 'rgba(60,216,160,0.7)';
      rlx.lineWidth   = 0.8;
      rlx.beginPath();
      rlx.moveTo(RULER_H, screenY);
      rlx.lineTo(RULER_H * 0.3, screenY);
      rlx.stroke();
      // pequeño triángulo apuntando hacia la derecha
      rlx.fillStyle = 'rgba(60,216,160,0.7)';
      rlx.beginPath();
      rlx.moveTo(RULER_H * 0.3, screenY - 3);
      rlx.lineTo(RULER_H * 0.3, screenY + 3);
      rlx.lineTo(RULER_H * 0.6, screenY);
      rlx.closePath();
      rlx.fill();
      rlx.save();
      rlx.translate(6, screenY);
      rlx.rotate(-Math.PI / 2);
      rlx.fillStyle    = 'rgba(60,216,160,0.85)';
      rlx.font         = FONT_AX;
      rlx.textAlign    = 'center';
      rlx.textBaseline = 'middle';
      rlx.fillText(cm, 0, 0);
      rlx.restore();
    }
  }
}

function resize() {
  applyCanvasSize();
  generateCurves();
  render();
}
window.addEventListener('resize', () => {
  applyCanvasSize();
  render();
});

// ── Utilities ─────────────────────────────────────────────────────────────────
const lerp   = (a, b, t) => a + (b - a) * t;
const noise1 = (x) => { const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453; return s - Math.floor(s); };
const rnd    = (a, b) => a + srng() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));

// ── Curve builders ────────────────────────────────────────────────────────────
function bezierPts(ax, ay, bx, by, c) {
  const dx = bx - ax, dy = by - ay;
  const d = Math.hypot(dx, dy);
  const nx = -dy/d, ny = dx/d;
  const bend = d * c.bendFactor * c.mul;
  const jit  = c.jitter;
  const cx1 = ax + dx*0.33 + nx*bend*jit;
  const cy1 = ay + dy*0.33 + ny*bend*jit;
  const cx2 = ax + dx*0.66 - nx*bend*jit;
  const cy2 = ay + dy*0.66 - ny*bend*jit;
  const pts = [];
  const steps = 48;
  for (let i = 0; i <= steps; i++) {
    const t = i/steps, mt = 1-t;
    pts.push({
      x: mt**3*ax + 3*mt**2*t*cx1 + 3*mt*t**2*cx2 + t**3*bx,
      y: mt**3*ay + 3*mt**2*t*cy1 + 3*mt*t**2*cy2 + t**3*by,
    });
  }
  return pts;
}
function sinePts(ax, ay, bx, by, c) {
  const dx = bx-ax, dy = by-ay, d = Math.hypot(dx,dy);
  const nx = -dy/d, ny = dx/d;
  const amp = (d*0.08+6) * c.mul;
  const steps = 60;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i/steps, env = Math.sin(t*Math.PI);
    const wave = Math.sin(t*Math.PI*2*c.freq + c.phase) * env;
    pts.push({ x: ax+dx*t + nx*wave*amp, y: ay+dy*t + ny*wave*amp });
  }
  return pts;
}
function arcPts(ax, ay, bx, by, c) {
  const mx=(ax+bx)*0.5, my=(ay+by)*0.5;
  const dx=bx-ax, dy=by-ay, d=Math.hypot(dx,dy);
  const nx=-(by-ay)/d, ny=(bx-ax)/d;
  const bend=d*c.bendFactor*c.mul;
  const cx=mx+nx*bend, cy=my+ny*bend;
  const r=Math.hypot(ax-cx,ay-cy);
  const a0=Math.atan2(ay-cy,ax-cx), a1=Math.atan2(by-cy,bx-cx);
  let delta=a1-a0;
  while(delta>Math.PI) delta-=Math.PI*2;
  while(delta<-Math.PI) delta+=Math.PI*2;
  const pts=[];
  for(let i=0;i<=48;i++){
    const a=a0+delta*(i/48);
    pts.push({x:cx+Math.cos(a)*r, y:cy+Math.sin(a)*r});
  }
  return pts;
}
function angularPts(ax, ay, bx, by, c) {
  const dx=bx-ax, dy=by-ay, d=Math.hypot(dx,dy);
  const nx=-dy/d, ny=dx/d;
  const bend=d*c.bendFactor*c.mul;
  return [{x:ax,y:ay},{x:(ax+bx)*0.5+nx*bend*c.jitter,y:(ay+by)*0.5+ny*bend*c.jitter},{x:bx,y:by}];
}
function spiralPts(ax, ay, bx, by, c) {
  const d=Math.hypot(bx-ax,by-ay);
  const maxR=d*0.22*c.mul;
  const steps=80;
  const pts=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps, r=maxR*Math.sin(t*Math.PI), ang=t*Math.PI*2;
    pts.push({x:lerp(ax,bx,t)+Math.cos(ang)*r, y:lerp(ay,by,t)+Math.sin(ang)*r});
  }
  return pts;
}
function catenaryPts(ax, ay, bx, by, c) {
  const dx=bx-ax, dy=by-ay, d=Math.hypot(dx,dy);
  const nx=-dy/d, ny=dx/d, amp=d*0.2*c.mul;
  const steps=40;
  const pts=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps, xn=t*2-1;
    const cat=(Math.cosh(xn*1.12)-1)/(Math.cosh(1.12)-1);
    pts.push({x:ax+dx*t+nx*(-(1-cat)*amp), y:ay+dy*t+ny*(-(1-cat)*amp)});
  }
  return pts;
}
function clothoidPts(ax, ay, bx, by, c) {
  const dx=bx-ax, dy=by-ay, d=Math.hypot(dx,dy);
  const nx=-dy/d, ny=dx/d, amp=d*0.16*c.mul;
  const steps=60;
  const pts=[];
  for(let i=0;i<=steps;i++){
    const t=i/steps, s=t*2-1, euler=s*Math.abs(s), env=Math.sin(t*Math.PI);
    pts.push({x:ax+dx*t+nx*amp*euler*env*1.35, y:ay+dy*t+ny*amp*euler*env*1.35});
  }
  return pts;
}
function irregularPts(ax, ay, bx, by, c) {
  const dx=bx-ax, dy=by-ay, d=Math.hypot(dx,dy);
  const nx=-dy/d, ny=dx/d;
  const segs=c.segs, ampBase=d*0.14*c.mul;
  const ctrl=[{x:ax,y:ay}];
  for(let i=1;i<segs;i++){
    const t=i/segs, env=Math.sin(t*Math.PI);
    const w=noise1(c.seed+t*3.7)*2-1;
    const lv=noise1(c.seed+t*9.1)*0.8+0.55;
    ctrl.push({x:lerp(ax,bx,t)+nx*w*ampBase*env*lv, y:lerp(ay,by,t)+ny*w*ampBase*env*lv});
  }
  ctrl.push({x:bx,y:by});
  const pts=[];
  for(let i=0;i<ctrl.length-1;i++){
    const p0=ctrl[i], p3=ctrl[i+1];
    const dd=Math.hypot(p3.x-p0.x,p3.y-p0.y)||1;
    const ux=(p3.x-p0.x)/dd, uy=(p3.y-p0.y)/dd, nnx=-uy, nny=ux;
    const ls=c.seed+i*0.77;
    const pull=dd*c.mul*(noise1(ls)*0.28+0.14);
    const side=dd*c.mul*(noise1(ls+2.4)*0.52-0.26);
    const c1={x:p0.x+ux*pull+nnx*side, y:p0.y+uy*pull+nny*side};
    const c2={x:p3.x-ux*pull-nnx*side, y:p3.y-uy*pull-nny*side};
    const steps=Math.max(8,Math.floor(dd/18));
    for(let k=(i===0?0:1);k<=steps;k++){
      const t=k/steps, mt=1-t;
      pts.push({
        x:mt**3*p0.x+3*mt**2*t*c1.x+3*mt*t**2*c2.x+t**3*p3.x,
        y:mt**3*p0.y+3*mt**2*t*c1.y+3*mt*t**2*c2.y+t**3*p3.y,
      });
    }
  }
  return pts;
}
function lissajousPts(ax, ay, bx, by, c) {
  // Usa un ciclo parcial para que la curva arranque cerca de A y termine cerca de B.
  // El eje longitudinal avanza de A a B linealmente; el eje transversal oscila.
  const dx=bx-ax, dy=by-ay, d=Math.hypot(dx,dy)||1;
  const ux=dx/d, uy=dy/d, nx=-uy, ny=ux;
  const ampY = d * 0.16 * c.mul;
  const steps = 100;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t    = i / steps;                          // 0→1 avance A→B
    const ang  = t * Math.PI * c.freqY + c.delta;   // oscilación transversal
    const wave = Math.sin(ang) * Math.sin(t * Math.PI); // envolvente: 0 en extremos
    pts.push({
      x: ax + dx*t + nx*wave*ampY,
      y: ay + dy*t + ny*wave*ampY,
    });
  }
  return pts;
}
function epitrochoidPts(ax, ay, bx, by, c) {
  const dx=bx-ax, dy=by-ay, d=Math.hypot(dx,dy);
  const ux=dx/d, uy=dy/d, nx=-uy, ny=ux;
  const R=d*c.R, r=d*c.r, dd=d*c.d;
  const scale=(d*0.14*c.mul)/Math.max(1,R+r+dd);
  const steps=160;
  const pts=[];
  for(let i=0;i<=steps;i++){
    const t=(i/steps)*Math.PI*2, progress=i/steps;
    // Envolvente suave: fuerza llegada a cero en extremos sin tocar el medio
    const env = Math.sin(progress * Math.PI);
    const epiY=(R+r)*Math.sin(t)-dd*Math.sin(((R+r)/r)*t);
    pts.push({x:ax+ux*(progress*d)+nx*epiY*scale*env, y:ay+uy*(progress*d)+ny*epiY*scale*env});
  }
  return pts;
}
function pursuitPts(ax, ay, bx, by, c) {
  const d=Math.hypot(bx-ax,by-ay);
  const N=c.steps, stepSize=(d/N)*c.mul, dir=c.dir;
  let hx=ax, hy=ay;
  const pts=[{x:hx,y:hy}];
  for(let i=1;i<=N;i++){
    const pt=dir>0?i/N:1-i/N;
    const px=bx+(ax-bx)*pt, py=by+(ay-by)*pt;
    const ddx=px-hx, ddy=py-hy, dd=Math.hypot(ddx,ddy);
    if(dd<0.5){pts.push({x:bx,y:by});break;}
    const step=Math.min(stepSize,dd);
    hx+=(ddx/dd)*step; hy+=(ddy/dd)*step;
    pts.push({x:hx,y:hy});
  }
  pts[pts.length-1]={x:bx,y:by};
  return pts;
}

const CURVE_FNS = {
  bezier:bezierPts, sine:sinePts, arc:arcPts, angular:angularPts,
  spiral:spiralPts, catenary:catenaryPts, clothoid:clothoidPts,
  irregular:irregularPts, lissajous:lissajousPts,
  epitrochoid:epitrochoidPts, pursuit:pursuitPts,
};

// ── Desvío de superficie ──────────────────────────────────────────────────────
// segPts : puntos reales de la curva entre i1 e i2
// amplitude: distancia perpendicular máxima (sign = lado)
// typeA: perfil de la mitad de salida (0 → pico)
// typeB: perfil de la mitad de vuelta (pico → fin)
// peakT: dónde ocurre el pico a lo largo del segmento (0.2–0.8)
//
// La normal se calcula punto a punto sobre la curva real → la forma del
// desvío hereda la geometría de la curva base, no solo la cuerda recta.
function deviationPts(segPts, amplitude, typeA, typeB, seedVal, peakT) {
  const count = segPts.length;
  if (count < 2) return segPts.slice();
  const pk  = peakT ?? 0.5;
  const sv  = seedVal || 17;
  const pts = [];

  // Perfil de offset por tipo — determina cómo evoluciona la distancia
  // perpendicular en cada mitad. t va de 0 a 1 dentro de su mitad.
  const profile = (type, t) => {
    switch(type) {
      case 'bezier':     return Math.sin(t * Math.PI * 0.5);           // arranque suave, llega curvo
      case 'arc':        return Math.sqrt(t);                           // arranque rápido, techo plano
      case 'angular':    return t;                                       // rampa lineal pura
      case 'sine':       return Math.sin(t * Math.PI * 0.5);           // igual a bezier pero con ripple abajo
      case 'irregular':  return t + (noise1(sv + t*3.1)*2-1)*0.22*Math.sin(t*Math.PI); // suave con variación
      case 'catenary':   return 1 - (Math.cosh((t*2-1)*1.4)-1)/(Math.cosh(1.4)-1);    // cóncavo — se hunde antes del pico
      case 'spiral':     return t * (1 + 0.35*Math.sin(t*Math.PI*4));  // oscila mientras sube
      case 'clothoid':   return t*t;                                    // cuadrático — lento al inicio
      case 'lissajous':  return Math.abs(Math.sin(t * Math.PI * 2));   // dos picos menores antes del pico real
      case 'epitrochoid':return t + 0.28*Math.sin(t*Math.PI*5)*(1-t); // bucles pequeños en el borde
      case 'pursuit':    return Math.pow(t, 0.45);                     // muy rápido al inicio, se aplana
      default:           return Math.sin(t * Math.PI * 0.5);
    }
  };

  for (let i = 0; i < count; i++) {
    const tGlobal = i / (count - 1);

    // Normal local: tangente desde el punto anterior al siguiente en la curva real
    const iA = Math.max(0, i - 1);
    const iB = Math.min(count - 1, i + 1);
    const tdx = segPts[iB].x - segPts[iA].x;
    const tdy = segPts[iB].y - segPts[iA].y;
    const tl  = Math.hypot(tdx, tdy) || 1;
    const nx  = -tdy / tl;
    const ny  =  tdx / tl;

    // Determinar mitad y parámetro local dentro de ella
    let off;
    if (tGlobal <= pk) {
      const tLocal = tGlobal / pk;                         // 0→1 en la mitad de salida
      off = amplitude * profile(typeA, tLocal);
    } else {
      const tLocal = (tGlobal - pk) / (1 - pk);           // 0→1 en la mitad de vuelta
      off = amplitude * profile(typeB, 1 - tLocal);        // espeja: baja desde el pico
    }

    pts.push({
      x: segPts[i].x + nx * off,
      y: segPts[i].y + ny * off,
    });
  }
  return pts;
}

// Genera los parches de superficie a partir de las curvas activas.
// Llamar siempre DESPUÉS de generateAcousticNodes() para no alterar el RNG de los nodos.
function generateSurfaces() {
  // Restaurar estado del RNG desde el punto guardado → mismo seed = mismas superficies
  _seed = _surfSeedState;
  surfaces = [];
  if (!surfacesMode || !curves.length || !surfDevTypes.length) return;

  for (const crv of curves) {
    const pts = crv.pts;
    if (!pts || pts.length < 10) continue;

    // Booleano por curva — si no pasa la probabilidad, esta curva queda solo como línea
    if (srng() > surfDensity) continue;

    // Pool de tipos barajado para esta curva — garantiza que los parches
    // dentro de la misma curva nunca repiten tipo ni peakT cercano
    const available = surfDevTypes.slice();
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(srng() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }

    // Divide el rango 0.2–0.8 en surfPatchCount franjas para peakT
    const peakStep = 0.6 / surfPatchCount;

    for (let pi = 0; pi < surfPatchCount; pi++) {
      // Dividir la curva en zonas para que los parches no se solapen
      const zoneA  = pi / surfPatchCount;
      const zoneB  = (pi + 1) / surfPatchCount;
      const margin = 0.08;
      const tRange = (zoneB - zoneA) - margin * 2;
      if (tRange < 0.1) continue;

      // t1: inicio del parche dentro de la zona
      const t1     = zoneA + margin + srng() * tRange * 0.5;
      // longitud del segmento: 20–40% de la longitud total de la curva
      const segLen = 0.20 + srng() * 0.20;
      const t2     = Math.min(t1 + segLen, zoneB - margin);
      if (t2 <= t1 + 0.06) continue;

      const i1 = Math.round(t1 * (pts.length - 1));
      const i2 = Math.round(t2 * (pts.length - 1));
      if (i2 - i1 < 4) continue;

      const p1      = pts[i1];
      const p2      = pts[i2];
      const segDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (segDist < 12) continue;

      // Amplitud: limitada por surfAmpMax y por la longitud del segmento
      const ampRaw = surfAmpMax * (0.45 + srng() * 0.55);
      const amp    = Math.min(ampRaw, segDist * 0.55);
      const side   = srng() < 0.5 ? 1 : -1;

      // typeA (salida) y typeB (vuelta) distintos — round-robin sobre el pool barajado
      const typeA   = available[pi * 2       % available.length];
      const typeB   = available[(pi * 2 + 1) % available.length];
      const seedVal = srng() * 100;
      // peakT: franja exclusiva por parche → formas siempre distintas
      const peakT   = 0.2 + pi * peakStep + srng() * peakStep * 0.85;

      const segPts = pts.slice(i1, i2 + 1);
      const devPts = deviationPts(segPts, amp * side, typeA, typeB, seedVal, peakT);

      // Polígono cerrado: segmento original avanza, desvío retrocede
      const polygon = [...segPts, ...devPts.slice().reverse()];

      surfaces.push({ polygon, color: CURVE_COLORS[crv.type] || '#ffffff' });
    }
  }
}

const CURVE_COLORS = {
  bezier:'#4f7fff', sine:'#7fc8ff', arc:'#a0e8d0',
  angular:'#ffb86c', spiral:'#d8a0ff', catenary:'#ff9090',
  clothoid:'#90d8ff', irregular:'#c8c890',
  lissajous:'#ff6b35', epitrochoid:'#ff9960', pursuit:'#ffcc88',
};

// ── Params per type ───────────────────────────────────────────────────────────
function makeParams(type) {
  const base = { mul };
  const p = {
    bezier:      { bendFactor:rnd(0.12,0.45), jitter:rnd(0.35,1.0) },
    sine:        { freq:rnd(0.8,1.8), phase:rnd(0,Math.PI*2) },
    arc:         { bendFactor:rnd(0.15,0.5) },
    angular:     { bendFactor:rnd(0.2,0.6), jitter:rnd(-1,1) },
    spiral:      {},
    catenary:    {},
    clothoid:    {},
    irregular:   { segs:rndInt(3,6), seed:rnd(0,100) },
    lissajous:   { freqX:rndInt(1,3), freqY:rndInt(1,4), delta:rnd(0,Math.PI*2) },
    epitrochoid: { R:rnd(0.18,0.42), r:rnd(0.06,0.18), d:rnd(0.05,0.22) },
    pursuit:     { steps:rndInt(32,80), dir:srng()<0.5?1:-1 },
  }[type] || {};
  return { ...base, ...p };
}

// ── Active curve types ────────────────────────────────────────────────────────
function getActiveTypes() {
  if (todoMode) return ALL_TYPES;
  const active = [...document.querySelectorAll('.chip.on')].map(c => c.dataset.curve);
  return active.length ? active : ALL_TYPES;
}

let harmonicMode = false;
let acousticMode = false;
let acousticNodes = []; // {cx, cy, r, cellW, cellH}
window.getAcousticNodes = () => acousticNodes;
let lejanoMode   = false;
let umbralMode   = false;
let showGuides   = true;
let showOverflow = false;
let gridAxes     = { colX: [], rowY: [] };
let todoMode      = true;

// ── Superficies ───────────────────────────────────────────────────────────────
let surfacesMode   = false;
let surfPatchCount = 1;       // parches por curva (1 ó 2)
let surfAmpMax     = 40;      // amplitud máxima en px
let surfOpacity    = 0.82;    // opacidad del relleno sólido
let surfDevTypes   = ['bezier', 'arc', 'sine', 'irregular', 'angular', 'catenary', 'spiral', 'clothoid', 'lissajous', 'epitrochoid', 'pursuit']; // tipos de desvío activos
let surfDensity    = 0.5; // probabilidad 0–1 de que cada curva tenga superficie
let surfaces       = [];      // parches generados
let _surfSeedState = 0;       // estado del RNG guardado antes de generar superficies

const ALL_TYPES = ['bezier','sine','arc','angular','spiral','catenary','clothoid','irregular','lissajous','epitrochoid','pursuit'];

function activateAllTypes() {
  document.querySelectorAll('.chip[data-curve]').forEach(c => c.classList.add('on'));
}

// ── Generate ──────────────────────────────────────────────────────────────────
function generateCurves() {
  const types = getActiveTypes();
  if (!types.length) return;
  // Inicializar RNG con seed actual
  seedRNG(parseInt(document.getElementById('seedInp').value) || 0);

  const cols       = Math.max(2, parseInt(document.getElementById('gridCols').value) || 5);
  const rows       = Math.max(2, parseInt(document.getElementById('gridRows').value) || 4);
  const marginPct  = parseFloat(document.getElementById('gridMargin').value) || 8;

  // ── Generar ejes completamente aleatorios ──────────────────────────────────
  // N posiciones random en X  →  líneas verticales
  // M posiciones random en Y  →  líneas horizontales
  // Nodos = todas las intersecciones
  // Cada regeneración produce una grilla totalmente distinta.

  const marginPx = Math.min(W, H) * (marginPct / 100);
  const innerW   = W - marginPx * 2;
  const innerH   = H - marginPx * 2;

  // Generar posiciones de ejes con separación mínima para que no colapsen
  function randomAxes(count, start, span) {
    const minSep = span / (count * 3); // separación mínima = 1/3 del paso uniforme
    const positions = [];
    let attempts = 0;
    while (positions.length < count && attempts < count * 50) {
      attempts++;
      const p = start + srng() * span;
      const tooClose = positions.some(q => Math.abs(q - p) < minSep);
      if (!tooClose) positions.push(p);
    }
    return positions.sort((a, b) => a - b);
  }

  const colX = randomAxes(cols, marginPx, innerW);
  const rowY = randomAxes(rows, marginPx, innerH);

  // Nodos exactamente en las intersecciones
  nodes = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      nodes.push({ x: colX[c], y: rowY[r], col: c, row: r });
    }
  }

  // Guardar ejes en variable global separada
  gridAxes = { colX, rowY };

  // Modo armónico: solo conecta vecinos en la grilla (distancia Manhattan <= 1.5)
  curves = [];
  const used = new Set();

  // ── Helper: conectar un par y agregar a curves ──────────────────────────────
  function addConn(ai, bi) {
    const key = ai < bi ? `${ai}-${bi}` : `${bi}-${ai}`;
    if (used.has(key)) return false;
    used.add(key);
    const type = types[Math.floor(srng() * types.length)];
    const fn   = CURVE_FNS[type];
    if (!fn) return false;
    const params = makeParams(type);
    const pts = fn(nodes[ai].x, nodes[ai].y, nodes[bi].x, nodes[bi].y, params);
    if (!pts || pts.length < 2) return false;
    curves.push({ pts, type, ai, bi });
    return true;
  }

  if (harmonicMode) {
    // VECINO — solo adyacentes en la grilla (dc<=1, dr<=1)
    const neighbors = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const dc = Math.abs(nodes[i].col - nodes[j].col);
        const dr = Math.abs(nodes[i].row - nodes[j].row);
        if (dc <= 1 && dr <= 1) neighbors.push([i, j]);
      }
    }
    for (let i = neighbors.length-1; i > 0; i--) {
      const j = Math.floor(srng()*(i+1));
      [neighbors[i], neighbors[j]] = [neighbors[j], neighbors[i]];
    }
    for (const [ai, bi] of neighbors.slice(0, connCount)) addConn(ai, bi);

  } else if (lejanoMode) {
    // LEJANO — cada nodo se conecta con el más lejano disponible
    // Ordenar todos los pares por distancia descendente, tomar los primeros connCount
    const allPairs = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y);
        allPairs.push([i, j, d]);
      }
    }
    allPairs.sort((a, b) => b[2] - a[2]); // mayor distancia primero
    // Añadir algo de aleatoriedad: mezclar los top 30% antes de tomar
    const topN = Math.max(connCount * 2, Math.floor(allPairs.length * 0.3));
    const top  = allPairs.slice(0, topN);
    for (let i = top.length-1; i > 0; i--) {
      const j = Math.floor(srng()*(i+1));
      [top[i], top[j]] = [top[j], top[i]];
    }
    for (const [ai, bi] of top) {
      if (curves.length >= connCount) break;
      addConn(ai, bi);
    }

  } else if (umbralMode) {
    // UMBRAL — solo pares dentro de un rango medio (ni muy cerca ni muy lejos)
    // Calcular distancia promedio entre todos los pares
    let sumD = 0, count = 0;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        sumD += Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y);
        count++;
      }
    }
    const avgD  = sumD / count;
    const minD  = avgD * 0.4;  // mínimo: 40% de la distancia promedio
    const maxD  = avgD * 1.1;  // máximo: 110% de la distancia promedio
    const inRange = [];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i+1; j < nodes.length; j++) {
        const d = Math.hypot(nodes[j].x - nodes[i].x, nodes[j].y - nodes[i].y);
        if (d >= minD && d <= maxD) inRange.push([i, j]);
      }
    }
    // Mezclar y tomar connCount
    for (let i = inRange.length-1; i > 0; i--) {
      const j = Math.floor(srng()*(i+1));
      [inRange[i], inRange[j]] = [inRange[j], inRange[i]];
    }
    for (const [ai, bi] of inRange.slice(0, connCount)) addConn(ai, bi);

  } else {
    // LIBRE — cualquier par
    let guard = 0;
    while (curves.length < connCount && guard < connCount * 30) {
      guard++;
      const ai = rndInt(0, nodes.length-1);
      const bi = rndInt(0, nodes.length-1);
      if (ai === bi) continue;
      addConn(ai, bi);
    }
  }

  curves._nodes = nodes;
  generateAcousticNodes();
  // Guardar estado del RNG aquí para que generateSurfaces() siempre arranque
  // desde el mismo punto, sea llamado desde aquí o desde un slider.
  _surfSeedState = _seed;
  generateSurfaces();
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  ctx.clearRect(0, 0, W, H);

  // Fondo
  ctx.fillStyle = '#090b0e';
  ctx.fillRect(0, 0, W, H);

  // Grid punteada sutil
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  const gs = 32;
  for (let x = 0; x < W; x += gs) for (let y = 0; y < H; y += gs) {
    ctx.beginPath(); ctx.arc(x, y, 1, 0, Math.PI*2); ctx.fill();
  }

  // Recuadre del canvas — siempre visible, línea fina
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(0.4, 0.4, W - 0.8, H - 0.8);
  ctx.restore();

  // Líneas guía (ejes de la grilla)
  if (showGuides && gridAxes.colX.length) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.52)';
    ctx.lineWidth   = 0.7;
    ctx.setLineDash([5, 9]);
    for (const x of gridAxes.colX) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (const y of gridAxes.rowY) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (!curves.length) return;

  // Superficies — se dibujan debajo de las curvas
  if (surfacesMode && surfaces.length) {
    ctx.save();
    for (const s of surfaces) {
      if (!s.polygon || s.polygon.length < 3) continue;
      const col = s.color;
      const r = parseInt(col.slice(1,3), 16);
      const g = parseInt(col.slice(3,5), 16);
      const b = parseInt(col.slice(5,7), 16);
      ctx.fillStyle = `rgba(${r},${g},${b},${surfOpacity})`;
      ctx.beginPath();
      s.polygon.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // Conexiones
  for (const c of curves) {
    if (!c.pts || c.pts.length < 2) continue;
    const tcol = CURVE_COLORS[c.type] || '#ffffff';
    const grad = ctx.createLinearGradient(
      c.pts[0].x, c.pts[0].y,
      c.pts[c.pts.length-1].x, c.pts[c.pts.length-1].y
    );
    grad.addColorStop(0, tcol + 'cc');
    grad.addColorStop(1, tcol + '44');

    // Sombra sutil
    ctx.strokeStyle = tcol + '12';
    ctx.lineWidth = strokeW * 4.5;
    ctx.beginPath();
    c.pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
    ctx.stroke();

    // Línea principal
    ctx.strokeStyle = grad;
    ctx.lineWidth = strokeW;
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';
    ctx.beginPath();
    c.pts.forEach((p,i) => i===0 ? ctx.moveTo(p.x,p.y) : ctx.lineTo(p.x,p.y));
    ctx.stroke();
  }

  // Nodos
  for (const n of nodes) {
    ctx.fillStyle = 'rgba(200,210,230,0.85)';
    ctx.beginPath(); ctx.arc(n.x, n.y, 3, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = 'rgba(200,210,230,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(n.x, n.y, 6, 0, Math.PI*2); ctx.stroke();
  }

  // Nodos acústicos
  if (acousticMode && acousticNodes.length) {
    const { wCm, hCm } = getCmDims();
    const pxPerCmX = W / wCm;
    const pxPerCmY = H / hCm;

    for (const n of acousticNodes) {
      const diamCm = (n.r * 2 / pxPerCmX).toFixed(1);
      // Color base: tipología asignada si existe, sino verde acústico por defecto
      const hasType  = n._audioType && CURVE_COLORS[n._audioType];
      const baseHex  = hasType ? CURVE_COLORS[n._audioType] : '#3cd8a0';

      // Círculo
      ctx.strokeStyle = hasType ? baseHex + '88' : 'rgba(60,216,160,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(n.cx, n.cy, n.r, 0, Math.PI*2); ctx.stroke();
      ctx.setLineDash([]);

      // Cruz central
      const cs = 4;
      ctx.strokeStyle = hasType ? baseHex + '55' : 'rgba(60,216,160,0.4)';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(n.cx - cs, n.cy); ctx.lineTo(n.cx + cs, n.cy);
      ctx.moveTo(n.cx, n.cy - cs); ctx.lineTo(n.cx, n.cy + cs);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (hasType) {
        // Tipología — en el color de la curva, bold
        const availableCount = curves.filter(c => c.type === n._audioType).length;
        const fallbackCount = Math.min(availableCount, audioVoiceLimitFor(n._audioType));
        const crvCount = n._audioVoiceCount > 0 ? n._audioVoiceCount : fallbackCount;
        ctx.font = "bold 8px 'DM Mono', monospace";
        ctx.fillStyle = baseHex + 'cc';
        ctx.fillText(n._audioType, n.cx, n.cy - n.r * 0.15);
        // Cantidad de curvas
        ctx.font = "7px 'DM Mono', monospace";
        ctx.fillStyle = baseHex + '88';
        ctx.fillText(crvCount + ' curvas', n.cx, n.cy + n.r * 0.18);
        // Diámetro
        ctx.font = "7px 'DM Mono', monospace";
        ctx.fillStyle = baseHex + '55';
        ctx.fillText('D' + diamCm, n.cx, n.cy + n.r * 0.50);
      } else {
        // Sin tipo asignado — solo diámetro
        ctx.fillStyle = 'rgba(60,216,160,0.75)';
        ctx.font = "9px 'DM Mono', monospace";
        ctx.fillText('D' + diamCm, n.cx, n.cy + n.r * 0.38);
      }
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ── Overlay desborde ────────────────────────────────────────────────────────
  // Usar offsetLeft/offsetTop para evitar problemas de timing con getBoundingClientRect
  {
    const wrap  = canvas.parentElement;
    const ow    = wrap.offsetWidth;
    const oh    = wrap.offsetHeight;
    overlay.width  = ow;
    overlay.height = oh;
    octx.clearRect(0, 0, ow, oh);

    if (showOverflow) {
      // Posición del canvas dentro del wrap via offsetLeft/Top
      const visW = parseFloat(canvas.style.width)  || canvas.offsetWidth;
      const visH = parseFloat(canvas.style.height) || canvas.offsetHeight;
      // canvas está centrado en el wrap con position absolute 50%/50%
      const ox   = (ow - visW) / 2;
      const oy   = (oh - visH) / 2;
      const sx   = visW / W;
      const sy   = visH / H;

      // Borde de referencia del area de obra
      octx.strokeStyle = 'rgba(255,255,255,0.18)';
      octx.lineWidth   = 1;
      octx.setLineDash([4, 6]);
      octx.strokeRect(ox, oy, visW, visH);
      octx.setLineDash([]);

      // Clip inverso: solo mostrar el tramo que queda fuera del area de obra
      octx.save();
      octx.beginPath();
      octx.rect(0, 0, ow, oh);
      octx.rect(ox, oy, visW, visH);
      octx.clip('evenodd');

      for (const c of curves) {
        if (!c.pts || c.pts.length < 2) continue;
        const tcol = CURVE_COLORS[c.type] || '#ffffff';

        octx.save();
        octx.globalAlpha = 0.55;
        octx.strokeStyle = tcol;
        octx.lineWidth   = Math.max(1, strokeW * sx * 0.9);
        octx.lineJoin    = 'round';
        octx.lineCap     = 'round';
        octx.setLineDash([strokeW * sx * 4, strokeW * sx * 3]);
        octx.beginPath();
        c.pts.forEach((p, i) => {
          const px = ox + p.x * sx;
          const py = oy + p.y * sy;
          if (i === 0) octx.moveTo(px, py);
          else octx.lineTo(px, py);
        });
        octx.stroke();
        octx.setLineDash([]);
        octx.restore();
      }

      octx.restore();
    }
  }

  // Info tag
  const types = getActiveTypes();
  const axesInfo = gridAxes.colX.length > 0
    ? `  -  ${gridAxes.colX.length}V ${gridAxes.rowY.length}H` : '';
  document.getElementById('infoTag').textContent =
    `${curves.length} conexiones  -  ${nodes.length} nodos  -  ${types.length} tipo${types.length!==1?'s':''}${axesInfo}`;

  // Rulers — usar requestAnimationFrame para que el layout del canvas ya esté calculado
  requestAnimationFrame(drawRulers);
}

// ── Interacción ───────────────────────────────────────────────────────────────

// Chips toggle
document.querySelectorAll('.chip[data-curve]').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('on');
    // salir de modo Todo si se toca un chip
    todoMode = false;
    document.getElementById('btnTodo').classList.remove('active-todo');
    generateCurves();
    render();
  });
});

// Todo: activa los 11 tipos, usa color por tipo
document.getElementById('btnTodo').addEventListener('click', () => {
  todoMode = !todoMode;
  document.getElementById('btnTodo').classList.toggle('active-todo', todoMode);
  if (todoMode) activateAllTypes();
  generateCurves();
  render();
});

// Random: activa 3–6 tipos al azar, sale de modo Todo
document.getElementById('btnRandom').addEventListener('click', () => {
  todoMode = false;
  document.getElementById('btnTodo').classList.remove('active-todo');
  const chips = [...document.querySelectorAll('.chip[data-curve]')];
  chips.forEach(c => c.classList.remove('on'));
  const n = rndInt(3, 6);
  const shuffled = chips.sort(() => Math.random() - 0.5).slice(0, n);
  shuffled.forEach(c => c.classList.add('on'));
  generateCurves();
  render();
});

// Canvas presets
document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active-preset'));
    btn.classList.add('active-preset');
    document.getElementById('cwCm').value = btn.dataset.w;
    document.getElementById('chCm').value = btn.dataset.h;
    applyCanvasSize();
    generateCurves();
    render();
  });
});
['cwCm','chCm'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active-preset'));
    applyCanvasSize();
    generateCurves();
    render();
  });
});

// Sliders
const mulSlider = document.getElementById('mulSlider');
const mulVal    = document.getElementById('mulVal');
mulSlider.addEventListener('input', () => {
  mul = parseFloat(mulSlider.value);
  mulVal.textContent = mul.toFixed(2);
  generateCurves();
  render();
});

const varSlider = document.getElementById('varSlider');
const varVal    = document.getElementById('varVal');
varSlider.addEventListener('input', () => {
  connCount = parseInt(varSlider.value);
  varVal.textContent = connCount;
  generateCurves();
  render();
});



document.getElementById('btnRun').addEventListener('click', () => {
  // Nuevo seed aleatorio en cada iteración
  const s = Math.floor(Math.random() * 99999);
  document.getElementById('seedInp').value = s;
  generateCurves();
  render();
});

// Grilla inputs
['gridCols','gridRows','gridMargin'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    generateCurves();
    render();
  });
});

// Toggle líneas guía
const strokeSlider = document.getElementById('strokeSlider');
const strokeVal    = document.getElementById('strokeVal');
strokeSlider.addEventListener('input', () => {
  strokeW = parseFloat(strokeSlider.value);
  strokeVal.textContent = strokeW.toFixed(1);
  render();
});

document.getElementById('guideToggle').addEventListener('click', () => {
  showGuides = !showGuides;
  document.getElementById('guideTrack').classList.toggle('on', showGuides);
  render();
});

document.getElementById('overflowToggle').addEventListener('click', () => {
  showOverflow = !showOverflow;
  document.getElementById('overflowTrack').classList.toggle('on', showOverflow);
  applyCanvasSize();
  render();
});

// Nodos acústicos
document.getElementById('acousticToggle').addEventListener('click', () => {
  acousticMode = !acousticMode;
  document.getElementById('acousticTrack').classList.toggle('on', acousticMode);
  generateAcousticNodes();
  render();
});
['acousticMax','acousticMinCm','acousticMarginCm'].forEach(id => {
  document.getElementById(id).addEventListener('change', () => {
    generateAcousticNodes();
    render();
  });
});

// Toggle armónico
function setConnMode(mode) {
  // Exclusivos: solo uno activo a la vez
  harmonicMode = mode === 'vecino' ? !harmonicMode : false;
  lejanoMode   = mode === 'lejano' ? !lejanoMode   : false;
  umbralMode   = mode === 'umbral' ? !umbralMode   : false;
  // Si se reactivó el mismo, toggle; si se cambió, el nuevo queda activo
  if (mode === 'vecino' && !harmonicMode) { /* ya toggled */ }
  if (mode === 'lejano' && !lejanoMode)   { /* ya toggled */ }
  if (mode === 'umbral' && !umbralMode)   { /* ya toggled */ }
  document.getElementById('harmonicTrack').classList.toggle('on', harmonicMode);
  document.getElementById('lejanoTrack').classList.toggle('on', lejanoMode);
  document.getElementById('umbralTrack').classList.toggle('on', umbralMode);
  generateCurves();
  render();
}

document.getElementById('harmonicToggle').addEventListener('click', () => setConnMode('vecino'));
document.getElementById('lejanoToggle').addEventListener('click',   () => setConnMode('lejano'));
document.getElementById('umbralToggle').addEventListener('click',   () => setConnMode('umbral'));

// ── Seed ─────────────────────────────────────────────────────────────────────
document.getElementById('seedInp').addEventListener('change', () => {
  generateCurves(); render();
});
document.getElementById('seedDice').addEventListener('click', () => {
  const s = Math.floor(Math.random() * 99999);
  document.getElementById('seedInp').value = s;
  generateCurves(); render();
});

// ── Secciones colapsables ────────────────────────────────────────────────────
document.querySelectorAll('.sec-header').forEach(hd => {
  hd.addEventListener('click', () => {
    const sec    = hd.dataset.sec;
    const body   = document.getElementById('body-' + sec);
    const caret  = document.getElementById('caret-' + sec);
    const isOpen = body.classList.toggle('open');
    caret.classList.toggle('open', isOpen);
  });
});

// ── Nodos acústicos ──────────────────────────────────────────────────────────
function generateAcousticNodes() {
  acousticNodes = [];
  if (!acousticMode) return;
  if (!gridAxes.colX || !gridAxes.colX.length) return;

  const { wCm, hCm } = getCmDims();
  const pxPerCm    = W / wCm;
  const minCm      = parseFloat(document.getElementById('acousticMinCm').value) || 3;
  const marginCm   = parseFloat(document.getElementById('acousticMarginCm').value) || 0;
  const minPx      = minCm * pxPerCm;
  const marginPx   = marginCm * pxPerCm;
  const maxAllowed = parseInt(document.getElementById('acousticMax').value) || 0;
  const maxN       = maxAllowed > 0 ? (1 + Math.floor(srng() * maxAllowed)) : 0; // 1..maxAllowed

  // Solo celdas interiores — excluir las que tocan el borde del canvas
  // Una celda toca el borde si x0==0, x1==W, y0==0 o y1==H
  const colBounds = [0, ...gridAxes.colX, W];
  const rowBounds = [0, ...gridAxes.rowY, H];

  const cells = [];
  for (let r = 0; r < rowBounds.length - 1; r++) {
    for (let c = 0; c < colBounds.length - 1; c++) {
      const x0 = colBounds[c],  x1 = colBounds[c+1];
      const y0 = rowBounds[r],  y1 = rowBounds[r+1];

      // Excluir celdas que tocan cualquier borde del canvas
      const touchesBorder = (x0 === 0 || x1 === W || y0 === 0 || y1 === H);
      if (touchesBorder) continue;

      const cw = x1 - x0, ch = y1 - y0;
      // Radio = mitad del lado más corto, menos el margen
      const rawR = Math.min(cw, ch) / 2;
      const r_px = rawR - marginPx;
      if (r_px * 2 < minPx) continue; // demasiado pequeño tras margen
      cells.push({ cx: (x0+x1)/2, cy: (y0+y1)/2, r: r_px, cw, ch });
    }
  }

  // Mezclar con el RNG seeded y tomar hasta maxN
  for (let i = cells.length-1; i > 0; i--) {
    const j = Math.floor(srng() * (i+1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  acousticNodes = cells.slice(0, maxN);

  // ── Asignar tipología sonora a cada nodo — determinista con el seed ────────
  const typesInComposition = [...new Set(curves.map(c => c.type))];
  // Mezclar con srng() — mismo seed = mismo resultado siempre
  for (let i = typesInComposition.length - 1; i > 0; i--) {
    const j = Math.floor(srng() * (i + 1));
    [typesInComposition[i], typesInComposition[j]] = [typesInComposition[j], typesInComposition[i]];
  }
  // Asignar tipo + parámetros de voz (speedMul, forward) por nodo, todo seeded
  acousticNodes.forEach((node, i) => {
    node._audioType = typesInComposition[i] || null;
    node._audioVoiceCount = 0;
    const count = curves.filter(c => c.type === node._audioType).length;
    node._speedMuls = Array.from({ length: count }, () => 0.3 + srng() * 2.2);
    node._forwards  = Array.from({ length: count }, () => srng() < 0.5);
  });

  if (typeof window.refreshTypeMixers === 'function') window.refreshTypeMixers();

  // Notificar al motor de audio si está activo
  if (typeof audioRebuildIfNeeded === 'function') audioRebuildIfNeeded();
}

// ── Export ───────────────────────────────────────────────────────────────────
function exportPNG() {
  const { wCm, hCm } = getCmDims();
  const RULER   = 36;   // px del ruler en el export (más grande que en pantalla)
  const totalW  = W + RULER;
  const totalH  = H + RULER;

  const exp     = document.createElement('canvas');
  exp.width     = totalW;
  exp.height    = totalH;
  const ex      = exp.getContext('2d');

  const BG      = '#08090c';
  const TK_MIN  = 'rgba(255,255,255,0.18)';
  const TK_MAJ  = 'rgba(255,255,255,0.32)';
  const AX_LINE = 'rgba(255,255,255,0.65)';
  const AX_NUM  = 'rgba(255,255,255,0.85)';
  const NUM_COL = 'rgba(180,196,212,0.55)';
  const FONT_SM = "10px 'DM Mono', monospace";
  const FONT_AX = "9px 'DM Mono', monospace";

  // Fondo total
  ex.fillStyle = BG;
  ex.fillRect(0, 0, totalW, totalH);

  // Pegar artwork en la esquina inferior derecha del ruler
  ex.drawImage(canvas, RULER, RULER);

  // Nodos acústicos en el export
  if (acousticMode && acousticNodes.length) {
    for (const n of acousticNodes) {
      const diamCm = (n.r * 2 / (W / wCm)).toFixed(1);
      ex.fillStyle = 'rgba(60,216,160,0.04)';
      ex.beginPath(); ex.arc(RULER + n.cx, RULER + n.cy, n.r, 0, Math.PI*2); ex.fill();
      ex.strokeStyle = 'rgba(60,216,160,0.55)';
      ex.lineWidth = 1;
      ex.setLineDash([3, 5]);
      ex.beginPath(); ex.arc(RULER + n.cx, RULER + n.cy, n.r, 0, Math.PI*2); ex.stroke();
      ex.setLineDash([]);
      const cs = 4;
      ex.strokeStyle = 'rgba(60,216,160,0.4)';
      ex.lineWidth = 0.7;
      ex.beginPath();
      ex.moveTo(RULER + n.cx - cs, RULER + n.cy); ex.lineTo(RULER + n.cx + cs, RULER + n.cy);
      ex.moveTo(RULER + n.cx, RULER + n.cy - cs); ex.lineTo(RULER + n.cx, RULER + n.cy + cs);
      ex.stroke();
      ex.fillStyle = 'rgba(60,216,160,0.75)';
      ex.font = "9px 'DM Mono', monospace";
      ex.textAlign = 'center'; ex.textBaseline = 'middle';
      ex.fillText('D' + diamCm, RULER + n.cx, RULER + n.cy + n.r * 0.38);
    }
    ex.textAlign = 'left'; ex.textBaseline = 'alphabetic';
  }

  // ── Ruler superior ──────────────────────────────────────────────────────────
  const pxPerCmX = W / wCm;
  for (let cm = 0; cm <= wCm; cm++) {
    const x       = RULER + cm * pxPerCmX;
    const isMajor = cm % 5 === 0;
    const tkH     = isMajor ? 14 : 7;
    ex.strokeStyle = isMajor ? TK_MAJ : TK_MIN;
    ex.lineWidth   = isMajor ? 0.8 : 0.5;
    ex.beginPath();
    ex.moveTo(x, RULER);
    ex.lineTo(x, RULER - tkH);
    ex.stroke();
  }
  // Ejes verticales — siempre visibles en el export
  ex.font = FONT_AX;
  ex.textAlign = 'center';
  ex.textBaseline = 'middle';
  for (const px of gridAxes.colX) {
    const x  = RULER + px;
    const cm = (px / W * wCm).toFixed(1);
    ex.strokeStyle = AX_LINE;
    ex.lineWidth   = 0.8;
    ex.setLineDash([4, 7]);
    ex.beginPath(); ex.moveTo(x, 0); ex.lineTo(x, RULER); ex.stroke();
    ex.setLineDash([]);
    ex.fillStyle = AX_NUM;
    ex.fillText(cm, x, RULER * 0.38);
  }

  // ── Ruler izquierdo ─────────────────────────────────────────────────────────
  const pxPerCmY = H / hCm;
  for (let cm = 0; cm <= hCm; cm++) {
    const y       = RULER + cm * pxPerCmY;
    const isMajor = cm % 5 === 0;
    const tkH     = isMajor ? 14 : 7;
    ex.strokeStyle = isMajor ? TK_MAJ : TK_MIN;
    ex.lineWidth   = isMajor ? 0.8 : 0.5;
    ex.beginPath();
    ex.moveTo(RULER, y);
    ex.lineTo(RULER - tkH, y);
    ex.stroke();
  }
  // Ejes horizontales
  ex.font = FONT_AX;
  ex.textAlign = 'center';
  ex.textBaseline = 'middle';
  for (const py of gridAxes.rowY) {
    const y  = RULER + py;
    const cm = (py / H * hCm).toFixed(1);
    ex.strokeStyle = AX_LINE;
    ex.lineWidth   = 0.8;
    ex.setLineDash([4, 7]);
    ex.beginPath(); ex.moveTo(0, y); ex.lineTo(RULER, y); ex.stroke();
    ex.setLineDash([]);
    ex.save();
    ex.translate(RULER * 0.62, y);
    ex.rotate(-Math.PI / 2);
    ex.fillStyle = AX_NUM;
    ex.fillText(cm, 0, 0);
    ex.restore();
  }

  // Nodos acústicos en rulers del export
  if (acousticMode && acousticNodes.length) {
    for (const n of acousticNodes) {
      // Ruler superior — X
      const ex_x = RULER + n.cx;
      const xcm  = (n.cx / W * wCm).toFixed(1);
      ex.strokeStyle = 'rgba(60,216,160,0.7)';
      ex.lineWidth   = 0.8;
      ex.beginPath(); ex.moveTo(ex_x, RULER); ex.lineTo(ex_x, RULER * 0.3); ex.stroke();
      ex.fillStyle = 'rgba(60,216,160,0.7)';
      ex.beginPath();
      ex.moveTo(ex_x-3, RULER*0.3); ex.lineTo(ex_x+3, RULER*0.3); ex.lineTo(ex_x, RULER*0.6);
      ex.closePath(); ex.fill();
      ex.fillStyle = 'rgba(60,216,160,0.9)';
      ex.font = "9px 'DM Mono', monospace";
      ex.textAlign = 'center'; ex.textBaseline = 'middle';
      ex.fillText(xcm, ex_x, 7);

      // Ruler izquierdo — Y
      const ex_y = RULER + n.cy;
      const ycm  = (n.cy / H * hCm).toFixed(1);
      ex.strokeStyle = 'rgba(60,216,160,0.7)';
      ex.lineWidth   = 0.8;
      ex.beginPath(); ex.moveTo(RULER, ex_y); ex.lineTo(RULER*0.3, ex_y); ex.stroke();
      ex.fillStyle = 'rgba(60,216,160,0.7)';
      ex.beginPath();
      ex.moveTo(RULER*0.3, ex_y-3); ex.lineTo(RULER*0.3, ex_y+3); ex.lineTo(RULER*0.6, ex_y);
      ex.closePath(); ex.fill();
      ex.save();
      ex.translate(7, ex_y);
      ex.rotate(-Math.PI/2);
      ex.fillStyle = 'rgba(60,216,160,0.9)';
      ex.font = "9px 'DM Mono', monospace";
      ex.textAlign = 'center'; ex.textBaseline = 'middle';
      ex.fillText(ycm, 0, 0);
      ex.restore();
    }
  }

  // Esquina — celda vacía
  ex.fillStyle = BG;
  ex.fillRect(0, 0, RULER, RULER);

  // Borde separador rulers/canvas
  ex.strokeStyle = 'rgba(255,255,255,0.1)';
  ex.lineWidth   = 0.5;
  ex.beginPath(); ex.moveTo(RULER, 0); ex.lineTo(RULER, totalH); ex.stroke();
  ex.beginPath(); ex.moveTo(0, RULER); ex.lineTo(totalW, RULER); ex.stroke();

  // ── Franja de metadatos ─────────────────────────────────────────────────────
  const seed       = document.getElementById('seedInp').value || '0';
  const activeCrvs = getActiveTypes().join(', ');
  const modeStr    = harmonicMode ? 'vecino' : lejanoMode ? 'lejano' : umbralMode ? 'umbral' : 'libre';
  const ejesV      = document.getElementById('gridCols').value;
  const ejesH      = document.getElementById('gridRows').value;
  const margen     = document.getElementById('gridMargin').value;

  const META_H  = 52;
  const META_Y  = RULER + H;

  // Expandir canvas para la franja
  const finalCanvas = document.createElement('canvas');
  finalCanvas.width  = totalW;
  finalCanvas.height = totalH + META_H;
  const fc = finalCanvas.getContext('2d');

  // Copiar lo que tenemos hasta ahora
  fc.drawImage(exp, 0, 0);

  // Fondo franja
  fc.fillStyle = '#0c0e13';
  fc.fillRect(0, META_Y, totalW, META_H);

  // Línea separadora
  fc.strokeStyle = 'rgba(255,255,255,0.08)';
  fc.lineWidth = 0.5;
  fc.beginPath(); fc.moveTo(0, META_Y); fc.lineTo(totalW, META_Y); fc.stroke();

  // Texto — dos líneas
  const COL1 = 'rgba(255,255,255,0.35)';  // labels
  const COL2 = 'rgba(255,255,255,0.75)';  // valores
  const F1   = "10px 'DM Mono', monospace";
  const F2   = "9px 'DM Mono', monospace";
  const PAD  = RULER + 8;
  const L1   = META_Y + 16;
  const L2   = META_Y + 34;

  fc.font = F1;
  fc.textBaseline = 'middle';
  fc.textAlign    = 'left';

  // Línea 1: seed  -  canvas  -  ejes
  fc.fillStyle = COL1; fc.fillText('seed', PAD, L1);
  fc.fillStyle = COL2; fc.fillText(seed, PAD + 30, L1);

  fc.fillStyle = COL1; fc.fillText('canvas', PAD + 80, L1);
  fc.fillStyle = COL2; fc.fillText(`${wCm}x${hCm} cm`, PAD + 122, L1);

  fc.fillStyle = COL1; fc.fillText('ejes', PAD + 210, L1);
  fc.fillStyle = COL2; fc.fillText(`${ejesV}V  -  ${ejesH}H`, PAD + 234, L1);

  fc.fillStyle = COL1; fc.fillText('margen', PAD + 310, L1);
  fc.fillStyle = COL2; fc.fillText(`${margen}%`, PAD + 358, L1);

  fc.fillStyle = COL1; fc.fillText('modo', PAD + 400, L1);
  fc.fillStyle = COL2; fc.fillText(modeStr, PAD + 430, L1);

  // Línea 2: curvas activas + nodos acústicos
  fc.font = F2;
  fc.fillStyle = COL1; fc.fillText('curvas', PAD, L2);
  fc.fillStyle = 'rgba(255,255,255,0.55)'; fc.fillText(activeCrvs, PAD + 40, L2);

  // Si hay nodos acústicos, agregar línea extra con sus posiciones
  if (acousticMode && acousticNodes.length) {
    const META_H2 = 18;
    // Expandir canvas una línea más — necesitamos re-hacer el finalCanvas
    // Los datos se incluyen como texto en la franja existente, compacto
    const nodesStr = acousticNodes.map(n => {
      const xcm = (n.cx / W * wCm).toFixed(1);
      const ycm = (n.cy / H * hCm).toFixed(1);
      const dcm = (n.r * 2 / (W / wCm)).toFixed(1);
      return `(${xcm},${ycm}) D${dcm}`;
    }).join('  ');
    fc.fillStyle = 'rgba(60,216,160,0.35)'; fc.fillText('parlantes', PAD, L2 + 14);
    fc.fillStyle = 'rgba(60,216,160,0.7)';  fc.fillText(nodesStr, PAD + 55, L2 + 14);
  }

  const link = document.createElement('a');
  link.download = `ensamble_s${seed}_${wCm}x${hCm}cm.png`;
  link.href = finalCanvas.toDataURL('image/png');
  link.click();
}

function exportSVG() {
  const { wCm, hCm } = getCmDims();
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
`;
  svg += `<rect width="${W}" height="${H}" fill="#08090c"/>
`;

  // Ejes guía (si están activos)
  if (showGuides && gridAxes.colX.length) {
    svg += `<g id="ejes" stroke="rgba(255,255,255,0.52)" stroke-width="0.7" stroke-dasharray="5,9" opacity="0.52">
`;
    for (const x of gridAxes.colX) {
      svg += `  <line x1="${x.toFixed(3)}" y1="0" x2="${x.toFixed(3)}" y2="${H}"/>
`;
    }
    for (const y of gridAxes.rowY) {
      svg += `  <line x1="0" y1="${y.toFixed(3)}" x2="${W}" y2="${y.toFixed(3)}"/>
`;
    }
    svg += `</g>
`;
  }

  // Curvas
  svg += `<g id="curvas" fill="none" stroke-linecap="round" stroke-linejoin="round">
`;
  for (const c of curves) {
    if (!c.pts || c.pts.length < 2) continue;
    const col = CURVE_COLORS[c.type] || '#ffffff';
    const d   = 'M' + c.pts.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join('L');
    svg += `  <path d="${d}" stroke="${col}" stroke-width="1.6" opacity="0.85"/>
`;
  }
  svg += `</g>
`;

  // Nodos
  svg += `<g id="nodos">
`;
  for (const n of nodes) {
    svg += `  <circle cx="${n.x.toFixed(3)}" cy="${n.y.toFixed(3)}" r="3" fill="rgba(200,210,230,0.85)"/>
`;
  }
  svg += `</g>
`;

  // Recuadre
  svg += `<rect x="0.4" y="0.4" width="${W-0.8}" height="${H-0.8}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="0.8"/>
`;
  svg += `</svg>`;

  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `ensamble_${wCm}x${hCm}cm_${Date.now()}.svg`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

document.getElementById('btnPNG').addEventListener('click', exportPNG);
document.getElementById('btnSVG').addEventListener('click', exportSVG);

// ── Superficies ───────────────────────────────────────────────────────────────
document.getElementById('surfaceToggle').addEventListener('click', () => {
  surfacesMode = !surfacesMode;
  document.getElementById('surfaceTrack').classList.toggle('on', surfacesMode);
  generateSurfaces();
  render();
});

document.getElementById('surfPatchInp').addEventListener('change', () => {
  surfPatchCount = Math.max(1, Math.min(2, parseInt(document.getElementById('surfPatchInp').value) || 1));
  generateSurfaces();
  render();
});

document.getElementById('surfAmpSlider').addEventListener('input', () => {
  surfAmpMax = parseFloat(document.getElementById('surfAmpSlider').value);
  document.getElementById('surfAmpVal').textContent = Math.round(surfAmpMax);
  generateSurfaces();
  render();
});

document.getElementById('surfOpacitySlider').addEventListener('input', () => {
  surfOpacity = parseFloat(document.getElementById('surfOpacitySlider').value);
  document.getElementById('surfOpacityVal').textContent = surfOpacity.toFixed(2);
  render(); // solo re-renderizar, las formas no cambian
});

document.getElementById('surfDensitySlider').addEventListener('input', () => {
  surfDensity = parseFloat(document.getElementById('surfDensitySlider').value);
  const pct = Math.round(surfDensity * 100);
  document.getElementById('surfDensityVal').textContent = pct + '%';
  generateSurfaces();
  render();
});

document.querySelectorAll('.chip[data-surf]').forEach(chip => {
  chip.addEventListener('click', () => {
    chip.classList.toggle('on');
    surfDevTypes = [...document.querySelectorAll('.chip[data-surf].on')].map(c => c.dataset.surf);
    generateSurfaces();
    render();
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────
initP5Layers();
