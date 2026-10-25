'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { designDocument, type DesignSource } from './model';

/**
 * One artboard, drawn at its own size and scaled down to the width it is
 * given — never up, never reflowed, so every viewer sees the same layout.
 *
 * The frame is sandboxed with one permission, `allow-same-origin`, so it can
 * load the app's fonts as the app does; it runs no script, submits no form
 * and navigates nowhere. (Same origin is only dangerous with scripts, which
 * the sandbox and the frame's own policy both refuse.) The policy loads only
 * the app's fonts and embedded data: images.
 */
export function DesignFrame({ design, label }: { design: DesignSource; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const html = useMemo(() => designDocument(design, window.location.origin), [design]);
  const scale = width ? Math.min(1, width / design.width) : 0;
  return (
    <div ref={box} className="w-full">
      <div className="relative overflow-hidden rounded-md" style={{ height: design.height * scale, opacity: scale ? 1 : 0 }}>
        <iframe
          title={label}
          srcDoc={html}
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          loading="lazy"
          className="absolute left-0 top-0 origin-top-left border-0"
          style={{ width: design.width, height: design.height, transform: `scale(${scale})` }}
        />
      </div>
    </div>
  );
}
