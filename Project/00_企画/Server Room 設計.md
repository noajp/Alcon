# Server Room 設計

Alcon に Discord 風の **Server Room** を導入するための設計メモ。Phase 1 は最小スコープで、メッセージ送受信・通話・スレッド・ミーティング等は後続フェーズで扱う。

## コンセプト

- **1 System = 1 Server**。System Switcher がそのまま Server Switcher を兼ねる。
- Server 内には **Channel のみ**（カテゴリ階層なし）。
- Channel 種別は **`text` / `voice` の2つだけ**。
- サイドバーの「Text channels / Voice channels」は `kind` で絞り込むだけのセクション見出し（DB 上のカテゴリではない）。

参考画面：noa's server スタイルの最小サイドバー

```
[noa's server ▾]                 [invite]
🗓 Events                        (placeholder)
🛡 Server Boosts                 (placeholder)
─────────────
Text channels ▾                  +
  #  general
Voice channels ▾                 +
  🔊 Voice
```

## スコープ

### 含む（Phase 1）
- Server レコード（System に対して 1:1）
- Channel CRUD（text / voice）
- サイドバー UI（Server Switcher / Channel リスト / セクション折りたたみ）
- Channel 選択 → メイン領域にプレースホルダ表示
- RLS（同 System の Worker のみアクセス）

### 含まない（後続フェーズ）
- メッセージ・添付・リアクション・メンション・既読
- Realtime 配信
- スレッド / フォーラム / ミーティング
- 通話（LiveKit 連携）
- Events / Server Boosts の実機能
- Channel の private 化、`channel_members` 管理
- Object との紐付け（`channels.object_id`）

## DB

```sql
-- 1:1 だが将来の拡張余地のため systems から分離
servers (
  id                  uuid pk,
  system_id           uuid unique references systems(id) on delete cascade,
  default_channel_id  uuid references channels(id),
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
)

channels (
  id          uuid pk,
  server_id   uuid references servers(id) on delete cascade,
  kind        text not null check (kind in ('text','voice')),
  name        text not null,
  topic       text,
  position    int default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
)
```

### RLS 方針
- `servers`: 同じ System に属する Worker のみ select。Owner のみ update/delete。
- `channels`: server の System に属する Worker のみ select。System の admin role のみ insert/update/delete。
- 詳細ポリシーは migration 作成時に確定する。

### 後続で追加予定（このフェーズでは作らない）
- `channel_members (channel_id, worker_id, role, last_read_at)` — private channel 用
- `messages`, `message_reactions`, `message_attachments`, `mentions`
- `voice_sessions`, `voice_participants`

## UI（`web/src/views/server/`）

```
ServerView.tsx                     -- activeView==='server' のときのルート
ServerSidebar.tsx                  -- 左ペイン全体
  ServerHeader.tsx                 -- "noa's server ▾" + invite icon
  EventsRowPlaceholder.tsx
  BoostsRowPlaceholder.tsx
  ChannelSection.tsx               -- "Text channels ▾  +" / "Voice channels ▾  +"
    ChannelRow.tsx                 -- # or 🔊 + name
ServerMain.tsx                     -- 選択中チャンネルのコンテナ
  ChannelHeader.tsx                -- name / topic
  TextChannelPlaceholder.tsx       -- 「ここにメッセージ UI が入る」
  VoiceChannelPlaceholder.tsx      -- 「LiveKit 接続予定」
ServerSettingsModal.tsx            -- Channel CRUD（最小: name / kind / topic / 並べ替え）
```

### ナビゲーション
- `ICON_BAR_LAYERS` に `Server` 段を追加：
  ```ts
  { label: 'Server', items: [{ id: 'server', icon: NavServerIcon, label: 'Server Room' }] }
  ```
- `Hub` は inbox / integrations 用にそのまま残す（Server Room には統合しない）。
- `NavigationState` に `serverChannelId?: string | null` を追加。

## マッピング（Discord → Alcon）

| Discord | Alcon |
|---|---|
| Server | **System**（1:1 で `servers` を持つ） |
| Channel (#text / 🔊voice) | `channels`（kind で区別） |
| Member | **Worker**（既存） |
| Server Switcher | **System Switcher**（既存、流用） |
| Category | （持たない） |
| Thread / Forum / Stage / Event | （Phase 1 では持たない） |

## ロードマップ

| Phase | 内容 |
|---|---|
| **1a** | DB migration（`servers` / `channels`）+ RLS |
| **1b** | UI スケルトン（ServerView / Sidebar / プレースホルダ） |
| **1c** | Channel CRUD（Settings モーダル） |
| 2 | メッセージ（送受信・添付・Realtime 配信・リアクション・既読） |
| 3 | Voice / Meeting（LiveKit）、Stage / Events |
| 4 | Object 紐付け、private channel、Brief / Element 変換アクション |

## 命名・整合性メモ

- 「Server」という語彙は Alcon 6 概念（System / Object / Element / Tag / Brief / Widget）には含まれないが、UX 用語としては Discord 流の慣習に従って表に出す。内部的には `system_id` が一意キー。
- メッセージは Element に乗せない。寿命・量のオーダーが違うため Phase 2 で独立テーブル `messages` を切る。
- 「Chat」という語彙は使わず **Server Room** で統一（Hub の `chat` リーフは Phase 2 で Server Room に吸収するか別物として残すか再判断）。
