// Built-in craft templates — "skill modules" inspired by open-codesign.
// Each template is a one-line preset prompt the user can fire from the
// workspace empty state. They expand to a detailed instruction so the
// model gets a useful seed even when the user hasn't written anything.

export interface CraftTemplate {
  id: string;
  label: string;
  emoji: string;
  /** Sent to the model as the user's first message. */
  prompt: string;
}

export const CRAFT_TEMPLATES: CraftTemplate[] = [
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
    id: 'lp-hero',
    label: 'LP hero',
    emoji: '🎯',
    prompt:
      'ランディングページのヒーロー + 特徴 3 つ + CTA を 1 枚 (フルブリード) で作って。鮮やかなグラデーション背景、白文字、コントラスト高め。',
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
    id: 'doc',
    label: 'One-pager',
    emoji: '📄',
    prompt:
      'この Element を 1 枚の概要ドキュメントにまとめて。左に箇条書きの要点、右にキーメトリクス。見出しは大きめ。',
  },
  {
    id: 'quote',
    label: 'Quote card',
    emoji: '💬',
    prompt:
      'インスピレーション系の引用カードを 1 枚作って。中央に大きな引用文、下に発言者と肩書き。深い色背景、セリフ書体寄りの font-family。',
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
