import { deleteSlide, insertSlide, pruneRefs, setLayout } from "./deck";
import { LAYOUT_BY_ID } from "./layouts";
import { planDeck, slideFromInstruction, summarySlide } from "./planner";
import { reviewDeck } from "./review";
import { applyTerms, reviewWithSkills, titleLimit, type Skill } from "./skill";
import { STORYLINE_BY_ID } from "./storyline";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import type { Deck, LayoutId, StorylineId } from "./types";

// チャットの一言を、デッキへの操作に変える。API を使わずに手元で解釈する。

export interface ChatResult {
  deck?: Deck;
  current?: number;
  reply: string;
}

/** 論点（この資料で答える問い）の置き方。選ぶと語る順番が決まる */
export interface IssueChoice {
  id: string;
  label: string;
  /** 画面から送る一言（今の言語） */
  ask: string;
  askJa: string;
  askEn: string;
  storyline: StorylineId;
  note: string;
}

function issueChoice(id: string, storyline: StorylineId, label: [string, string], ask: [string, string], note: [string, string]): IssueChoice {
  return {
    id,
    storyline,
    askJa: ask[0],
    askEn: ask[1],
    get label() {
      return tx(label[0], label[1]);
    },
    get ask() {
      return tx(ask[0], ask[1]);
    },
    get note() {
      return tx(note[0], note[1]);
    },
  };
}

export const ISSUES: IssueChoice[] = [
  issueChoice("decide", "pyramid", ["判断を迫る", "Force a decision"], ["論点を「やるか、やらないか」に置き直して", "Reframe the issue as: do it or not?"], ["結論を先に置き、根拠で支え、最後に決めてほしいことを書く順にしました。", "I put the answer first, backed it with reasons, and ended with what needs deciding."]),
  issueChoice("empathy", "scr", ["共感を集める", "Win support"], ["論点を「誰の、どんな痒みに、どう届けるか」に置き直して", "Reframe the issue as: whose itch, and how we reach it"], ["状況から入り、難しさを共有してから解決を見せる順にしました。", "I open with the situation, share the complication, then show the resolution."]),
  issueChoice("verify", "issue", ["検証を計画する", "Plan a test"], ["論点を「最初に何を確かめるか」に置き直して", "Reframe the issue as: what do we test first?"], ["課題を出し、原因を掘り、確かめる打ち手で締める順にしました。", "I state the issue, dig into causes, and close with actions to test."]),
];

export function looksLikeDocument(text: string): boolean {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length >= 6 || /^#{1,3}\s/m.test(text)) return true;
  // 英語は文字数ではなく語数と形で見る（長めの頼みを資料と取り違えない）
  if (!/[\u3000-\u30ff\u3400-\u9fff\uff00-\uffef]/.test(text)) {
    const words = text.split(/\s+/).filter(Boolean).length;
    return words >= 80 || (lines.length >= 3 && words >= 40);
  }
  return text.length > 220;
}

const STORY_WORDS: [RegExp, StorylineId][] = [
  [/(結論|ピラミッド)(から|→|先)|answer[- ]first|pyramid/i, "pyramid"],
  [/空.?雨.?傘|sky\W{0,6}rain\W{0,6}umbrella/i, "skyrain"],
  [/課題.?(→|から)?.?原因|\bissue\W{0,6}(to\W{0,3})?cause/i, "issue"],
  [/(SCR|状況.?(→|から)?.?難しさ|状況.?(→|から)?.?課題)|situation\W{0,6}(to\W{0,3})?complication/i, "scr"],
];

/** 並べ直す・組み直す、という頼みの言葉 */
const REORDER_WORDS = /(順|型|構成|並べ|組み直)|\b(re-?order|order|rearrange|restructure|reorganize|storyline|structure)\b/i;

const LAYOUT_WORDS: [RegExp, LayoutId][] = [
  [/2\s*[×x✕]\s*2|マトリクス|四象限|象限|\bmatrix\b|quadrant/i, "matrix"],
  [/比較|比べ|compar/i, "compare"],
  [/前提|帰結|\bpremise/i, "premise"],
  [/根拠.?(3|三)|3つ|三つ|\b(three|3) (reasons|points|pillars)\b/i, "claim3"],
  [/打ち手|課題.?(と|→)|\bissues?\W{0,6}(to\W{0,3}|and\W{0,3})?actions?\b/i, "issue"],
  [/流れ|ステップ|段階|手順|\b(steps|flow|process|stages|timeline)\b/i, "steps"],
  [/一言|数字で|言い切|\b(headline|big number|statement)\b/i, "statement"],
];

const KANJI_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const EN_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function parseCount(s: string): number | null {
  const en = s.match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(slides?|pages?)\b/i);
  if (en) {
    const w = en[1].toLowerCase();
    return EN_NUM[w] ?? parseInt(w, 10);
  }
  const m = s.match(/([0-9０-９]+|[一二三四五六七八九十]+)\s*枚/);
  if (!m) return null;
  const v = m[1];
  if (/^[一二三四五六七八九十]+$/.test(v)) {
    if (v === "十") return 10;
    if (v.length === 1) return KANJI_NUM[v];
    if (v[0] === "十") return 10 + KANJI_NUM[v[1]];
    if (v.length === 2) return KANJI_NUM[v[0]] * 10;
    return KANJI_NUM[v[0]] * 10 + KANJI_NUM[v[2]];
  }
  return parseInt(v.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)), 10);
}

/** 枚数を減らす頼みの言葉 */
const SHRINK_WORDS = /(減ら|まとめ|圧縮|絞|以内)|\b(condense|shrink|cut|reduce|trim|compress|down to|within|fit)\b/i;
const THIS_PAGE = /(このページ|この(1)?枚|今のページ)|\b(this|current) (page|slide)\b/i;
const DELETE_WORDS = /(消して|削除|いらない|要らない)|\b(delete|remove|drop)\b/i;
/** 英語の「ページを足して」。a / an / one / another / new … slide|page の形のときだけ（「this slide に詳しく足して」は足さない） */
const ADD_EN = /\b(add|insert|append|create)\s+(?:(?:a|an|one|1|another|new|extra)\s+)+(?:[\w-]+\s+){0,3}?(slide|page)s?\b/i;
/** このページをグラフに */
const CHART_CMD = /(グラフ|チャート)(に|化)(して|する)|グラフ化|\b(make|turn|convert|change)\s+(this|it)\s+(page\s+|slide\s+)?(in)?to\s+(a\s+)?(chart|graph)\b|\b(make|turn)\s+(this|it)\s+(page\s+|slide\s+)?(a\s+)?(chart|graph)\b/i;
/** エグゼクティブサマリーを入れる */
const SUMMARY_CMD = /(エグゼクティブ)?(サマリ[ーィ]?|要約)(のページ|ページ)?を?(入れ|足し|付け|追加|作っ|置い)|\b(add|insert|create|make|include)\s+(an?\s+)?(exec(utive)?\s+)?summary\b/i;
const AT_END = /(最後|末尾|おわり|終わり)|\b(at|to) the end\b|\bas the last\b/i;

/** 英語の「スライドを足して」から、ページのタイトルになる部分だけを残す */
function englishTitle(t: string): string {
  const body = t
    .replace(/^\s*(please\s+)?(can you\s+)?/i, "")
    .replace(/\b(add|insert|append)\b\s*(a|an|one|1|another|new)?\s*(new\s+)?(slide|page)?\s*/i, "")
    .replace(/\b(at|to) the end( of the deck)?\b|\bas the last (slide|page)\b/gi, "")
    .replace(/^\s*(about|on|for|covering|that says|saying|titled|called)\b\s*/i, "")
    .replace(/^[\s,:;—-]+|[\s,:;.!—-]+$/g, "")
    .trim();
  return body ? body[0].toUpperCase() + body.slice(1) : "New page";
}

/** 表紙・最初の要約・結びを残し、間を等間隔に間引く */
export function compressDeck(deck: Deck, target: number): Deck {
  const n = deck.slides.length;
  if (target >= n || target < 2) return deck;
  const keep = new Set<number>([0, n - 1]);
  if (target >= 4 && deck.slides[1]) keep.add(1);
  const middle = [...Array(n).keys()].filter((i) => !keep.has(i));
  const need = target - keep.size;
  for (let k = 0; k < need; k++) keep.add(middle[Math.round(((k + 0.5) * middle.length) / need - 0.5)]);
  return { ...deck, slides: pruneRefs(deck.slides.filter((_, i) => keep.has(i))) };
}

export function respondLocally(deck: Deck, current: number, text: string, skills: Skill[] = []): ChatResult {
  const t = text.trim();
  if (!t) return { reply: "" };
  const no = (i: number) => String(i + 1).padStart(2, "0");

  if (looksLikeDocument(t)) {
    // 末尾の短い頼み（「12枚で」「in 12 slides」「日本語で」）を読む
    // 頼み（「12枚で」「日本語で」）は、添えた頼みの印からだけ読む。文書の本文の「3ページ」は枚数ではない
    const askM = t.match(/<!--\s*ask:\s*([\s\S]*?)\s*-->\s*$/);
    const tail = askM?.[1] ?? "";
    const doc = askM ? t.slice(0, askM.index).trimEnd() : t;
    const bm = tail.match(/(\d{1,2})\s*(?:枚|slides?|pages?)/i);
    const budget = bm ? Math.max(4, Math.min(40, Number(bm[1]))) : undefined;
    let next = planDeck(doc, deck.storyline, budget);
    // 章立ての資料は、プランナーが章ごとに枚数を配っている。位置で間引くと章の中身だけが消えるので、ここでは間引かない
    if (budget && next.slides.length > budget && !next.slides.some((s) => s.layout === "agenda")) next = compressDeck(next, budget);
    const layouts = new Set(next.slides.map((s) => LAYOUT_BY_ID[s.layout].name));
    const docJa = /[\u3040-\u30ff\u3400-\u9fff]/.test(next.title);
    const wantJa = /日本語|\bin japanese\b/i.test(tail);
    const wantEn = /英語|\bin english\b/i.test(tail);
    // 手元のプランナーは訳せない。訳してほしいと頼まれたら、そう言う
    const lang = (wantJa && !docJa) || (wantEn && docJa)
      ? tx(" 別の言語での作成（翻訳）は Claude の経路の仕事で、API キーが要ります。手元のプランナーは原文の言葉のまま組みました。", " Writing it in another language (translation) needs the Claude path and an API key; the local planner kept the document's own language.")
      : "";
    const long = next.slides.some((s) => s.layout === "agenda");
    return {
      deck: next,
      current: 0,
      reply:
        tx(
          "{n}枚に組みました。{long}順番は「{order}」、ページの型は {layouts} を使っています。各ページの下に、元にした箇所を書いてあります。前の内容には ⌘Z で戻れます。",
          "Built {n} slides. {long}Order: \"{order}\"; page types: {layouts}. Each page notes the source passage at the bottom. ⌘Z brings back the previous version.",
          {
            n: next.slides.length,
            long: long ? tx("長い文書なので、エグゼクティブサマリーと目次のあと、章ごとに中扉を立てています。", "It's a long document, so after the executive summary and agenda each chapter gets a divider. ") : "",
            order: STORYLINE_BY_ID[next.storyline].name,
            layouts: [...layouts].join(tx("・", ", ")),
          },
        ) + lang,
    };
  }

  // 英語で「足して」と頼まれたときは、中の語（review など）に引っ張られないよう先に見る
  const addingEn = new RegExp(`^\\s*(please\\s+)?(can you\\s+)?${ADD_EN.source}`, "i").test(t);

  if (!addingEn && (/(用語|言葉).*(そろえ|揃え|統一)/.test(t) || /\b(align|unify|standardi[sz]e|harmoni[sz]e)\b.*\b(terms?|terminology|wording)\b/i.test(t))) {
    const r = applyTerms(deck, skills);
    if (!r.count) return { reply: tx("マイ・スキルの用語で直すところはありませんでした。決まりは左下の「マイ・スキル」で足せます。", "Nothing to change against your My Skills terms. You can add rules under My Skills at the bottom left.") };
    return { deck: r.deck, reply: (r.count === 1 ? tx("マイ・スキルの用語に {n} か所そろえました。", "Aligned {n} place to your My Skills terms.", { n: r.count }) : tx("マイ・スキルの用語に {n} か所そろえました。", "Aligned {n} places to your My Skills terms.", { n: r.count })) };
  }

  const issue = ISSUES.find((x) => x.askJa === t || x.askEn.toLowerCase() === t.toLowerCase());
  if (issue) {
    return { deck: { ...deck, storyline: issue.storyline }, current: 0, reply: tx("論点を「{label}」に置き直しました。{note}", "Reframed the issue as \"{label}\". {note}", { label: issue.label, note: issue.note }) };
  }

  if (!addingEn && (/(赤入れ|レビュー|チェック|見直)/.test(t) || /\b(review|red[- ]?pen|check|proofread|critique)\b/i.test(t))) {
    const f = [...reviewDeck(deck, titleLimit(skills)), ...reviewWithSkills(deck, skills)];
    if (!f.length) return { reply: tx("機械で測れる範囲では、指摘はありません。中身の so what は、各ページのタイトルを通して読んで確かめてください。", "Nothing to flag on the mechanical checks. To check the so-what, read the slide titles straight through.") };
    const lines = f.slice(0, 6).map((x) => {
      const i = deck.slides.findIndex((s) => s.id === x.slideId);
      return `・${i >= 0 ? no(i) + tx("　", "  ") : ""}${x.text}`;
    });
    const more = f.length > 6 ? tx("\nほか {n} 件", "\n…and {n} more", { n: f.length - 6 }) : "";
    return { reply: `${(f.length === 1 ? tx("赤入れが {n} 件あります。", "{n} red-pen note:", { n: f.length }) : tx("赤入れが {n} 件あります。", "{n} red-pen notes:", { n: f.length }))}\n${lines.join("\n")}${more}` };
  }

  for (const [re, id] of STORY_WORDS) {
    if (!addingEn && re.test(t) && REORDER_WORDS.test(t)) {
      const second = deck.slides[1];
      const hint =
        id === "pyramid" && second && second.layout !== "statement"
          ? tx("この型は2枚目の結論が要です。2枚目を「{layout}」にして、結論を一文で書くと生きます。", " This order hinges on the answer on slide 2. Make slide 2 a \"{layout}\" and state the answer in one sentence.", { layout: LAYOUT_BY_ID.statement.name })
          : "";
      return { deck: { ...deck, storyline: id }, reply: tx("「{name}」の順に組み直しました。手で付け替えた役割はそのまま残しています。{hint}", "Reordered as \"{name}\". Roles you set by hand are kept.{hint}", { name: STORYLINE_BY_ID[id].name, hint }) };
    }
  }

  const shrinking = (() => {
    const n = parseCount(t);
    return !!n && n >= 2 && SHRINK_WORDS.test(t);
  })();
  if (!shrinking && !addingEn && THIS_PAGE.test(t)) {
    if (DELETE_WORDS.test(t)) {
      if (deck.slides.length <= 1) return { reply: tx("最後の1枚なので消せません。中身を書き換えるか、新しく流し直してください。", "This is the only slide, so it can't be deleted. Rewrite it, or paste new material to rebuild.") };
      return { deck: deleteSlide(deck, current), current: Math.max(0, current - 1), reply: tx("{slide} を消しました。", "Deleted {slide}.", { slide: no(current) }) };
    }
    for (const [re, id] of LAYOUT_WORDS) {
      if (re.test(t)) {
        const slide = deck.slides[current];
        return {
          deck: setLayout(deck, slide.id, id),
          reply: tx("{slide} を「{layout}」の組み方に変えました。前の中身は残してあるので、戻せば元に戻ります。", "Changed {slide} to \"{layout}\". The previous content is kept, so switching back restores it.", { slide: no(current), layout: LAYOUT_BY_ID[id].name }),
        };
      }
    }
  }

  if (!addingEn && SUMMARY_CMD.test(t)) {
    const at = deck.slides.findIndex((x) => x.layout === "summary");
    if (at >= 0) return { current: at, reply: tx("サマリーはもう {slide} にあります。", "There's already a summary at {slide}.", { slide: no(at) }) };
    const sum = summarySlide(deck.slides);
    const next = insertSlide(deck, deck.slides[0]?.layout === "cover" ? 0 : -1, sum);
    const pos = next.slides.findIndex((x) => x.id === sum.id);
    return { deck: next, current: pos, reply: tx("{slide} にエグゼクティブサマリーを入れました。要点のページ番号は並びを変えても追いかけます。", "Added an executive summary as {slide}. Its page references follow the slides if you reorder.", { slide: no(pos) }) };
  }

  if (!addingEn && CHART_CMD.test(t)) {
    const slide = deck.slides[current];
    if (!slide) return { reply: "" };
    return {
      deck: setLayout(deck, slide.id, "chart"),
      reply: tx("{slide} をグラフにしました。数の並びから種類を選んでいます。前の中身は残してあるので、戻せば元に戻ります。", "Turned {slide} into a chart, picking the type from the numbers. The previous content is kept, so switching back restores it.", { slide: no(current) }),
    };
  }

  const count = parseCount(t);
  if (count && count >= 2 && !addingEn && (/(減ら|まとめ|圧縮|絞|にして|以内)/.test(t) || SHRINK_WORDS.test(t) || /\b(make it|keep it to|go to)\b/i.test(t))) {
    if (count === deck.slides.length) return { reply: tx("今もちょうど {n} 枚です。", "It's already exactly {n} slides.", { n: count }) };
    if (count > deck.slides.length) return { reply: tx("今は {have} 枚なので、{n} 枚にするには増やす必要があります。足したいことを書いてください。", "There are {have} slides now, so getting to {n} means adding some. Tell me what to add.", { have: deck.slides.length, n: count }) };
    const next = compressDeck(deck, count);
    return {
      deck: next,
      current: 0,
      reply: tx(
        "{from} 枚から {to} 枚に絞りました。表紙・要約・結びは残し、本体を等間隔に残しています。消えたページは「論理構成」から戻すより、もう一度流し直すほうが早いです。",
        "Condensed from {from} to {to} slides, keeping the cover, summary and close and evenly sampling the body. To bring dropped pages back, rebuilding from the source is quicker than restoring them one by one.",
        { from: deck.slides.length, to: next.slides.length },
      ),
    };
  }

  if (addingEn || ADD_EN.test(t) || /(足して|追加|加えて|入れて|作って|ほしい)/.test(t)) {
    const en = addingEn || ADD_EN.test(t);
    const base = slideFromInstruction(t);
    const slide = en ? { ...base, title: englishTitle(t), source: tx("チャットの指示", "From chat") } : base;
    // 「最後に」は結びの手前に入れる（結びのページは最後に残す）
    const lastIdx = deck.slides.length - 1;
    const at = AT_END.test(t) ? (deck.slides[lastIdx]?.layout === "closing" ? lastIdx - 1 : lastIdx) : current;
    const next = insertSlide(deck, at, slide);
    const pos = next.slides.findIndex((s) => s.id === slide.id);
    return { deck: next, current: pos, reply: tx("{slide} に「{title}」を足しました。中身は画面の上で直接書き込めます。", "Added \"{title}\" as {slide}. You can type the content right on the slide.", { slide: no(pos), title: slide.title }) };
  }

  return {
    reply: tx(
      "議事録や文章を貼ると、そこから組み直します。ほかに、こんな頼み方ができます。\n・「最後に、最初の食卓の計画を1枚足して」\n・「このページを比較にして」\n・「6枚にまとめて」\n・「結論から先に並べ直して」\n・「赤入れして」",
      "Paste meeting notes or a draft and I'll build the deck from it. You can also ask things like:\n・\"Add a slide about the first dinner plan at the end\"\n・\"Make this page a comparison\"\n・\"Condense to 6 slides\"\n・\"Reorder answer first\"\n・\"Review this deck\"",
    ),
  };
}
