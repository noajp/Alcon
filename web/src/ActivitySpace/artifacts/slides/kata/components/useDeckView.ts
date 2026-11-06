"use client";

import { useMemo } from "react";
import { deckLang, effectiveRoles } from "@/ActivitySpace/artifacts/slides/kata/model/deck";
import { mixTokens } from "@/ActivitySpace/artifacts/slides/kata/theme/mix";
import { useActiveFile, useKata, useLookMap } from "@/ActivitySpace/artifacts/slides/kata/store/useKata";

export function useDeckView() {
  const file = useActiveFile();
  const current = useKata((s) => s.current);
  const looks = useLookMap();
  const preview = useKata((s) => s.previewLook);
  return useMemo(() => {
    if (!file) return null;
    const deck = file.deck;
    const roles = effectiveRoles(deck);
    const tokens = preview && looks[preview] ? looks[preview].tokens : mixTokens(file.mix, looks);
    const index = Math.max(0, Math.min(current, deck.slides.length - 1));
    // 資料の言語：スライドに刷る決まり文句はこれで選ぶ（中身の無いページでも資料全体に合わせる）
    const lang = deckLang(deck);
    return { file, deck, roles, tokens, index, slide: deck.slides[index], looks, lang };
  }, [file, current, looks, preview]);
}
