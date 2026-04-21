import type { Ticket, TicketNode } from './types';

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();

// ============================================
// File / folder tree
// ============================================
export const MOCK_NODES: TicketNode[] = [
  // Root folders
  { id: 'fd-rfps',        type: 'folder', name: 'RFPs',             icon: '📄', parentId: null },
  { id: 'fd-internal',    type: 'folder', name: '社内案件',          icon: '🏢', parentId: null },
  { id: 'fd-memos',       type: 'folder', name: 'メモ',              icon: '📝', parentId: null },

  // Files under RFPs
  { id: 'file-rfp-aws',   type: 'file',   name: 'AWS 保守 — 顧客X',  parentId: 'fd-rfps' },
  { id: 'file-rfp-gcp',   type: 'file',   name: 'GCP 移行 — 顧客Y',  parentId: 'fd-rfps' },

  // Files under 社内案件
  { id: 'file-feature-q2', type: 'file',  name: 'Q2 新機能企画',     parentId: 'fd-internal' },

  // Files under メモ
  { id: 'file-weekly',    type: 'file',   name: '週次ふりかえり',     parentId: 'fd-memos' },
];

export const DEFAULT_FILE_ID = 'file-rfp-aws';

// ============================================
// Tickets (keyed by fileId)
// ============================================
export const MOCK_TICKETS: Ticket[] = [
  // --- file-rfp-aws ---
  {
    id: 'tk-1',
    fileId: 'file-rfp-aws',
    title: 'RFP 要件整理',
    content: JSON.stringify([
      { type: 'heading', props: { level: 2 }, content: '概要' },
      { type: 'paragraph', content: '顧客X社のAWS保守RFPを精読。要点は以下の通り。' },
      { type: 'heading', props: { level: 3 }, content: '必須要件' },
      { type: 'bulletListItem', content: 'SLA 99.9% (月間稼働率)' },
      { type: 'bulletListItem', content: '24/7 一次対応 (15分以内応答)' },
      { type: 'bulletListItem', content: '月次レポート提出' },
      { type: 'heading', props: { level: 3 }, content: 'ToDo' },
      { type: 'checkListItem', content: 'SLA条項のレビュー' },
      { type: 'checkListItem', props: { checked: true }, content: '初回ミーティング設定' },
      { type: 'checkListItem', content: '概算見積提示 (今週中)' },
    ]),
    color: 'blue',
    x: 60, y: 120, width: 280, height: 160,
    createdBy: 'Noa',
    createdAt: minutesAgo(180),
    updatedAt: minutesAgo(22),
    activity: [
      { id: 'a1', kind: 'created', actor: 'Noa', actorKind: 'human', message: 'Ticket created', createdAt: minutesAgo(180) },
      { id: 'a2', kind: 'comment', actor: 'Claude', actorKind: 'ai_agent', message: 'SLA項目を抽出しました', createdAt: minutesAgo(120) },
      { id: 'a3', kind: 'edit', actor: 'Noa', actorKind: 'human', message: 'content updated', createdAt: minutesAgo(22) },
    ],
  },
  {
    id: 'tk-2',
    fileId: 'file-rfp-aws',
    title: '懸念点: DR構成未定',
    content: 'RFPに復旧目標 (RPO/RTO) の記載なし。ヒアリング必要。Multi-AZ前提かMulti-Regionか。',
    color: 'rose',
    x: 400, y: 100, width: 280, height: 170,
    createdBy: 'Noa',
    createdAt: minutesAgo(140),
    updatedAt: minutesAgo(140),
    activity: [
      { id: 'a4', kind: 'created', actor: 'Claude', actorKind: 'ai_agent', message: 'AIが抽出した懸念点', createdAt: minutesAgo(140) },
    ],
  },
  {
    id: 'tk-3',
    fileId: 'file-rfp-aws',
    title: 'CloudWatch 閾値設計',
    content: JSON.stringify([
      { type: 'paragraph', content: '初期値は下記。環境別チューニングは本番投入後に調整。' },
      { type: 'heading', props: { level: 3 }, content: '閾値一覧' },
      { type: 'bulletListItem', content: 'CPU > 80% (5分継続)' },
      { type: 'bulletListItem', content: 'Memory > 85%' },
      { type: 'bulletListItem', content: '5xx rate > 1%' },
      { type: 'bulletListItem', content: 'Disk > 75%' },
      { type: 'quote', content: 'Disk閾値は80%で調整予定 — Noa' },
    ]),
    color: 'emerald',
    x: 740, y: 140, width: 280, height: 170,
    createdBy: 'Claude',
    createdAt: minutesAgo(90),
    updatedAt: minutesAgo(30),
    activity: [
      { id: 'a5', kind: 'ai_action', actor: 'Claude', actorKind: 'ai_agent', message: 'CloudWatch設計案を生成', createdAt: minutesAgo(90) },
      { id: 'a6', kind: 'comment', actor: 'Noa', actorKind: 'human', message: 'Disk閾値は80%でいきたい', createdAt: minutesAgo(30) },
    ],
  },
  {
    id: 'tk-4',
    fileId: 'file-rfp-aws',
    title: '月次レポート雛形',
    content: 'SLA達成率 / インシデント件数 / 変更件数 / 改善提案3件 を基本フォーマットに。',
    color: 'amber',
    x: 60, y: 330, width: 280, height: 150,
    createdBy: 'Noa',
    createdAt: minutesAgo(60),
    updatedAt: minutesAgo(60),
    activity: [
      { id: 'a7', kind: 'created', actor: 'Noa', actorKind: 'human', message: 'Ticket created', createdAt: minutesAgo(60) },
    ],
  },
  {
    id: 'tk-5',
    fileId: 'file-rfp-aws',
    title: '運用体制',
    content: '一次: 社内SRE 2名ローテ / 二次: 専門ベンダ契約 / エスカレ: CTO直。',
    color: 'violet',
    x: 400, y: 320, width: 280, height: 150,
    createdBy: 'Noa',
    createdAt: minutesAgo(50),
    updatedAt: minutesAgo(50),
    activity: [
      { id: 'a8', kind: 'created', actor: 'Noa', actorKind: 'human', message: 'Ticket created', createdAt: minutesAgo(50) },
    ],
  },
  {
    id: 'tk-6',
    fileId: 'file-rfp-aws',
    title: 'メモ: コスト見積',
    content: '保守人件費 + ツール(Datadog/PagerDuty) + 予備工数。ベンダ見積待ち。',
    color: 'neutral',
    x: 740, y: 360, width: 280, height: 130,
    createdBy: 'Noa',
    createdAt: minutesAgo(20),
    updatedAt: minutesAgo(20),
    activity: [
      { id: 'a9', kind: 'created', actor: 'Noa', actorKind: 'human', message: 'Ticket created', createdAt: minutesAgo(20) },
    ],
  },

  // --- file-rfp-gcp ---
  {
    id: 'tk-gcp-1',
    fileId: 'file-rfp-gcp',
    title: '移行スコープ',
    content: 'オンプレDB → Cloud SQL / 社内API → Cloud Run。段階移行で3ヶ月想定。',
    color: 'blue',
    x: 80, y: 140, width: 280, height: 160,
    createdBy: 'Noa',
    createdAt: minutesAgo(240),
    updatedAt: minutesAgo(240),
    activity: [
      { id: 'g1', kind: 'created', actor: 'Noa', actorKind: 'human', message: 'Ticket created', createdAt: minutesAgo(240) },
    ],
  },
  {
    id: 'tk-gcp-2',
    fileId: 'file-rfp-gcp',
    title: 'コスト試算',
    content: '現行ランニング 月120万 → GCP移行後 月80〜90万想定。',
    color: 'emerald',
    x: 420, y: 160, width: 280, height: 140,
    createdBy: 'Claude',
    createdAt: minutesAgo(200),
    updatedAt: minutesAgo(200),
    activity: [
      { id: 'g2', kind: 'ai_action', actor: 'Claude', actorKind: 'ai_agent', message: 'GCPコスト試算を生成', createdAt: minutesAgo(200) },
    ],
  },

  // --- file-feature-q2 ---
  {
    id: 'tk-fq2-1',
    fileId: 'file-feature-q2',
    title: 'AIエージェント統合',
    content: 'Ticket → Object/Element 自動分解。承認フロー必須。',
    color: 'violet',
    x: 80, y: 140, width: 280, height: 150,
    createdBy: 'Noa',
    createdAt: minutesAgo(300),
    updatedAt: minutesAgo(45),
    activity: [
      { id: 'q1', kind: 'created', actor: 'Noa', actorKind: 'human', message: 'Ticket created', createdAt: minutesAgo(300) },
      { id: 'q2', kind: 'comment', actor: 'Noa', actorKind: 'human', message: 'Claude Agent SDK採用方針', createdAt: minutesAgo(45) },
    ],
  },

  // --- file-weekly ---
  {
    id: 'tk-w-1',
    fileId: 'file-weekly',
    title: '今週のふりかえり',
    content: 'Ticket機能のプロトタイプ完了。次週DB永続化。',
    color: 'neutral',
    x: 80, y: 140, width: 280, height: 130,
    createdBy: 'Noa',
    createdAt: minutesAgo(10),
    updatedAt: minutesAgo(10),
    activity: [
      { id: 'w1', kind: 'created', actor: 'Noa', actorKind: 'human', message: 'Ticket created', createdAt: minutesAgo(10) },
    ],
  },
];
