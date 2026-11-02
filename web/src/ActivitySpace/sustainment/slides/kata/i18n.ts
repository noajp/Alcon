// 表示言語。アプリ（Alcon）の言語設定に従う。画面・チャットの返事・赤入れの文は
// tx("日本語", "English") で書き、日本語なら1つ目、英語なら2つ目を出す。韓国語・
// フランス語・スペイン語は、英語の文をキーに Slides の辞書（kataMessages）から引き、
// 無ければアプリの辞書から引く。Slides の辞書はアプリ全体には混ぜない（同じ英語が
// アプリでは別の意味を持つことがある — Structure、Source など）。
// 値を埋める文は tx("{n} 枚", "{n} slides", { n }) と書く。
// 言語が変わると AppShell が全体を描き直す。
import type { Locale } from "@/Function/i18n/locales";
import { appMessage } from "@/Function/i18n/I18nProvider";
import { KATA_TRANSLATIONS } from "./kataMessages";

/** 資料・AI・書き出しで使う言語。日本語以外の画面では英語で作る */
export type Lang = "ja" | "en";

let current: Lang = "ja";
let uiLocale: Locale = "ja";

/** 資料の言語だけを決める（テストや、言語の決まった処理から）。画面の文もそれに合わせる */
export function setLang(l: Lang) {
  current = l;
  uiLocale = l;
}

/** アプリの言語に合わせる。画面の文は uiLocale、資料を作る言語は ja / en */
export function setUiLocale(locale: Locale) {
  uiLocale = locale;
  current = locale === "ja" ? "ja" : "en";
}

export function getLang(): Lang {
  return current;
}

export function tx(ja: string, en: string, values?: Record<string, string | number>): string {
  const text = uiLocale === "ja" ? ja
    : uiLocale === "en" ? en
    : KATA_TRANSLATIONS[uiLocale]?.[en] ?? appMessage(uiLocale, en) ?? en;
  return values ? text.replace(/\{(\w+)\}/g, (all, key: string) => (key in values ? String(values[key]) : all)) : text;
}

/** 語る順番の役割など、データとして日本語で持っている語の表示名 */
const ROLE_EN: Record<string, string> = {
  表紙: "Cover",
  要約: "Summary",
  状況: "Situation",
  難しさ: "Complication",
  解決: "Resolution",
  次の一歩: "Next step",
  結論: "Answer",
  根拠1: "Reason 1",
  根拠2: "Reason 2",
  根拠3: "Reason 3",
  "空（事実）": "Sky (fact)",
  "雨（解釈）": "Rain (meaning)",
  "傘（打ち手）": "Umbrella (action)",
  課題: "Issue",
  原因: "Cause",
  問い: "Question",
  答え: "Answer",
  追加: "Added",
};

export function roleLabel(role: string, lang: Lang = current): string {
  if (lang !== "en") return role;
  return ROLE_EN[role] ?? role;
}

/** 文の言語（かな・漢字があれば日本語）。スライドに刷る言葉は、画面ではなく資料の言語に合わせる */
export function textLang(s: string): Lang {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(s) ? "ja" : "en";
}
