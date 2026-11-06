import type { Look } from "@/ActivitySpace/artifacts/slides/kata/model/types";
import { tx } from "@/ActivitySpace/artifacts/slides/kata/i18n";

const SANS = "var(--font-inter), var(--font-noto-sans), sans-serif";
const JP = "var(--font-noto-sans), sans-serif";
const SERIF = "var(--font-noto-serif), serif";

export const LOOKS: Look[] = [
  {
    id: "forest",
    get name() { return tx("フォレスト", "Forest"); },
    source: "official",
    get tags() { return [tx("提案", "Proposal"), tx("硬め", "Formal")]; },
    tokens: {
      ground: { bg: "#FFFFFF", ink: "#12301F", sub: "#4E6355", line: "#D3DDD5", dark: false },
      type: { display: JP, weight: 700, body: JP, tracking: "0" },
      accent: { accent: "#1F5A3D", tint: "#E6F0D2", onAccent: "#FFFFFF" },
      number: { block: "#1F5A3D", num: "#FFFFFF" },
      shape: { radius: 0 },
    },
  },
  {
    id: "noir",
    get name() { return tx("ライム・ノワール", "Lime Noir"); },
    source: "official",
    get tags() { return [tx("ピッチ", "Pitch"), tx("硬め", "Formal")]; },
    tokens: {
      ground: { bg: "#F4F4F1", ink: "#111111", sub: "#5C5C58", line: "#D9D9D3", dark: false },
      type: { display: SANS, weight: 800, body: JP, tracking: "-0.02em" },
      accent: { accent: "#D4F23A", tint: "#EEF8C4", onAccent: "#111111" },
      number: { block: "#111111", num: "#D4F23A" },
      shape: { radius: 0 },
    },
  },
  {
    id: "botanical",
    get name() { return tx("グリーン・ボタニカル", "Green Botanical"); },
    source: "official",
    get tags() { return [tx("環境", "Sustainability"), tx("やわらか", "Soft")]; },
    tokens: {
      ground: { bg: "#FFFFFF", ink: "#1E2B22", sub: "#5A6B5F", line: "#DCE7DF", dark: false },
      type: { display: JP, weight: 500, body: JP, tracking: "0" },
      accent: { accent: "#2FB45A", tint: "#E3F5E8", onAccent: "#FFFFFF" },
      number: { block: "#DDEFE2", num: "#1E7A3C" },
      shape: { radius: 999 },
    },
  },
  {
    id: "yellow",
    get name() { return tx("イエロー・インフォ", "Yellow Info"); },
    source: "official",
    get tags() { return [tx("図解", "Diagrams"), tx("元気", "Bold")]; },
    tokens: {
      ground: { bg: "#F7D63B", ink: "#1A1A1A", sub: "#4A4320", line: "#E0BE2A", dark: false },
      type: { display: SANS, weight: 800, body: JP, tracking: "-0.02em" },
      accent: { accent: "#1A1A1A", tint: "#FBE886", onAccent: "#F7D63B" },
      number: { block: "#1A1A1A", num: "#F7D63B" },
      shape: { radius: 999 },
    },
  },
  {
    id: "editorial",
    get name() { return tx("オレンジ・エディトリアル", "Orange Editorial"); },
    source: "official",
    get tags() { return [tx("戦略", "Strategy"), tx("硬め", "Formal")]; },
    tokens: {
      ground: { bg: "#ECEDEF", ink: "#232323", sub: "#5E6066", line: "#D2D4D8", dark: false },
      type: { display: SANS, weight: 600, body: JP, tracking: "-0.01em" },
      accent: { accent: "#F26A21", tint: "#FDE3D3", onAccent: "#FFFFFF" },
      number: { block: "#232323", num: "#F26A21" },
      shape: { radius: 0 },
    },
  },
  {
    id: "deepforest",
    get name() { return tx("ダーク・フォレスト", "Dark Forest"); },
    source: "official",
    get tags() { return [tx("ピッチ", "Pitch"), tx("力強い", "Strong")]; },
    tokens: {
      ground: { bg: "#0F3D2A", ink: "#F3F7EF", sub: "#A9C2B2", line: "#2C5A45", dark: true },
      type: { display: JP, weight: 700, body: JP, tracking: "0" },
      accent: { accent: "#C9F24B", tint: "#1A5A3F", onAccent: "#0F3D2A" },
      number: { block: "#C9F24B", num: "#0F3D2A" },
      shape: { radius: 4 },
    },
  },
  {
    id: "sumi",
    get name() { return tx("墨と朱", "Sumi & Vermilion"); },
    source: "mine",
    get tags() { return [tx("構想", "Concept"), tx("静か", "Quiet")]; },
    tokens: {
      ground: { bg: "#FAF7F0", ink: "#1B1F1C", sub: "#5F625C", line: "#E2DCCD", dark: false },
      type: { display: SERIF, weight: 700, body: JP, tracking: "0.01em" },
      accent: { accent: "#C2412D", tint: "#F3E4D8", onAccent: "#FFFFFF" },
      number: { block: "#1B1F1C", num: "#FAF7F0" },
      shape: { radius: 0 },
    },
  },
  {
    id: "midnight",
    get name() { return tx("ミッドナイト", "Midnight"); },
    source: "official",
    get tags() { return [tx("報告", "Report"), tx("静か", "Quiet")]; },
    tokens: {
      ground: { bg: "#111318", ink: "#ECEDEF", sub: "#9A9EA8", line: "#2A2E37", dark: true },
      type: { display: SANS, weight: 600, body: JP, tracking: "-0.01em" },
      accent: { accent: "#7CA7FF", tint: "#1C2433", onAccent: "#111318" },
      number: { block: "#1C2433", num: "#7CA7FF" },
      shape: { radius: 6 },
    },
  },
  {
    id: "navy",
    get name() { return tx("コーポレート・ネイビー", "Corporate Navy"); },
    source: "official",
    get tags() { return [tx("経営会議", "Board"), tx("硬め", "Formal")]; },
    tokens: {
      ground: { bg: "#FFFFFF", ink: "#14213D", sub: "#56607A", line: "#DCE1EA", dark: false },
      type: { display: JP, weight: 700, body: JP, tracking: "0" },
      accent: { accent: "#2F6FED", tint: "#E7EEFD", onAccent: "#FFFFFF" },
      number: { block: "#14213D", num: "#FFFFFF" },
      shape: { radius: 4 },
    },
  },
  {
    id: "mono",
    get name() { return tx("モノクロ・ミニマル", "Mono Minimal"); },
    source: "official",
    get tags() { return [tx("報告", "Report"), tx("静か", "Quiet")]; },
    tokens: {
      ground: { bg: "#FFFFFF", ink: "#0A0A0A", sub: "#6B6B6B", line: "#E4E4E4", dark: false },
      type: { display: SANS, weight: 700, body: JP, tracking: "-0.02em" },
      accent: { accent: "#0A0A0A", tint: "#F2F2F2", onAccent: "#FFFFFF" },
      number: { block: "#0A0A0A", num: "#FFFFFF" },
      shape: { radius: 0 },
    },
  },
  {
    // 伝わるデザインのカラーユニバーサルデザインと Okabe–Ito の色。色覚が違っても、明るさの差で見分けられる
    id: "universal",
    get name() { return tx("ユニバーサル", "Color-universal"); },
    source: "official",
    get tags() { return [tx("色覚に配慮", "Color-safe"), tx("報告", "Report")]; },
    tokens: {
      ground: { bg: "#FFFFFF", ink: "#1A1A1A", sub: "#555555", line: "#DDDDDD", dark: false },
      type: { display: JP, weight: 700, body: JP, tracking: "0" },
      accent: { accent: "#E69F00", tint: "#FDF1D8", onAccent: "#1A1A1A" },
      number: { block: "#0072B2", num: "#FFFFFF" },
      shape: { radius: 2 },
    },
  },
];

export const LOOK_BY_ID: Record<string, Look> = Object.fromEntries(LOOKS.map((l) => [l.id, l]));
