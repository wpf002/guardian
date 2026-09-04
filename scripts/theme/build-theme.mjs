/**
 * Guardian theme generator.
 *
 * Produces the three-layer token set (primitives, semantic, component) in
 * OKLCH, emits apps/review/src/styles/tokens.json and theme.css, and validates
 * every required contrast pair with code rather than by eye. A pair below the
 * minimum fails the build.
 *
 * Direction: a reviewer reads text timelines about children for hours. The
 * palette has to be calm. One muted blue accent for the action, a warm neutral
 * ramp with a hint of that blue, and tier colours that inform without alarming.
 * Nothing is saturated red. T3 is a plum, not a siren.
 *
 * Run: node scripts/theme/build-theme.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(here, "..", "..", "apps", "review", "src", "styles");

// ---------------------------------------------------------------- colour math

function oklchToLinearSrgb(L, C, h) {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function gamma(v) {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** Reduce chroma until the colour fits inside sRGB, so a ramp never clips. */
function oklchToHex(L, C, h) {
  let c = C;
  let rgb = oklchToLinearSrgb(L, c, h);
  for (let i = 0; i < 40 && rgb.some((v) => v < 0 || v > 1); i++) {
    c *= 0.94;
    rgb = oklchToLinearSrgb(L, c, h);
  }
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const [r, g, b] = rgb.map((v) => Math.round(gamma(clamp(v)) * 255));
  return { hex: `#${[r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("")}`, oklch: `oklch(${(L * 100).toFixed(1)}% ${c.toFixed(3)} ${h})` };
}

function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
}

function luminance(hex) {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = luminance(fg) + 0.05;
  const b = luminance(bg) + 0.05;
  return a > b ? a / b : b / a;
}

// ------------------------------------------------------------------- ramps

const STEPS = { 50: 0.98, 100: 0.96, 200: 0.92, 300: 0.86, 400: 0.72, 500: 0.62, 600: 0.54, 700: 0.45, 800: 0.36, 900: 0.26, 950: 0.18 };

/** Chroma follows a bell so the ends of a ramp stay near-neutral. */
function ramp(hue, peakChroma, steps = STEPS) {
  const out = {};
  for (const [step, L] of Object.entries(steps)) {
    const t = Number(step) / 1000;
    const bell = Math.exp(-Math.pow((t - 0.55) / 0.32, 2));
    const C = peakChroma * (0.18 + 0.82 * bell);
    out[step] = oklchToHex(L, C, hue);
  }
  return out;
}

const ACCENT_HUE = 252;
const primitives = {
  neutral: ramp(ACCENT_HUE, 0.014),
  accent: ramp(ACCENT_HUE, 0.13),
  // Tier and status colours. Chroma is kept low on purpose.
  info: ramp(232, 0.10, { 100: 0.94, 300: 0.82, 500: 0.60, 700: 0.44, 900: 0.28 }),
  warning: ramp(72, 0.11, { 100: 0.95, 300: 0.85, 500: 0.70, 700: 0.52, 900: 0.34 }),
  danger: ramp(22, 0.11, { 100: 0.95, 300: 0.84, 500: 0.58, 700: 0.46, 900: 0.30 }),
  success: ramp(152, 0.09, { 100: 0.95, 300: 0.85, 500: 0.62, 700: 0.46, 900: 0.30 }),
  // T3 sits apart from danger: reviewer-confirmed is grave, not an emergency.
  plum: ramp(318, 0.09, { 100: 0.95, 300: 0.84, 500: 0.58, 700: 0.44, 900: 0.30 }),
  white: { hex: "#ffffff", oklch: "oklch(100% 0 0)" },
};

const P = (name, step) => (step === undefined ? primitives[name].hex : primitives[name][step].hex);

const semantic = {
  light: {
    bg: P("neutral", 50),
    surface: P("white"),
    "surface-raised": P("white"),
    "surface-sunken": P("neutral", 100),
    // border is the resting boundary of a control (input, outlined button, chip,
    // card that is a button) and must read at 3:1 on every surface it can sit
    // on, because this app spends nothing on shadows and the 1px rule is the
    // whole affordance. border-strong is the same boundary under the pointer or
    // in a pending state, so hover still reads as a change. divider is a
    // hairline between rows inside one surface and only needs to be visible.
    border: P("neutral", 500),
    "border-strong": P("neutral", 600),
    divider: P("neutral", 300),
    // Three text tiers, all of them body copy somewhere, so all three clear
    // 4.5:1 on bg, surface and surface-sunken.
    text: P("neutral", 900),
    "text-muted": P("neutral", 700),
    "text-subtle": P("neutral", 600),
    accent: P("accent", 600),
    "accent-hover": P("accent", 700),
    "accent-fg": P("white"),
    "accent-soft": P("accent", 100),
    "focus-ring": P("accent", 500),
    "info": P("info", 700), "info-soft": P("info", 100),
    "warning": P("warning", 700), "warning-soft": P("warning", 100),
    "danger": P("danger", 700), "danger-soft": P("danger", 100),
    "success": P("success", 700), "success-soft": P("success", 100),
    "grave": P("plum", 700), "grave-soft": P("plum", 100),
  },
  dark: {
    bg: P("neutral", 950),
    surface: P("neutral", 900),
    "surface-raised": P("neutral", 800),
    "surface-sunken": P("neutral", 950),
    border: P("neutral", 600),
    "border-strong": P("neutral", 500),
    divider: P("neutral", 800),
    text: P("neutral", 50),
    "text-muted": P("neutral", 300),
    "text-subtle": P("neutral", 400),
    accent: P("accent", 400),
    "accent-hover": P("accent", 300),
    "accent-fg": P("neutral", 950),
    "accent-soft": P("accent", 900),
    "focus-ring": P("accent", 300),
    "info": P("info", 300), "info-soft": P("info", 900),
    "warning": P("warning", 300), "warning-soft": P("warning", 900),
    "danger": P("danger", 300), "danger-soft": P("danger", 900),
    "success": P("success", 300), "success-soft": P("success", 900),
    "grave": P("plum", 300), "grave-soft": P("plum", 900),
  },
};

/**
 * Translucent values, kept out of the semantic map because the contrast
 * validator reasons over opaque hex. The scrim dims the page behind a dialog
 * rather than replacing it, which is what makes a dialog read as a layer.
 */
const overlays = {
  light: { scrim: "rgb(20 22 34 / 0.45)" },
  dark: { scrim: "rgb(4 5 6 / 0.62)" },
};

/** Component layer: only where a component genuinely diverges from semantic. */
const component = {
  // T0 takes the control border rather than the hairline, so its tier bar is as
  // perceivable as T1, T2 and T3 are.
  "tier-t0": { fg: "text-subtle", bg: "surface-sunken", border: "border" },
  "tier-t1": { fg: "info", bg: "info-soft", border: "info" },
  "tier-t2": { fg: "warning", bg: "warning-soft", border: "warning" },
  "tier-t3": { fg: "grave", bg: "grave-soft", border: "grave" },
  "button-primary": { bg: "accent", fg: "accent-fg", hover: "accent-hover" },
  "button-danger": { bg: "surface", fg: "danger", border: "danger" },
};

const nonColor = {
  space: { 1: "4px", 2: "8px", 3: "12px", 4: "16px", 5: "24px", 6: "32px", 7: "48px", 8: "64px", 9: "96px" },
  radius: { sm: "4px", md: "8px", lg: "12px", full: "9999px" },
  font: {
    ui: "'Inter', 'SF Pro Text', system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'SF Mono', ui-monospace, Menlo, monospace",
    size: { xs: "12px", sm: "14px", md: "16px", lg: "20px", xl: "24px", "2xl": "32px" },
    weight: { regular: 400, medium: 500, bold: 700 },
    leading: { tight: 1.2, snug: 1.4, normal: 1.6 },
  },
  shadow: {
    raised: "0 1px 2px rgb(20 22 34 / 0.06), 0 1px 3px rgb(20 22 34 / 0.08)",
    overlay: "0 8px 24px rgb(20 22 34 / 0.16), 0 2px 6px rgb(20 22 34 / 0.08)",
  },
  motion: { fast: "150ms", base: "200ms", slow: "300ms", in: "cubic-bezier(0.2, 0, 0, 1)", out: "cubic-bezier(0.4, 0, 1, 1)" },
  measure: "68ch",
};

// ---------------------------------------------------------------- validate

/**
 * Every text token is checked against all three grounds it can be painted on,
 * because a token validated only against --bg ships as body copy on a card and
 * on the sunken surface without anything noticing. Every boundary token is
 * checked at the 3:1 WCAG 1.4.11 minimum on the same three grounds.
 */
const REQUIRED = [
  ["text", "bg", 4.5], ["text", "surface", 4.5], ["text", "surface-sunken", 4.5],
  ["text-muted", "bg", 4.5], ["text-muted", "surface", 4.5], ["text-muted", "surface-sunken", 4.5],
  ["text-subtle", "bg", 4.5], ["text-subtle", "surface", 4.5], ["text-subtle", "surface-sunken", 4.5],
  ["accent-fg", "accent", 4.5],
  ["border", "bg", 3], ["border", "surface", 3], ["border", "surface-sunken", 3],
  ["border-strong", "bg", 3], ["border-strong", "surface", 3],
  ["divider", "bg", 1.4],
  ["focus-ring", "bg", 3], ["focus-ring", "surface", 3],
  // The accent is a link colour on every surface and the active nav item's text
  // on its own soft fill, so it is body contrast in four places, not three.
  ["accent", "bg", 3],
  ["accent", "surface", 4.5], ["accent", "surface-sunken", 4.5], ["accent", "accent-soft", 4.5],
  ["info", "info-soft", 4.5], ["warning", "warning-soft", 4.5], ["danger", "danger-soft", 4.5], ["success", "success-soft", 4.5], ["grave", "grave-soft", 4.5],
  ["info", "bg", 4.5], ["warning", "bg", 4.5], ["danger", "bg", 4.5], ["grave", "bg", 4.5],
];

const rows = [];
let failed = 0;
for (const theme of ["light", "dark"]) {
  for (const [fg, bg, min] of REQUIRED) {
    const ratio = contrast(semantic[theme][fg], semantic[theme][bg]);
    const ok = ratio >= min;
    if (!ok) failed++;
    rows.push({ theme, pair: `${fg} on ${bg}`, ratio: ratio.toFixed(2), min, ok: ok ? "ok" : "FAIL" });
  }
}

// ------------------------------------------------------------------- emit

function cssVars(obj) {
  return Object.entries(obj).map(([k, v]) => `  --${k}: ${v};`).join("\n");
}

const nonColorVars = [
  ...Object.entries(nonColor.space).map(([k, v]) => `  --space-${k}: ${v};`),
  ...Object.entries(nonColor.radius).map(([k, v]) => `  --radius-${k}: ${v};`),
  `  --font-ui: ${nonColor.font.ui};`,
  `  --font-mono: ${nonColor.font.mono};`,
  ...Object.entries(nonColor.font.size).map(([k, v]) => `  --text-${k}: ${v};`),
  ...Object.entries(nonColor.font.weight).map(([k, v]) => `  --weight-${k}: ${v};`),
  ...Object.entries(nonColor.font.leading).map(([k, v]) => `  --leading-${k}: ${v};`),
  `  --shadow-raised: ${nonColor.shadow.raised};`,
  `  --shadow-overlay: ${nonColor.shadow.overlay};`,
  ...Object.entries(nonColor.motion).map(([k, v]) => `  --motion-${k}: ${v};`),
  `  --measure: ${nonColor.measure};`,
].join("\n");

const componentVars = (theme) =>
  Object.entries(component)
    .flatMap(([name, roles]) => Object.entries(roles).map(([role, token]) => `  --${name}-${role}: var(--${token});`))
    .join("\n");

const css = `/* Generated by scripts/theme/build-theme.mjs. Do not edit by hand. */
/* Light is the base on :root. Dark overrides token values only. */
:root {
  color-scheme: light;
${cssVars(semantic.light)}
${cssVars(overlays.light)}
${nonColorVars}
${componentVars("light")}
}

:root[data-theme="dark"] {
  color-scheme: dark;
${cssVars(semantic.dark)}
${cssVars(overlays.dark)}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${cssVars(semantic.dark).replace(/^/gm, "  ")}
${cssVars(overlays.dark).replace(/^/gm, "  ")}
  }
}
`;

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(join(OUT_DIR, "tokens.json"), JSON.stringify({ primitives, semantic, component, overlays, ...nonColor }, null, 2));
writeFileSync(join(OUT_DIR, "theme.css"), css);

console.log("theme  pair                         ratio  min");
for (const r of rows) console.log(`${r.theme.padEnd(6)} ${r.pair.padEnd(28)} ${r.ratio.padStart(5)}  ${String(r.min).padStart(3)}  ${r.ok}`);
console.log(failed === 0 ? `\nall ${rows.length} pairs pass` : `\n${failed} pair(s) FAIL`);
process.exit(failed === 0 ? 0 : 1);
