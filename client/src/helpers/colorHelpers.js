// colorHelpers.js — shared color utility functions

export function hexToRgba(hex, alpha) {
  if (!hex || !hex.startsWith("#") || hex.length < 7) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// Blend hex color toward white by amount (0=original, 1=white)
// (also takes rgb()/rgba() — a colour re-rendered in a skin's palette comes back in that form)
export function lightenHex(hex, amount) {
  const m = typeof hex === "string" && /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(hex);
  if (!m && (!hex || !hex.startsWith("#") || hex.length < 7)) return "#ffffff";
  const r = m ? Number(m[1]) : parseInt(hex.slice(1, 3), 16);
  const g = m ? Number(m[2]) : parseInt(hex.slice(3, 5), 16);
  const b = m ? Number(m[3]) : parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `rgb(${lr},${lg},${lb})`;
}
