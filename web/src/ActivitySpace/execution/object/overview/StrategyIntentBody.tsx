'use client';

import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { StrategyWithObjects } from '@/types/database';
import { NavStrategyIcon } from '@/shell/sidebar/NavIcons';
import { extractStrategyIntent } from './strategyIntent';

/**
 * "Initiative intent" — the Strategy half of the round trip, seen from Execution.
 *
 * Body only: the card around it is the widget frame (`Function/widget`), so this
 * renders rows and nothing else.
 *
 * The Properties rail already names the Initiative(s) this Object contributes to,
 * which answers *where* it belongs but not *why it exists*. That "why" is
 * written in the Initiative's description — the win condition and the success
 * criteria — and until now it lived only on the Strategy surface. An Object
 * could be opened, worked and closed without its intent ever being in view.
 *
 * So the card carries the intent down to the Execution side, excerpted by
 * {@link extractStrategyIntent}, and keeps the one-click trip back up: the
 * Initiative name is the same navigation target the Properties row offers.
 *
 * A Initiative that has stated no intent says so rather than being hidden. Three
 * of the four Initiatives in the database have an empty description, and an
 * Object silently showing nothing would read as "there is no strategy here"
 * instead of "nobody has written it down" — which is the fact worth acting on.
 */
export function StrategyIntentBody({
  strategies,
  onOpenStrategy,
}: {
  /** The Initiatives this Object contributes to, in the order the rail lists them. */
  strategies: StrategyWithObjects[];
  /** Open a Initiative on the Strategy surface. */
  onOpenStrategy: (strategyId: string) => void;
}) {
  const entries = useMemo(
    () => strategies.map((s) => ({ strategy: s, sections: extractStrategyIntent(s.description) })),
    [strategies],
  );

  return (
    <>
      {entries.map(({ strategy, sections }, idx) => (
        <div key={strategy.id}>
          {/* An Object can contribute to more than one Initiative, so separate
              them the way the Properties card separates its groups — a hairline
              rule, not a heading per Initiative. */}
          {idx > 0 && <div className="h-px bg-border/50 mx-2 my-2" />}

          <button
            type="button"
            onClick={() => onOpenStrategy(strategy.id)}
            className="group w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left hover:bg-muted/40 focus-visible:bg-muted/40 transition-colors"
          >
            <span className="shrink-0 flex items-center justify-center min-w-4 opacity-90">
              <NavStrategyIcon size={12} className="text-muted-foreground" />
            </span>
            <span className="flex-1 min-w-0 truncate text-[11px] font-semibold text-foreground/90">
              {strategy.name}
            </span>
            <ChevronRight
              size={12}
              className="shrink-0 text-muted-foreground/40 group-hover:text-foreground transition-colors"
            />
          </button>

          {sections.length === 0 ? (
            <p className="px-2 pb-1.5 text-[11px] leading-5 text-muted-foreground">
              No stated intent yet.
            </p>
          ) : (
            <div className="px-2 pb-1.5 space-y-1.5">
              {sections.map((section, i) => (
                <div key={section.heading ?? `lead-${i}`}>
                  {/* The lead paragraph has no heading of its own — it is the
                      Initiative's own opening sentence, so it stands unlabelled. */}
                  {section.heading && (
                    <div className="text-[11px] font-semibold text-muted-foreground truncate">
                      {section.heading}
                    </div>
                  )}
                  {/* One item is a paragraph; several are the bullets the
                      author wrote, kept as a list so `Ends` reads as two
                      distinct aims rather than one run-on sentence. Each is
                      clamped rather than truncated in the excerpt itself, so a
                      cut lands on a line boundary and the full text stays one
                      click away on the Initiative. */}
                  {section.items.length === 1 ? (
                    <p className="text-[11px] leading-5 text-foreground/80 line-clamp-3 break-words">
                      {section.items[0]}
                    </p>
                  ) : (
                    <ul className="space-y-0.5">
                      {section.items.map((item, j) => (
                        <li
                          key={j}
                          className="flex gap-1.5 text-[11px] leading-5 text-foreground/80"
                        >
                          <span aria-hidden className="shrink-0 text-muted-foreground/60">
                            •
                          </span>
                          <span className="min-w-0 line-clamp-2 break-words">{item}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
