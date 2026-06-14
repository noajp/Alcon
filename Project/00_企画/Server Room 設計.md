# Room 設計

Alcon の Discord 風 **Room**（旧称 Server Room）の設計メモ。当初は最小スコープ（チャンネルの枠だけ）で始めたが、現在はメッセージ・通話・ビデオ会議・ライブ字幕・議事録まで実装済。

> 用語注記: 最上位の入れ物は **Domain**（旧称 System）。Room は Domain に紐付く。
> **Room と Chat は別系統**: Room = チャンネル制のコラボ空間（`channels`）、Chat = 1:1 / グループの DM（`conversations`）。当初「Chat という語彙は Server Room に吸収する」案だったが、結果として DM は独立した **Chat** モジュールに分離した。

## コンセプト

- **1 Domain = 1 Room**。Domain Switcher がそのまま Room Switcher を兼ねる。
- Room 内には **Channel のみ**（カテゴリ階層なし）。
- Channel 種別は **`text` / `voice` の2つ**。
- サイドバーの「Text channels / Voice channels」は `kind` で絞り込むだけのセクション見出し（DB 上のカテゴリではない）。

参考画面：Discord スタイルの最小サイドバー

```
[noa's room ▾]                   [invite]
🗓 Events                        (placeholder)
🛡 Boosts                        (placeholder)
─────────────
Text channels ▾                  +
  #  general
Voice channels ▾                 +
  🔊 Voice
```

## 実装状況

### 実装済
- Room レコード（Domain に対して 1:1。`rooms`）
- Channel CRUD（text / voice。`channels`）
- サイドバー UI（Room Switcher / Channel リスト / セクション折りたたみ）
- Text channel: メッセージ送受信・リアクション・添付（`messages` / `message_reactions` / `message_attachments`）
- Voice channel: ビデオ会議・ライブ字幕・議事録（`voice_meeting_minutes` / `voice_transcript_lines`、`voice-summarize` Edge Function）
- RLS（同 Domain の Worker のみアクセス）

### 別モジュールに分離
- **Chat**（DM / グループ）= `conversations` / `conversation_members` / `messages`。Room とは独立した `alcon/chat/`。

### 後続フェーズ
- Realtime 配信の全面適用 / 既読 / メンション
- スレッド / フォーラム / Stage / Events
- Channel の private 化、`channel_members` 管理
- Object との紐付け（`channels.object_id`）

## DB（現行）

```
rooms (
  id            uuid pk,
  domain_id     uuid references domains(id) on delete cascade,
  ...
)

channels (
  id          uuid pk,
  room_id     uuid references rooms(id) on delete cascade,
  kind        text not null check (kind in ('text','voice')),
  name        text not null,
  topic       text,
  position    int default 0,
  ...
)

messages              -- text channel + Chat の両方で使用
message_reactions
message_attachments
voice_meeting_minutes -- voice channel の議事録
voice_transcript_lines-- voice channel のライブ字幕
```

> 最新のカラム定義は `web/src/types/database.ts` と migrations を参照。

### RLS 方針
- `rooms`: 同じ Domain に属する Worker のみ select。Owner のみ update/delete。
- `channels`: room の Domain に属する Worker のみ select。Domain の admin role のみ insert/update/delete。

## UI（`web/src/alcon/room/`）

```
RoomView.tsx           -- activeView==='room' のルート
RoomSidebarPanel.tsx   -- 左ペイン（Room Switcher / Channel セクション）
ChannelDialog.tsx      -- Channel CRUD（name / kind / topic / 並べ替え）
TextChannelView.tsx    -- テキストチャンネル（メッセージ UI）
VoiceChannelView.tsx   -- ボイス/ビデオ会議（字幕・議事録）
```

Chat 側は `web/src/alcon/chat/`（`ChatView` / `ChatSidebarPanel` / `NewConversationDialog` / `ChatGroupDialog`）。

### ナビゲーション
- 活動ビューは `shell/viewRegistry.ts` の `room` / `chat` で定義。
- ModeRail（サイドバー左の常駐ストリップ）に `home / room / chat / note` のモードがある。

## マッピング（Discord → Alcon）

| Discord | Alcon |
|---|---|
| Server | **Domain**（1:1 で `rooms` を持つ） |
| Channel (#text / 🔊voice) | `channels`（kind で区別） |
| Member | **Worker**（既存） |
| Server Switcher | **Domain Switcher**（既存、流用） |
| Category | （持たない） |
| DM | **Chat**（`conversations`、Room とは別系統） |
| Thread / Forum / Stage / Event | （未実装） |

## 命名・整合性メモ

- 「Room」という語彙は Alcon 6 概念（Domain / Object / Element / Tag / Brief / Widget）には含まれないが、UX 用語としては Discord 流の慣習に従って表に出す。内部的には `domain_id` で Domain に紐付く。
- メッセージは Element に乗せない。寿命・量のオーダーが違うため独立テーブル `messages` を使う。
- Room（チャンネル制）と Chat（DM/グループ）は別 UI・別エントリだが、`messages` テーブルは共用する。
