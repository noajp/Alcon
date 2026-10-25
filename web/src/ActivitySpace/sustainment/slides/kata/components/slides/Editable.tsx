"use client";

import { createContext, useContext, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { getLang, tx, type Lang } from "@/ActivitySpace/sustainment/slides/kata/i18n";
import type { TextStyle } from "@/ActivitySpace/sustainment/slides/kata/model/types";
import { styleKey, textStyleCss } from "@/ActivitySpace/sustainment/slides/kata/model/objects";

export type EditFn = (path: (string | number)[], value: string) => void;

export const SlideEditContext = createContext<{
  editable: boolean;
  onEdit?: EditFn;
  /** 型の文字の見た目の上書き（パスごと） */
  styles?: Record<string, TextStyle>;
  /** 文字を選んだ（書式を変える対象にする） */
  onFocusText?: (key: string, size: number) => void;
  /** このスライドの言語。スライドに刷る決まり文句（お願いしたいこと など）はこれに合わせる */
  lang?: Lang;
}>({ editable: false });

/** スライドに刷る決まり文句を、資料の言語で選ぶ */
export function useSlideTx() {
  const { lang } = useContext(SlideEditContext);
  return (ja: string, en: string) => ((lang ?? getLang()) === "ja" ? ja : en);
}

interface EdProps {
  value: string;
  path: (string | number)[];
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  multiline?: boolean;
  as?: "div" | "span" | "h1" | "p";
}

/** スライドの中の文字。編集できる画面ではその場で書き換えられる */
export function Ed({ value, path, className, style, placeholder = tx("ここに入力", "Type here"), multiline = false, as = "div" }: EdProps) {
  const { editable, onEdit, styles, onFocusText } = useContext(SlideEditContext);
  const ref = useRef<HTMLElement>(null);
  const Tag = as;
  const key = styleKey(path);
  const over = styles?.[key];
  if (over) style = { ...style, ...textStyleCss(over) };
  if (!editable) {
    return (
      <Tag className={className} style={style}>
        {value}
      </Tag>
    );
  }
  const commit = () => {
    const raw = (ref.current?.innerText ?? "").replace(/\n+$/, "");
    const text = multiline ? raw : raw.replace(/\n/g, " ");
    // 表示を保存する値にそろえる（貼り付けた改行などが画面にだけ残らないように）
    if (ref.current && ref.current.innerText !== text) ref.current.innerText = text;
    if (text !== value) onEdit?.(path, text);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey && !multiline) {
      e.preventDefault();
      (e.currentTarget as HTMLElement).blur();
    }
    if (e.key === "Escape") {
      if (ref.current) ref.current.innerText = value;
      (e.currentTarget as HTMLElement).blur();
    }
  };
  return (
    <Tag
      key={value}
      ref={ref as never}
      className={className}
      style={style}
      data-edit="true"
      data-style-key={key}
      data-placeholder={placeholder}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={commit}
      onFocus={(e) => onFocusText?.(key, parseFloat(getComputedStyle(e.currentTarget).fontSize) || 24)}
      onKeyDown={onKeyDown}
    >
      {value}
    </Tag>
  );
}
