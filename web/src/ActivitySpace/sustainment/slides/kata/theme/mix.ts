import type { Look, LookTokens, MixElement, MixState } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

export const MIX_ELEMENTS: { key: MixElement; label: string }[] = [
  { key: "ground", get label() { return tx("地と文字", "Ground & ink"); } },
  { key: "type", get label() { return tx("書体", "Type"); } },
  { key: "accent", get label() { return tx("強調色", "Accent"); } },
  { key: "number", get label() { return tx("数字", "Numbers"); } },
  { key: "shape", get label() { return tx("形", "Shape"); } },
];

/** 要素ごとに、どの世界観から取るかを決める。固定（pin）を優先し、残りは選んだ順に巡回で割り振る */
export function assignSources(state: MixState, available: Record<string, Look>): Record<MixElement, string> {
  const sel = state.selected.filter((id) => available[id]);
  const fallback = Object.keys(available)[0];
  const list = sel.length ? sel : [fallback];
  const out = {} as Record<MixElement, string>;
  let k = 0;
  for (const { key } of MIX_ELEMENTS) {
    const pin = state.pins[key];
    if (pin && list.includes(pin)) {
      out[key] = pin;
    } else {
      out[key] = list[(k + state.offset) % list.length];
      k++;
    }
  }
  return out;
}

export function mixTokens(state: MixState, available: Record<string, Look>): LookTokens {
  const src = assignSources(state, available);
  return {
    ground: available[src.ground].tokens.ground,
    type: available[src.type].tokens.type,
    accent: available[src.accent].tokens.accent,
    number: available[src.number].tokens.number,
    shape: available[src.shape].tokens.shape,
  };
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const v = [0, 2, 4]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}

function hue(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx === mn) return 0;
  const d = mx - mn;
  const raw = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (raw * 60 + 360) % 360;
}

function hueGap(a: string, b: string): number {
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d);
}

export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** 混ぜた結果に起きる見づらさを、直し方つきで返す */
export function mixWarnings(t: LookTokens): string[] {
  const w: string[] = [];
  if (contrast(t.accent.accent, t.ground.bg) < 1.15) w.push(tx("強調色が地に埋もれています。強調色を別の世界観から取ってください。", "The accent disappears into the background. Take the accent from another look."));
  if (contrast(t.number.num, t.number.block) < 3) w.push(tx("数字が読みにくくなっています。数字の要素を別の世界観から取ってください。", "Numbers are hard to read. Take the number style from another look."));
  // 色覚の多様性への配慮（伝わるデザイン）：強調色と数字の地が、明るさではなく色味だけで分かれていないか
  if (t.accent.accent.toLowerCase() !== t.number.block.toLowerCase() && contrast(t.accent.accent, t.number.block) < 1.3 && hueGap(t.accent.accent, t.number.block) > 40) {
    w.push(tx("強調色と数字の地が、色味だけで区別されています。明るさの差が無いと、色覚によっては同じ色に見えます。", "Accent and number colors differ only in hue. Without a lightness difference, some readers will see them as the same color."));
  }
  if (contrast(t.ground.ink, t.ground.bg) < 4.5) w.push(tx("本文の文字が地に対して薄すぎます。", "Body text is too faint against the background."));
  return w;
}

/** 選択の切り替え。最後の1つは外せない。外した世界観を指す固定は解く */
export function toggleLook(state: MixState, id: string): MixState {
  const selected = state.selected.slice();
  const i = selected.indexOf(id);
  const pins = { ...state.pins };
  if (i >= 0) {
    if (selected.length === 1) return state;
    selected.splice(i, 1);
    for (const k of Object.keys(pins) as MixElement[]) if (pins[k] === id) delete pins[k];
  } else {
    selected.push(id);
  }
  return { ...state, selected, pins };
}

export function tokensToCss(t: LookTokens): Record<string, string> {
  return {
    "--s-bg": t.ground.bg,
    "--s-ink": t.ground.ink,
    "--s-sub": t.ground.sub,
    "--s-line": t.ground.line,
    "--s-display": t.type.display,
    "--s-weight": String(t.type.weight),
    "--s-body": t.type.body,
    "--s-tracking": t.type.tracking,
    "--s-accent": t.accent.accent,
    "--s-tint": t.accent.tint,
    "--s-on-accent": t.accent.onAccent,
    "--s-block": t.number.block,
    // 表紙の飾り：強調色が数字の地と同じなら、淡い色に替えて見えるようにする
    "--s-dot": contrast(t.accent.accent, t.number.block) > 1.3 ? t.accent.accent : t.accent.tint,
    "--s-num": t.number.num,
    "--s-radius": `${Math.min(t.shape.radius, 24)}px`,
    "--s-radius-pill": `${t.shape.radius}px`,
  };
}
