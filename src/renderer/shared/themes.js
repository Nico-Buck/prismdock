// Design tokens per theme. "custom" is filled from config.appearance.custom.
export const THEMES = {
  glass: {
    label: 'Liquid Glass', dark: true,
    tint: '#141416', tintOpacity: 0.40, blur: 26, saturation: 1.7, brightness: 1.0,
    refraction: 0.6, specular: 0.55, chroma: 0.28, rim: 0.5, radius: 22, tileRadius: 18,
    border: '#ffffff', borderOpacity: 0.12, shadow: 0.45, tile: '#000000', tileOpacity: 0.18, text: '#f5f5f7', accent: '#0a84ff',
  },
  white: {
    label: 'White', dark: false,
    tint: '#f6f6f8', tintOpacity: 0.74, blur: 30, saturation: 1.5, brightness: 1.08,
    refraction: 0.35, specular: 0.35, chroma: 0.08, rim: 0.7, radius: 22, tileRadius: 18,
    border: '#000000', borderOpacity: 0.07, shadow: 0.28, tile: '#ffffff', tileOpacity: 0.62, text: '#1d1d1f', accent: '#007aff',
  },
  ios: {
    label: 'iOS Glass', dark: true,
    tint: '#ffffff', tintOpacity: 0.08, blur: 16, saturation: 2.0, brightness: 1.04,
    refraction: 1.0, specular: 0.9, chroma: 0.5, rim: 1.0, radius: 24, tileRadius: 20,
    border: '#ffffff', borderOpacity: 0.22, shadow: 0.35, tile: '#ffffff', tileOpacity: 0.10, text: '#ffffff', accent: '#0a84ff',
  },
  midnight: {
    label: 'Midnight', dark: true,
    tint: '#0a1233', tintOpacity: 0.58, blur: 28, saturation: 1.5, brightness: 0.95,
    refraction: 0.5, specular: 0.45, chroma: 0.2, rim: 0.45, radius: 22, tileRadius: 18,
    border: '#9db8ff', borderOpacity: 0.14, shadow: 0.5, tile: '#030820', tileOpacity: 0.35, text: '#eef2ff', accent: '#5e9eff',
  },
  black: {
    label: 'Black', dark: true,
    tint: '#0b0b0c', tintOpacity: 0.94, blur: 10, saturation: 1.0, brightness: 1.0,
    refraction: 0.08, specular: 0.2, chroma: 0.0, rim: 0.22, radius: 22, tileRadius: 18,
    border: '#ffffff', borderOpacity: 0.08, shadow: 0.55, tile: '#ffffff', tileOpacity: 0.045, text: '#f5f5f7', accent: '#0a84ff',
  },
};

export function resolveTheme(appearance) {
  if (appearance.theme === 'custom') return { label: 'Custom', dark: isDark(appearance.custom.text) === false, ...appearance.custom };
  return THEMES[appearance.theme] || THEMES.glass;
}

function isDark(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

const rgba = (hex, a) => {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
};

// Write the theme into CSS custom properties on an element.
export function applyTheme(el, cfg) {
  const t = resolveTheme(cfg.appearance);
  const L = cfg.layout;
  const barH = L.size === 'custom' ? L.height : ({ S: 46, M: 54, L: 64 })[L.size] || 54;
  const tileH = barH - L.padding * 2;
  const u = tileH / 64;
  const darkText = isDark(t.text);
  const s = el.style;
  s.setProperty('--bar-h', barH + 'px');
  s.setProperty('--tile-h', tileH + 'px');
  s.setProperty('--u', u);
  s.setProperty('--fu', (0.35 + 0.65 * u).toFixed(3)); // type scales gentler than geometry so compact bars stay legible
  s.setProperty('--pad', L.padding + 'px');
  s.setProperty('--gap', L.gap + 'px');
  s.setProperty('--margin', L.margin + 'px');
  // bar corners stay concentric with the widget capsules: outer radius = inner radius + padding
  s.setProperty('--radius', Math.min(t.radius * u + (L.padding - 4 * u), barH / 2) + 'px');
  s.setProperty('--tile-r', Math.min(t.tileRadius * u, tileH / 2) + 'px');
  s.setProperty('--text', t.text);
  s.setProperty('--text-2', rgba(t.text, 0.55));
  s.setProperty('--text-3', rgba(t.text, 0.32));
  s.setProperty('--fill-1', darkText ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.08)');
  s.setProperty('--fill-2', darkText ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.14)');
  s.setProperty('--fill-3', darkText ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.22)');
  s.setProperty('--track', darkText ? 'rgba(0,0,0,.10)' : 'rgba(255,255,255,.12)');
  s.setProperty('--tile-bg', rgba(t.tile, t.tileOpacity));
  s.setProperty('--tile-border', rgba(t.border, t.borderOpacity));
  s.setProperty('--accent', t.accent);
  s.setProperty('--shadow-a', t.shadow);
  s.setProperty('--icon', cfg.appearance.iconSize * u + 'px');
  s.setProperty('--font-scale', cfg.appearance.fontScale);
  s.setProperty('--anim', cfg.appearance.animations ? cfg.appearance.animSpeed : 0.0001);
  s.setProperty('--panel-bg', rgba(t.tint, Math.min(1, t.tintOpacity + (darkText ? 0.1 : 0.12))));
  el.dataset.tone = darkText ? 'light' : 'dark';
  el.dataset.theme = cfg.appearance.theme;
  return { ...t, sheen: !cfg.performance.powerSaver };
}
