"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function IconButton({ label, children, className, active, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-k-ink-2 transition-colors hover:bg-k-hover hover:text-k-ink",
        active && "bg-k-selected text-k-ink",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
