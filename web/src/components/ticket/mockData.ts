import type { Ticket, TicketNode } from './types';

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000).toISOString();

// ============================================
// File / folder tree (sidebar)
// ============================================
export const MOCK_NODES: TicketNode[] = [
  { id: 'fd-rfps',         type: 'folder', name: 'RFPs',            parentId: null },
  { id: 'fd-internal',     type: 'folder', name: '社内案件',         parentId: null },
  { id: 'fd-memos',        type: 'folder', name: 'メモ',             parentId: null },

  { id: 'file-rfp-aws',    type: 'file',   name: 'AWS 保守 — 顧客X', parentId: 'fd-rfps' },
  { id: 'file-rfp-gcp',    type: 'file',   name: 'GCP 移行 — 顧客Y', parentId: 'fd-rfps' },
  { id: 'file-feature-q2', type: 'file',   name: 'Q2 新機能企画',    parentId: 'fd-internal' },
  { id: 'file-weekly',     type: 'file',   name: '週次ふりかえり',   parentId: 'fd-memos' },
];

export const DEFAULT_FILE_ID = 'file-rfp-aws';

// ============================================
// Page contents (BlockNote JSON) keyed by file id
// ============================================
export const MOCK_FILE_CONTENTS: Record<string, string> = {
  'file-rfp-aws': JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: '概要' },
    { type: 'paragraph', content: '顧客X社のAWS保守RFPを精読。要点は以下の通り。' },

    { type: 'heading', props: { level: 3 }, content: '必須要件' },
    { type: 'bulletListItem', content: 'SLA 99.9% (月間稼働率)' },
    { type: 'bulletListItem', content: '24/7 一次対応 (15分以内応答)' },
    { type: 'bulletListItem', content: '月次レポート提出' },

    { type: 'heading', props: { level: 3 }, content: '懸念点' },
    { type: 'paragraph', content: 'RFPに復旧目標 (RPO/RTO) の記載なし。ヒアリング必要。Multi-AZ前提かMulti-Regionか。' },

    { type: 'heading', props: { level: 3 }, content: 'ToDo' },
    { type: 'checkListItem', props: { checked: true }, content: '初回ミーティング設定' },
    { type: 'checkListItem', content: 'SLA条項のレビュー' },
    { type: 'checkListItem', content: '概算見積提示 (今週中)' },

    { type: 'heading', props: { level: 3 }, content: 'CloudWatch 閾値設計案' },
    { type: 'bulletListItem', content: 'CPU > 80% (5分継続)' },
    { type: 'bulletListItem', content: 'Memory > 85%' },
    { type: 'bulletListItem', content: '5xx rate > 1%' },
    { type: 'bulletListItem', content: 'Disk > 75%' },
    { type: 'quote', content: 'Disk閾値は80%で調整予定 — Noa' },
  ]),

  'file-rfp-gcp': JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: 'GCP 移行 — 顧客Y' },
    { type: 'paragraph', content: 'オンプレDB → Cloud SQL / 社内API → Cloud Run。段階移行で3ヶ月想定。' },
    { type: 'heading', props: { level: 3 }, content: 'コスト試算' },
    { type: 'paragraph', content: '現行ランニング 月120万 → GCP移行後 月80〜90万想定。' },
  ]),

  'file-feature-q2': JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: 'Q2 新機能企画' },
    { type: 'bulletListItem', content: 'AIエージェント統合 (Notes → Object/Element 自動分解)' },
    { type: 'bulletListItem', content: 'Notion風ブロックエディタの定着' },
    { type: 'bulletListItem', content: 'Claude Agent SDK採用方針' },
  ]),

  'file-weekly': JSON.stringify([
    { type: 'heading', props: { level: 2 }, content: '今週のふりかえり' },
    { type: 'paragraph', content: 'Notion風ページの土台を実装。次週 DB 永続化。' },
  ]),
};

// ============================================
// Tickets — summarized snapshots from Notes
// ============================================
export const MOCK_TICKETS: Ticket[] = [
  {
    id: 'tk-1',
    sourceFileId: 'file-rfp-aws',
    sourceFileName: 'AWS 保守 — 顧客X',
    title: 'AWS保守RFP 必須要件サマリ',
    summary: 'SLA 99.9%、24/7 一次対応 (15分以内応答)、月次レポート提出。DR構成は未定でヒアリング要。',
    createdBy: 'Noa',
    createdAt: minutesAgo(90),
  },
  {
    id: 'tk-2',
    sourceFileId: 'file-rfp-gcp',
    sourceFileName: 'GCP 移行 — 顧客Y',
    title: 'GCP移行コスト試算',
    summary: '現行ランニング月120万 → GCP移行後 月80〜90万想定。段階移行3ヶ月計画。',
    createdBy: 'Claude',
    createdAt: minutesAgo(40),
  },
];
