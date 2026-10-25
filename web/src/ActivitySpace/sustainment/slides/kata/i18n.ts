// 表示言語。画面・チャットの返事・赤入れの文を、日本語と英語で出し分ける。
// 使い方：tx("日本語", "English")。切り替えると AppShell が全体を描き直す。

export type Lang = "ja" | "en";

let current: Lang = "ja";

export function setLang(l: Lang) {
  current = l;
}

export function getLang(): Lang {
  return current;
}

/** 初めて開いたときの言語。ブラウザの言語が日本語なら ja、それ以外は en */
export function detectLang(nav?: string): Lang {
  return /^ja\b/i.test(nav ?? "") ? "ja" : "en";
}

/** 保存済みの状態から言語を決める。lang の無い古い保存は日本語だけの頃のものなので ja にする */
export function langFromPersisted(persisted: { lang?: unknown } | undefined | null, fallback: Lang): Lang {
  if (!persisted) return fallback;
  return persisted.lang === "en" || persisted.lang === "ja" ? persisted.lang : "ja";
}

export function tx(ja: string, en: string): string {
  return current === "en" ? en : ja;
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
