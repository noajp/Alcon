"use client";

import { looksLikeDocument, respondLocally } from "@/ActivitySpace/sustainment/slides/kata/model/chat";
import { intakeDocument, looksLikeLongDocument } from "@/ActivitySpace/sustainment/slides/kata/model/intake";
import { useKata } from "@/ActivitySpace/sustainment/slides/kata/store/useKata";
import { supabase } from "@/lib/supabase";
import { buildContent, normalizeSlide } from "@/ActivitySpace/sustainment/slides/kata/model/layouts";
import type { LayoutId, Slide, StorylineId } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { getLang } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import { tx } from "@/ActivitySpace/sustainment/slides/kata/i18n";

type AiSlide = { title: string; layout: LayoutId; source: string | null } & Record<string, unknown>;
type AiReply = { reply?: string; storyline?: StorylineId; slides?: AiSlide[]; current?: number; error?: string };

/** Claude through Alcon's slides-chat function; null when it is unavailable, so the local planner answers. */
async function askClaude(body: Record<string, unknown>): Promise<AiReply | null> {
  try {
    const { data, error } = await supabase.functions.invoke('slides-chat', { body });
    if (error || !data || (data as AiReply).error) return null;
    return data as AiReply;
  } catch {
    return null;
  }
}

/** The function returns slides in its schema; the editor's parts make them pages. */
function toSlide(s: AiSlide, i: number): Slide {
  const layout = s.layout;
  const content = s[layout] ? { [layout]: s[layout] } : buildContent(layout, []);
  return normalizeSlide({ id: `s_ai_${Date.now().toString(36)}_${i}`, title: s.title, layout, source: s.source ?? undefined, content } as Slide);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** チャットに送る。API キーがあれば Claude に、無ければ手元のプランナーに渡す */
export async function sendToKata(text: string, attachment?: { name: string; body: string }) {
  // PDF から写した長い文（行が折れ、ページ番号が混ざる）は、見出しのある文章に直してから扱う
  if (!attachment && looksLikeLongDocument(text)) text = intakeDocument(text).markdown;
  const st = useKata.getState();
  const file = st.files.find((f) => f.id === st.activeFileId);
  if (!file || st.busy) return;
  // 貼った文書の最後の短い一文は、本文ではなく頼み（「12枚で」など）として扱う
  let pastedAsk = "";
  // 長い貼り付けは全文を吹き出しにせず、文書のカードにする。末尾の短い一文は依頼として残す
  if (!attachment && looksLikeDocument(text)) {
    const lines = text.trimEnd().split("\n");
    const last = lines[lines.length - 1].trim();
    const ask = last.length <= 60 && !/^[#|\-*]/.test(last) && lines.length > 3 ? last : "";
    pastedAsk = ask;
    const firstLine = lines.find((l) => l.trim())?.replace(/^#+\s*/, "").slice(0, 28) ?? tx("貼り付けた文書", "Pasted document");
    st.pushMessage({ from: "me", text: ask, attachment: tx("{title}（{n}字）", "{title} ({n} chars)", { title: firstLine, n: text.length.toLocaleString() }) });
  } else {
    st.pushMessage({ from: "me", text, attachment: attachment?.name });
  }
  st.setBusy(true);
  const input = attachment ? `${attachment.body}\n\n${text}`.trim() : text;
  try {
    let result: { deck?: typeof file.deck; current?: number; reply: string } | null = null;
    const ai = await askClaude({ deck: { ...file.deck, slides: file.deck.slides.map(({ objects, styles, ...x }) => (void objects, void styles, x)) }, current: st.current, text: input, skills: st.skills.filter((k) => k.enabled), lang: getLang() });
    if (ai) {
      const slides = (ai.slides ?? []).map(toSlide);
      result = slides.length
        ? { reply: ai.reply ?? '', deck: { title: slides[0].title || file.deck.title, storyline: ai.storyline ?? file.deck.storyline, slides }, current: Math.max(0, Math.min(slides.length - 1, ai.current ?? 0)) }
        : { reply: ai.reply ?? '' };
    }
    if (!result) {
      await wait(420);
      // 添えた文書と頼みは分けて渡す（頼みの一文が本文のページにならないように）
      // 頼みは1行の印にする（改行や「-->」が本文に漏れないように）
      const askLine = (t: string) => (t.trim() ? `\n\n<!-- ask: ${t.replace(/-->/g, "").replace(/\s+/g, " ").trim()} -->` : "");
      const local = attachment ? `${attachment.body}${askLine(text)}` : pastedAsk ? `${text}${askLine(pastedAsk)}` : input; // 本文はそのまま残す（最後の一文が本文の一部のこともある）
      result = respondLocally(file.deck, st.current, local, useKata.getState().skills);
    }
    const now = useKata.getState();
    const latest = now.files.find((f) => f.id === file.id);
    if (!latest) return;
    // 待っている間に手でデッキを直していたら、上書きしない
    if (result.deck && latest.deck !== file.deck) {
      now.applyReply(file.id, { text: tx("返事を待つあいだにデッキが手で直されたので、上書きしませんでした。もう一度送ってください。", "The deck was edited while waiting for the reply, so nothing was overwritten. Please send again.") });
      return;
    }
    // 文章から組み直したときは、元の文章をデッキに付けて出どころを開けるようにする。
    // 指示で直しただけなら、前の元の文章を引き継ぐ
    const isDoc = !!attachment || looksLikeDocument(text);
    // 組み直しでも、同じページに手で置いたもの・文字の上書き・使い方（話す／読む）は残す（新しい文書から組んだときは除く）
    const keepHand = (d: typeof file.deck) => {
      if (isDoc) return d;
      const prev = new Map(file.deck.slides.map((x) => [x.id, x]));
      return {
        ...d,
        mode: d.mode ?? file.deck.mode,
        slides: d.slides.map((x) => {
          const p = prev.get(x.id);
          return p && (p.objects?.length || p.styles) ? { ...x, objects: x.objects ?? p.objects, styles: x.styles ?? p.styles } : x;
        }),
      };
    };
    const deck = result.deck
      ? { ...keepHand(result.deck), sourceDoc: isDoc ? { name: attachment?.name ?? tx("貼り付けた文書", "Pasted document"), text: input } : (result.deck.sourceDoc ?? file.deck.sourceDoc) }
      : undefined;
    now.applyReply(file.id, { deck, text: result.reply || tx("（変更なし）", "(No changes)") });
    if (typeof result.current === "number" && now.activeFileId === file.id) now.setCurrent(result.current);
  } finally {
    useKata.getState().setBusy(false);
  }
}
