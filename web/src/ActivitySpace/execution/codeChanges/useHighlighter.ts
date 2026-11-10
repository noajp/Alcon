'use client';

import { useEffect, useState } from 'react';
import type { Highlight } from '@/Function/codeReview/syntax';

// The syntax highlighter for diffs, loaded the first time a diff is shown —
// it is the heaviest part of the review screen and nothing else needs it.

let loader: Promise<Highlight> | null = null;

function loadHighlighter(): Promise<Highlight> {
  loader ??= import('lowlight').then(({ createLowlight, common }) => {
    const lowlight = createLowlight(common);
    return (code: string, language: string) => lowlight.highlight(language, code);
  });
  return loader;
}

/** The highlighter once loaded; null until then, or if it failed to load
 *  (the diff then stays plain). */
export function useHighlighter(): Highlight | null {
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  useEffect(() => {
    let live = true;
    loadHighlighter().then((h) => { if (live) setHighlight(() => h); }).catch(() => { loader = null; });
    return () => { live = false; };
  }, []);
  return highlight;
}
