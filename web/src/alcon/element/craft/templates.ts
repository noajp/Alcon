// Built-in craft templates split by format. Used in the workspace empty
// state as quick-start "skill modules" (open-codesign nomenclature).

import type { CraftFormat } from './types';

export interface CraftTemplate {
  id: string;
  label: string;
  emoji: string;
  /** Sent to the model as the user's first message. */
  prompt: string;
}

export const PRESENTATION_TEMPLATES: CraftTemplate[] = [
  {
    id: 'pitch',
    label: 'Pitch deck',
    emoji: '🚀',
    prompt:
      'この Element の内容で 6 枚のピッチデッキを作って。表紙 / 課題 / ソリューション / 市場規模 / マイルストーン / クロージング の構成。背景は黒基調、アクセントは深いブルー。',
  },
  {
    id: 'agenda',
    label: 'Meeting agenda',
    emoji: '🗓️',
    prompt:
      '会議アジェンダを 3 枚で作って。1) 表紙(目的と参加者) 2) 議題リスト 3) 決定事項テンプレ。落ち着いたモノトーン。',
  },
  {
    id: 'sales',
    label: 'Sales deck',
    emoji: '💼',
    prompt:
      'この Element の内容で営業資料を 5 枚作って。1) 表紙 2) お客様の課題 3) 提供価値 4) 導入ステップ 5) 価格と次のアクション。コーポレートな配色。',
  },
  {
    id: 'kpi',
    label: 'KPI report',
    emoji: '📊',
    prompt:
      'KPI ダッシュボード風のスライドを 3 枚作って。1) サマリー数値 (大きな数字 + 増減%) 2) トレンドの説明 3) アクション。落ち着いた配色 + 1 色のアクセント。',
  },
  {
    id: 'roadmap',
    label: 'Roadmap',
    emoji: '🛣️',
    prompt:
      'ロードマップを 1 枚 (横長フェーズ図) で作って。Now / Next / Later の 3 列、各列にカード 3 つ。優先度の色分けあり。',
  },
  {
    id: 'compare',
    label: 'Comparison',
    emoji: '⚖️',
    prompt:
      'A 案 vs B 案の比較スライドを 1 枚作って。左右 2 カラム、行は機能 / 価格 / リスク / 推奨度。差分セルにハイライト。',
  },
  {
    id: 'closing',
    label: 'Thank-you',
    emoji: '🙏',
    prompt:
      'クロージングのサンキュースライドを 1 枚作って。中央に大きな "Thank you"、下に連絡先プレースホルダ。グラデーション背景。',
  },
];

export const DOCUMENTATION_TEMPLATES: CraftTemplate[] = [
  {
    id: 'one-pager',
    label: 'One-pager',
    emoji: '📄',
    prompt:
      'この Element の概要をまとめた 1 ページのドキュメントを作って。冒頭にヒーロー、続いて Overview / Goals / Scope / Risks / Next steps の見出しで本文を構成。',
  },
  {
    id: 'project-brief',
    label: 'Project brief',
    emoji: '📋',
    prompt:
      'プロジェクトブリーフのテンプレドキュメントを作って。背景 / 目的 / KPI / スコープ / マイルストーン / リスク / 関係者 の各セクション。',
  },
  {
    id: 'meeting-notes',
    label: 'Meeting notes',
    emoji: '📝',
    prompt:
      '会議議事録のドキュメントを作って。日時 / 参加者 / アジェンダ / 議論サマリ / 決定事項 / アクションアイテム の構成。',
  },
  {
    id: 'spec',
    label: 'Spec doc',
    emoji: '🛠️',
    prompt:
      'プロダクト仕様書のドキュメントを作って。Problem / Users / Solution / UX flow / Edge cases / Open questions の構成。',
  },
  {
    id: 'report',
    label: 'Report',
    emoji: '📈',
    prompt:
      '進捗レポートのドキュメントを作って。冒頭にサマリ、続いて KPI ハイライト / 進捗 / リスク / 次のアクション。数値はカードで強調。',
  },
  {
    id: 'wiki',
    label: 'Wiki page',
    emoji: '📚',
    prompt:
      '社内 wiki ページとして 1 ページのドキュメントを作って。冒頭に目次、見出し階層を持った本文、最後に "関連リンク" セクション。',
  },
  {
    id: 'rfc',
    label: 'RFC / Proposal',
    emoji: '🧠',
    prompt:
      'RFC (技術提案) ドキュメントを作って。Summary / Motivation / Detailed design / Drawbacks / Alternatives / Unresolved の構成で、本文は読みやすく長めに。',
  },
];

export function templatesFor(format: CraftFormat): CraftTemplate[] {
  return format === 'documentation' ? DOCUMENTATION_TEMPLATES : PRESENTATION_TEMPLATES;
}
