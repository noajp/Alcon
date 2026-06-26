'use client';

import { useState } from 'react';

/**
 * Full-screen first-run onboarding card (Linear "Create a workspace" shape).
 * Reused for the two empty states that otherwise dead-ended new users:
 *   - 0 ActivitySpaces → create your Space
 *   - a Space with 0 Domains → create your first Domain
 * One name field + a primary CTA; submit on Enter or click.
 */
export function OnboardingCreate({
  title,
  subtitle,
  label,
  placeholder,
  cta,
  onCreate,
}: {
  title: string;
  subtitle: string;
  label: string;
  placeholder: string;
  cta: string;
  onCreate: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next = name.trim();
    if (!next || busy) return;
    setBusy(true);
    try {
      await onCreate(next);
    } catch (e) {
      console.error('Onboarding create failed', e);
      setBusy(false); // leave the form usable on error; success unmounts us
    }
  };

  return (
    <div className="h-screen flex items-center justify-center bg-[var(--content-bg)] px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-[20px] font-semibold text-foreground tracking-tight">{title}</h1>
        <p className="text-center text-[13px] text-muted-foreground mt-1.5 mb-8">{subtitle}</p>

        <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">{label}</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void submit(); }
          }}
          placeholder={placeholder}
          className="w-full rounded-lg bg-card border border-border px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none"
        />

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!name.trim() || busy}
          className="mt-6 w-full rounded-lg bg-primary text-primary-foreground text-[14px] font-medium py-2.5 hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Creating…' : cta}
        </button>
      </div>
    </div>
  );
}
