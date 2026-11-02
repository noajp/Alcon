'use client';

import { useState } from 'react';
import { Bot, Check, AlertTriangle, Loader2, Zap, ShieldCheck } from '@/ui/icons';
import { cn } from '@/lib/utils';
import { updateDomain, pingAgentRuntime } from '@/hooks/useSupabase';
import type { Domain, DomainAIConfig } from '@/hooks/useSupabase';
import { DOMAIN_AGENT_MODELS, DOMAIN_AGENT_TURNS, clampAgentTurns, domainAgentModel } from '@/Function/domain/domainAgentConfig';

type PingState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok' }
  | { status: 'missing' }
  | { status: 'error'; message: string };

// The Domain's "API Settings" screen — configures the autonomous agent for
// every Element in this Domain. The Anthropic API key itself is NOT entered
// here: it stays a server-side Edge Function secret (ANTHROPIC_API_KEY).
// "Test connection" verifies that secret is present.
export function DomainAgentSettings({
  domain,
  onSaved,
  canEdit = true,
}: {
  domain: Domain;
  onSaved?: () => void;
  /** False for a plain member: `domains` UPDATE is owner/admin-only, so the
   *  form shows the settings but every control is disabled. */
  canEdit?: boolean;
}) {
  const initial: DomainAIConfig = domain.ai_config ?? {};
  const [enabled, setEnabled] = useState(initial.enabled !== false);
  const [model, setModel] = useState(domainAgentModel(initial.model));
  const [maxTurns, setMaxTurns] = useState(String(initial.max_turns ?? DOMAIN_AGENT_TURNS.default));
  const [instructions, setInstructions] = useState(initial.instructions ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [ping, setPing] = useState<PingState>({ status: 'idle' });

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const turns = clampAgentTurns(maxTurns);
      const ai_config: DomainAIConfig = {
        enabled,
        model,
        max_turns: turns,
        instructions: instructions.trim() || undefined,
      };
      await updateDomain(domain.id, { ai_config });
      setMaxTurns(String(turns));
      setSaved(true);
      onSaved?.();
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setSaveError((e as { message?: string } | null)?.message || '不明なエラー');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setPing({ status: 'checking' });
    try {
      const res = await pingAgentRuntime();
      setPing({ status: res.ok && res.key_configured ? 'ok' : 'missing' });
    } catch (e) {
      setPing({ status: 'error', message: (e as Error).message });
    }
  };

  return (
    <fieldset disabled={!canEdit} className="rounded-lg border border-border/60 bg-card p-4 space-y-4 disabled:opacity-70">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Bot size={16} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-[13px] font-medium text-foreground">AI エージェント</h3>
          <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug">
            看板ボードや Element 詳細の「開始 ▶︎」を押すと、エージェントがこの設定で Element の任務を実行します。
          </p>
        </div>
      </div>

      {/* Enabled toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] text-foreground">エージェント実行を有効化</div>
          <div className="text-[11.5px] text-muted-foreground">無効にすると、この Domain では「開始 ▶︎」が動作しません。</div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
            enabled ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span
            className={cn(
              'inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform',
              enabled ? 'translate-x-[18px]' : 'translate-x-[3px]',
            )}
          />
        </button>
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium text-foreground">モデル</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="w-full text-[13px] bg-muted/40 rounded-md px-2.5 py-1.5 border border-border/60 focus:outline-none"
        >
          {DOMAIN_AGENT_MODELS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Max steps */}
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium text-foreground">最大ターン数</label>
        <input
          type="number"
          min={DOMAIN_AGENT_TURNS.min}
          max={DOMAIN_AGENT_TURNS.max}
          value={maxTurns}
          onChange={(e) => setMaxTurns(e.target.value)}
          className="w-24 text-[13px] bg-muted/40 rounded-md px-2.5 py-1.5 border border-border/60 focus:outline-none"
        />
        <p className="text-[11.5px] text-muted-foreground">1 回の実行でモデルを呼べる回数の上限（{DOMAIN_AGENT_TURNS.min}〜{DOMAIN_AGENT_TURNS.max}、既定 {DOMAIN_AGENT_TURNS.default}）。AI Worker に個別の上限があればそちらが優先されます。</p>
      </div>

      {/* Instructions */}
      <div className="space-y-1.5">
        <label className="text-[12px] font-medium text-foreground">エージェントへの追加指示（任意）</label>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="例: 成果物は必ず箇条書きで。社内用語『SEM』は Strategy Execution Manager の略。"
          rows={3}
          className="w-full text-[13px] bg-muted/40 rounded-md px-2.5 py-2 border border-border/60 focus:outline-none resize-none leading-snug"
        />
        <p className="text-[11.5px] text-muted-foreground">
          この Domain の Element すべてに適用される、エージェント共通のルール。AI Worker 個別の指示より先に渡されます。
        </p>
      </div>

      {/* API key — server-side secret */}
      <div className="rounded-lg bg-muted/40 border border-border/60 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <ShieldCheck size={14} className="text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[12px] text-foreground">Anthropic API キー</div>
            <p className="text-[11.5px] text-muted-foreground leading-snug mt-0.5">
              キーはサーバー側の Edge Function シークレット（<code className="text-[11px]">ANTHROPIC_API_KEY</code>）で安全に管理されています。ここには保存されません。
            </p>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={handleTest}
                disabled={ping.status === 'checking'}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] bg-card border border-border/60 hover:bg-accent transition-colors disabled:opacity-50"
              >
                {ping.status === 'checking' ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <Zap size={12} />
                )}
                接続テスト
              </button>
              {ping.status === 'ok' && (
                <span className="inline-flex items-center gap-1 text-[12px] text-emerald-500">
                  <Check size={13} /> キー設定済み・接続OK
                </span>
              )}
              {ping.status === 'missing' && (
                <span className="inline-flex items-center gap-1 text-[12px] text-amber-500">
                  <AlertTriangle size={13} /> サーバーにキーが未設定です
                </span>
              )}
              {ping.status === 'error' && (
                <span className="inline-flex items-center gap-1 text-[12px] text-rose-500">
                  <AlertTriangle size={13} /> 接続失敗
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[12px] font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : null}
          {saving ? '保存中…' : '設定を保存'}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-[12px] text-emerald-500">
            <Check size={13} /> 保存しました
          </span>
        )}
        {saveError && (
          <span role="alert" className="inline-flex items-center gap-1 text-[12px] text-destructive">
            <AlertTriangle size={13} /> 保存できませんでした: {saveError}
          </span>
        )}
      </div>
    </fieldset>
  );
}
