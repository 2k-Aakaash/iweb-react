// Static glass: renders a surface's glass ONCE into an image, so nothing re-runs per frame.
//
// Live SVG-filter glass is re-drawn by the GPU on every frame while anything on the page
// animates; on integrated GPUs a handful of surfaces drops the whole page to ~12 fps. What
// sits behind iWeb's glass is the wallpaper, which is static, so the glass can be rendered
// when a surface's size, the window or the wallpaper changes, and shown as a still.
//
// One shared WebGL2 context (no per-surface context limits) draws the glass and each surface
// copies the result into its own 2D canvas. Per pixel: the curved rim refracts the sharp
// wallpaper inward (lightly softened, faint red/blue split); the body shows a properly
// Gaussian-blurred background; then saturation, tint, a milky lift and a specular rim.

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uImg;   // the page background, lightly Gaussian-blurred (the rim)
uniform vec4 uImgRect;    // area uImg covers, CSS px
uniform sampler2D uSoft;  // the page background, fully Gaussian-blurred (the body)
uniform vec4 uSoftRect;   // area uSoft covers, CSS px
uniform bool uHasImg;
uniform vec3 uSolid;
uniform vec4 uRect;       // surface x, y, w, h (CSS px, viewport, y down)
uniform vec4 uCover;      // wallpaper drawn rect x, y, w, h (CSS px)
uniform float uRadius;
uniform float uBezel;
uniform float uRefract;
uniform float uChroma;
uniform float uDpr;
uniform float uSaturate;
uniform vec4 uTint;
uniform float uSpecular;
uniform float uLift;
out vec4 outColor;

float sdRoundRect(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

// Both layers are real Gaussian blurs made on the CPU and sampled bilinearly: no mipmaps,
// whose box-filtered levels showed up as blocky smears.
vec3 sharp(vec2 css) {
  if (!uHasImg) return uSolid;
  return texture(uImg, (css - uImgRect.xy) / uImgRect.zw).rgb;
}

vec3 soft(vec2 css) {
  if (!uHasImg) return uSolid;
  return texture(uSoft, (css - uSoftRect.xy) / uSoftRect.zw).rgb;
}

void main() {
  vec2 frag = gl_FragCoord.xy / uDpr;
  vec2 local = vec2(frag.x, uRect.w - frag.y);
  vec2 hs = uRect.zw * 0.5;
  vec2 c = local - hs;
  float r = min(uRadius, min(hs.x, hs.y));
  float d = sdRoundRect(c, hs, r);
  float alpha = clamp(0.5 - d, 0.0, 1.0);
  if (alpha <= 0.0) { outColor = vec4(0.0); return; }

  float e = 0.5;
  vec2 n = normalize(vec2(
    sdRoundRect(c + vec2(e, 0.0), hs, r) - sdRoundRect(c - vec2(e, 0.0), hs, r),
    sdRoundRect(c + vec2(0.0, e), hs, r) - sdRoundRect(c - vec2(0.0, e), hs, r)) + 1e-6);

  float bezel = min(uBezel, min(hs.x, hs.y));
  float t = clamp(-d / bezel, 0.0, 1.0);              // 0 at the edge, 1 past the bezel
  float curve = (1.0 - t) * (1.0 - t);                // lens: strongest at the edge
  vec2 disp = -n * curve * bezel * uRefract;

  float inner = smoothstep(0.0, 1.0, t);
  vec2 screen = uRect.xy + local;
  vec3 rimCol = vec3(
    sharp(screen + disp * (1.0 + uChroma)).r,
    sharp(screen + disp).g,
    sharp(screen + disp * (1.0 - uChroma)).b);
  vec3 col = mix(rimCol, soft(screen + disp), inner);

  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, uSaturate);
  col = mix(col, uTint.rgb, uTint.a);
  col = mix(col, uLift > 0.0 ? vec3(1.0) : vec3(0.0), abs(uLift) * (0.6 + 0.4 * inner));

  vec2 L = normalize(vec2(-0.55, -1.0));
  float rim = (1.0 - t) * (1.0 - t);
  col += rim * uSpecular * (0.55 * max(dot(n, L), 0.0) + 0.22 * max(dot(n, -L), 0.0));
  col += smoothstep(1.4, 0.0, abs(d + 0.9)) * uSpecular * 0.18;

  outColor = vec4(col * alpha, alpha);
}`;

// Resolution of a blurred layer: small blurs need full resolution to stay crisp (a low-res
// copy would look soft by itself); heavy blurs can be built small, which is cheaper.
const scaleFor = (blur) => (blur <= 3 ? Math.min(window.devicePixelRatio || 1, 2) : blur <= 8 ? 0.5 : 0.25);
const UNIFORMS = ['uImg', 'uImgRect', 'uSoft', 'uSoftRect', 'uHasImg', 'uSolid', 'uRect', 'uCover', 'uRadius', 'uBezel',
  'uRefract', 'uChroma', 'uDpr', 'uSaturate', 'uTint', 'uSpecular', 'uLift'];

export function wallpaperUrl() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--page-bg-url');
  return value.match(/url\(\s*["']?(.*?)["']?\s*\)/)?.[1] || null;
}

// Decoded wallpapers, shared by every surface: url -> Promise<HTMLImageElement|null>.
const images = new Map();
export function loadWallpaper(url) {
  if (!url) return Promise.resolve(null);
  if (!images.has(url)) {
    images.set(url, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous'; // remote wallpapers must be readable by WebGL
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    }));
  }
  return images.get(url);
}

function parseColor(css) {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) return [0.04, 0.04, 0.06];
  const [r, g, b] = m[1].split(/[\s,/]+/).map(Number);
  return [r / 255, g / 255, b / 255];
}

// The page background (wallpaper cover-fit to the viewport) with a real Gaussian blur, plus a
// margin with extended edges so the blur never fades at the viewport borders.
function blurredBackground(image, vw, vh, blur, k = scaleFor(blur)) {
  const m = Math.ceil(Math.max(blur, 4) * 2);
  const W = vw + 2 * m;
  const H = vh + 2 * m;
  const cw = Math.max(1, Math.round(W * k));
  const ch = Math.max(1, Math.round(H * k));
  const s = Math.max(vw / image.naturalWidth, vh / image.naturalHeight);
  const dw = image.naturalWidth * s;
  const dh = image.naturalHeight * s;
  const x = ((vw - dw) / 2 + m) * k;
  const y = ((vh - dh) / 2 + m) * k;
  const sharpCanvas = document.createElement('canvas');
  sharpCanvas.width = cw;
  sharpCanvas.height = ch;
  const g = sharpCanvas.getContext('2d');
  g.drawImage(image, x, y, dw * k, dh * k);
  const left = Math.max(0, Math.ceil(x));
  const top = Math.max(0, Math.ceil(y));
  const right = Math.min(cw, Math.floor(x + dw * k));
  const bottom = Math.min(ch, Math.floor(y + dh * k));
  if (left > 0) g.drawImage(sharpCanvas, left, 0, 1, ch, 0, 0, left, ch);
  if (right < cw) g.drawImage(sharpCanvas, right - 1, 0, 1, ch, right, 0, cw - right, ch);
  if (top > 0) g.drawImage(sharpCanvas, 0, top, cw, 1, 0, 0, cw, top);
  if (bottom < ch) g.drawImage(sharpCanvas, 0, bottom - 1, cw, 1, 0, bottom, cw, ch - bottom);
  const out = document.createElement('canvas');
  out.width = cw;
  out.height = ch;
  const o = out.getContext('2d');
  o.filter = blur > 0 ? `blur(${blur * k}px)` : 'none';
  o.drawImage(sharpCanvas, 0, 0);
  return { canvas: out, rect: [-m, -m, W, H] };
}

let renderer; // lazily created, shared

function createRenderer() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
  if (!gl) return null;
  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(UNIFORMS.map((n) => [n, gl.getUniformLocation(program, n)]));
  const sharpTex = gl.createTexture();
  const softTex = gl.createTexture();
  const setParams = () => {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  };
  const cache = new Map(); // blurred layers by wallpaper|viewport|blur
  const rim = { key: '', rect: [0, 0, 1, 1] };
  const body = { key: '', rect: [0, 0, 1, 1] };
  return {
    canvas,
    gl,
    draw({ image, rect, radius, dpr, opts }) {
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      gl.viewport(0, 0, w, h);
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let cover = [0, 0, vw, vh];
      const rimBlur = opts.blur * opts.edgeBlur;
      if (image) {
        const s = Math.max(vw / image.naturalWidth, vh / image.naturalHeight);
        const dw = image.naturalWidth * s;
        const dh = image.naturalHeight * s;
        cover = [(vw - dw) / 2, (vh - dh) / 2, dw, dh];
        const base = `${image.src.length}:${image.src.slice(-64)}|${vw}x${vh}@${dpr}`;
        const upload = (unit, tex, key, current, blur, scale) => {
          gl.activeTexture(unit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          if (key === current.key) return;
          let layer = cache.get(key);
          if (!layer) {
            layer = blurredBackground(image, vw, vh, blur, scale);
            cache.set(key, layer);
            if (cache.size > 4) cache.delete(cache.keys().next().value);
          }
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, layer.canvas);
          setParams();
          current.key = key;
          current.rect = layer.rect;
        };
        upload(gl.TEXTURE0, sharpTex, `${base}|rim${rimBlur}`, rim, rimBlur, scaleFor(rimBlur));
        upload(gl.TEXTURE1, softTex, `${base}|body${opts.blur}`, body, opts.blur, scaleFor(opts.blur));
      }
      gl.uniform1i(u.uImg, 0);
      gl.uniform4fv(u.uImgRect, rim.rect);
      gl.uniform1i(u.uSoft, 1);
      gl.uniform4fv(u.uSoftRect, body.rect);
      gl.uniform1i(u.uHasImg, image ? 1 : 0);
      gl.uniform3fv(u.uSolid, parseColor(getComputedStyle(document.body).backgroundColor));
      gl.uniform4f(u.uRect, rect.left, rect.top, rect.width, rect.height);
      gl.uniform4fv(u.uCover, cover);
      gl.uniform1f(u.uRadius, radius);
      gl.uniform1f(u.uBezel, opts.bezel);
      gl.uniform1f(u.uRefract, opts.refraction);
      gl.uniform1f(u.uChroma, opts.chroma);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform1f(u.uSaturate, opts.saturate);
      gl.uniform4f(u.uTint, opts.tint[0] / 255, opts.tint[1] / 255, opts.tint[2] / 255, opts.tint[3]);
      gl.uniform1f(u.uSpecular, opts.specular);
      gl.uniform1f(u.uLift, opts.lift);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return canvas;
    },
  };
}

export function staticGlassSupported() {
  if (renderer === undefined) {
    try {
      renderer = createRenderer();
    } catch (error) {
      console.warn('Static glass unavailable:', error);
      renderer = null;
    }
  }
  return !!renderer;
}

/** Renders the glass for `rect` and copies it into `target` (a 2D canvas). */
export function paintStaticGlass(target, { image, rect, radius, opts }) {
  if (!staticGlassSupported()) return false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const source = renderer.draw({ image, rect, radius, dpr, opts });
  if (target.width !== source.width || target.height !== source.height) {
    target.width = source.width;
    target.height = source.height;
  }
  const ctx = target.getContext('2d');
  ctx.clearRect(0, 0, target.width, target.height);
  ctx.drawImage(source, 0, 0);
  return true;
}
