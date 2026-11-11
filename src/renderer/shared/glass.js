// Liquid glass renderer.
// One WebGL canvas behind the DOM draws every [data-glass] element as a refractive
// glass slab over a pre-blurred copy of the desktop wallpaper: lens refraction at the
// bezel, chromatic dispersion, a rim light that follows the light direction and a soft top
// sheen. Renders only when the geometry changed, and only inside the area that holds glass.

const MAX = 8;

const VERT = `
attribute vec2 p;
void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision highp float;
uniform sampler2D tex;
uniform vec2 res;          // canvas size in px
uniform vec4 texRect;      // where the texture sits in canvas px (x,y,w,h)
uniform vec4 rects[${MAX}];
uniform vec4 extra[${MAX}]; // radius, alpha, unused, kind
uniform int count;
uniform vec3 tint;
uniform float tintA, refr, spec, chroma, rim, dpr;
uniform vec2 light;

float sdRound(vec2 p, vec2 b, float r){
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
vec3 sampleTex(vec2 px){
  vec2 uv = (px - texRect.xy) / texRect.zw;
  uv = clamp(uv, 0.001, 0.999);
  return texture2D(tex, vec2(uv.x, 1.0 - uv.y)).rgb;
}

void main(){
  vec2 frag = vec2(gl_FragCoord.x, res.y - gl_FragCoord.y);
  vec4 outc = vec4(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= count) break;
    vec4 R = rects[i] * dpr;
    vec4 E = extra[i];
    float rad = E.x * dpr;
    vec2 c = R.xy + R.zw * 0.5;
    vec2 hb = R.zw * 0.5;
    vec2 lp = frag - c;
    float d = sdRound(lp, hb, rad);
    if (d > 1.5) continue;
    float aa = clamp(0.5 - d, 0.0, 1.0) * E.y;
    if (aa <= 0.0) continue;

    // surface normal from the SDF gradient
    float e = 1.0;
    vec2 n = normalize(vec2(
      sdRound(lp + vec2(e, 0.0), hb, rad) - sdRound(lp - vec2(e, 0.0), hb, rad),
      sdRound(lp + vec2(0.0, e), hb, rad) - sdRound(lp - vec2(0.0, e), hb, rad)) + 1e-5);

    float inside = -d;                              // px from the edge, inward
    float bezel = min(rad * 1.15 + 6.0 * dpr, min(hb.x, hb.y));
    float t = clamp(1.0 - inside / bezel, 0.0, 1.0); // 1 at edge -> 0 in the flat middle
    float bend = 1.0 - sqrt(max(0.0, 1.0 - t * t));  // circular lens profile

    vec2 off = -n * bend * refr * bezel * 0.85;
    vec2 cs = -n * bend * chroma * 6.0 * dpr;
    vec3 col;
    col.r = sampleTex(frag + off + cs).r;
    col.g = sampleTex(frag + off).g;
    col.b = sampleTex(frag + off - cs).b;

    col = mix(col, tint, clamp(tintA + E.w, 0.0, 1.0));

    // top sheen + bottom inner shade (the reference uses inset shadows for depth)
    float yN = (frag.y - R.y) / R.w;
    col += vec3(1.0) * (1.0 - smoothstep(0.0, 0.55, yN)) * 0.045 * spec;
    col *= 1.0 - smoothstep(0.55, 1.0, yN) * 0.10;

    // rim light: brightest where the edge faces the light
    float facing = dot(n, normalize(light));
    float edgeLine = smoothstep(1.6 * dpr, 0.0, inside);
    float bevel = pow(t, 3.0);
    col += vec3(1.0) * (edgeLine * (0.22 + 0.55 * max(facing, 0.0)) + bevel * 0.16 * max(facing, 0.0)) * rim;
    col += vec3(1.0) * edgeLine * 0.10 * max(-facing, 0.0) * rim; // back-light on the far side


    outc = vec4(col * aa, aa);
  }
  gl_FragColor = outc;
}`;

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
}

export class GlassEngine {
  constructor(canvas, root = document) {
    this.canvas = canvas;
    this.root = root;
    this.params = null;
    this.animUntil = 0;
    this.texReady = false;
    this.source = null; // { img, color, map(rect)->dest }
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false });
    this.gl = gl;
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s)); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    this.prog = prog;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['tex', 'res', 'texRect', 'rects', 'extra', 'count', 'tint', 'tintA', 'refr', 'spec', 'chroma', 'rim', 'dpr', 'light']) this.u[n] = gl.getUniformLocation(prog, n);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this._loop = this._loop.bind(this);
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.rebuildTexture();
  }

  setParams(p) { this.params = p; this.rebuildTexture(); }

  // source: { img: HTMLImageElement|null, color: '#rrggbb', place: (w,h)=>{x,y,w,h} in canvas css px }
  setSource(src) { this.source = src; this.rebuildTexture(); }

  rebuildTexture() {
    const gl = this.gl;
    if (!gl || !this.params) return;
    const r = this.canvas.getBoundingClientRect();
    const scale = 0.5; // texture at half resolution: it is blurred anyway
    const w = Math.max(2, Math.round(r.width * scale)), h = Math.max(2, Math.round(r.height * scale));
    const c = this._texCanvas || (this._texCanvas = document.createElement('canvas'));
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const p = this.params;
    ctx.filter = 'none';
    ctx.fillStyle = (this.source && this.source.color) || '#1b1d24';
    ctx.fillRect(0, 0, w, h);
    const blur = Math.max(0, p.blur * scale);
    ctx.filter = `blur(${blur}px) saturate(${p.saturation}) brightness(${p.brightness})`;
    if (this.source && this.source.img && this.source.img.complete && this.source.img.naturalWidth) {
      const dest = this.source.place(r.width, r.height);
      const m = blur * 3; // overdraw so the blur doesn't pull in empty borders
      const sx = (dest.w + 2 * m / scale) / dest.w, sy = (dest.h + 2 * m / scale) / dest.h;
      ctx.drawImage(this.source.img, (dest.x - (dest.w * (sx - 1)) / 2) * scale, (dest.y - (dest.h * (sy - 1)) / 2) * scale, dest.w * sx * scale, dest.h * sy * scale);
    } else {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#2a2f3d'); g.addColorStop(1, '#0d0f14');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    this.texReady = true;
    this.invalidate();
  }

  invalidate(animMs = 0) {
    this.animUntil = Math.max(this.animUntil, performance.now() + animMs);
    if (!this._raf) this._raf = requestAnimationFrame(this._loop);
  }

  _loop() {
    this._raf = null;
    this.draw();
    if (performance.now() < this.animUntil) this._raf = requestAnimationFrame(this._loop);
  }

  draw() {
    const gl = this.gl;
    if (!gl || !this.params || !this.texReady) return;
    const p = this.params;
    const cr = this.canvas.getBoundingClientRect();
    const els = [...this.root.querySelectorAll('[data-glass]')].filter((el) => el.offsetParent !== null || el === document.body);
    const rects = new Float32Array(MAX * 4), extra = new Float32Array(MAX * 4);
    let n = 0; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) {
      if (n >= MAX) break;
      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      const cs = getComputedStyle(el);
      let alpha = parseFloat(cs.opacity);
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) alpha *= parseFloat(getComputedStyle(a).opacity);
      if (alpha <= 0.01 || cs.visibility === 'hidden') continue;
      // transforms scale the box: approximate the radius scale from width ratio
      const sc = el.offsetWidth ? b.width / el.offsetWidth : 1;
      const rad = Math.min(parseFloat(cs.borderTopLeftRadius) * sc, b.height / 2, b.width / 2);
      rects.set([b.left - cr.left, b.top - cr.top, b.width, b.height], n * 4);
      extra.set([rad, alpha, 0, parseFloat(el.dataset.glass) || 0], n * 4);
      x0 = Math.min(x0, b.left - cr.left); y0 = Math.min(y0, b.top - cr.top); x1 = Math.max(x1, b.right - cr.left); y1 = Math.max(y1, b.bottom - cr.top);
      n++;
    }
    const dpr = this.canvas.width / Math.max(1, cr.width);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    // clear what was drawn last time, then shade only the bounding box of the glass shapes
    const W = this.canvas.width, H = this.canvas.height;
    const box = n ? [Math.max(0, Math.floor((x0 - 2) * dpr)), Math.max(0, Math.floor(H - (y1 + 2) * dpr)), Math.ceil((x1 - x0 + 4) * dpr), Math.ceil((y1 - y0 + 4) * dpr)] : null;
    gl.enable(gl.SCISSOR_TEST);
    gl.clearColor(0, 0, 0, 0);
    const prev = this._box;
    if (prev) { gl.scissor(prev[0], prev[1], prev[2], prev[3]); gl.clear(gl.COLOR_BUFFER_BIT); }
    else { gl.scissor(0, 0, W, H); gl.clear(gl.COLOR_BUFFER_BIT); }
    this._box = box;
    if (!n) return;
    gl.scissor(box[0], box[1], box[2], box[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform1i(this.u.tex, 0);
    gl.uniform2f(this.u.res, this.canvas.width, this.canvas.height);
    gl.uniform4f(this.u.texRect, 0, 0, this.canvas.width, this.canvas.height);
    gl.uniform4fv(this.u.rects, rects);
    gl.uniform4fv(this.u.extra, extra);
    gl.uniform1i(this.u.count, n);
    gl.uniform3fv(this.u.tint, hexToRgb(p.tint));
    gl.uniform1f(this.u.tintA, p.tintOpacity);
    gl.uniform1f(this.u.refr, p.refraction);
    gl.uniform1f(this.u.spec, p.sheen === false ? 0 : p.specular);
    gl.uniform1f(this.u.chroma, p.chroma);
    gl.uniform1f(this.u.rim, p.rim);
    gl.uniform1f(this.u.dpr, dpr);
    gl.uniform2f(this.u.light, -0.45, -1.0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

// Map a Windows wallpaper (style registry value) onto a display rect.
export function placeWallpaper(img, style, displayBounds, windowBounds) {
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const D = displayBounds;
  let w = D.width, h = D.height, x = D.x, y = D.y;
  const s = String(style);
  if (s === '10' || s === '22' || s === '') { // fill / span
    const k = Math.max(D.width / iw, D.height / ih); w = iw * k; h = ih * k; x = D.x + (D.width - w) / 2; y = D.y + (D.height - h) / 2;
  } else if (s === '6') { // fit
    const k = Math.min(D.width / iw, D.height / ih); w = iw * k; h = ih * k; x = D.x + (D.width - w) / 2; y = D.y + (D.height - h) / 2;
  } else if (s === '0') { // center
    w = iw; h = ih; x = D.x + (D.width - w) / 2; y = D.y + (D.height - h) / 2;
  } // '2' stretch: full display
  return { x: x - windowBounds.x, y: y - windowBounds.y, w, h };
}
