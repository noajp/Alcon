# Alcon asset relay — 一行で Space に参加する

ローカルで動くアプリや AI のバックエンドに一行足すと、そのアプリは Alcon の Space に名乗り出て、Space のオーナーが承諾した時点で「資産」として認識される。以後、アプリが何をしたか（起動・停止、どの外部サービスと AI プロバイダに通信したか、アプリ自身が言う出来事）が Alcon に残る。設計は [ADR 0036](../docs/adr/0036-shadow-apps-join-a-space-by-announcing-through-the-asset-relay.md)、受け口の仕様は [docs/asset-relay.md](../docs/asset-relay.md)。

## Node

```js
import './alcon.mjs';   // この一行
```

`sdk/node/alcon.mjs` をアプリにコピーして、エントリポイントの先頭で読み込む。依存なし、Node 18 以上。

## Python

```python
import alcon   # この一行
```

`sdk/python/alcon.py` をアプリのディレクトリに置く。標準ライブラリだけ、Python 3.8 以上。

## 環境変数

| 変数 | 意味 |
|---|---|
| `ALCON_RELAY` | 受け口の URL。`https://<project>.supabase.co/functions/v1/asset-relay`。Alcon の Settings › Integrations › Connected assets に表示される |
| `ALCON_SPACE` | 名乗り出る Space の id。同じ画面に表示される。初回だけ必要 |
| `ALCON_NAME` | 資産の名前（省略時は package.json の name かフォルダ名） |
| `ALCON_KIND` | `app` / `ai_agent` / `script` / `service` / `other`（省略時 `app`） |
| `ALCON_STATE` | トークンの保存先（省略時 `./.alcon/asset.json`）。`.gitignore` に `.alcon/` を足す |
| `ALCON_SILENT` | `1` で標準エラー出力への一行の記録を止める |

鍵の発行や貼り付けは要らない。初回の名乗りでトークンを受け取り、`.alcon/asset.json` に保存するので、再起動しても同じ資産として続く。

## 何を送るか

- **名乗り（自己申告）**：名前、バージョン、ランタイム、ホスト名、フォルダ名、エントリポイント、どの AI プロバイダの鍵を持っているか（鍵の有無だけ。値は送らない）、Node なら依存パッケージ名
- **出来事**：起動・停止、外向き HTTP のホスト名（5 秒ごとにまとめる。URL のパスや本文は送らない）、アプリが `alcon.event(kind, summary, payload)` で言ったこと
- **送らないもの**：要求の本文、環境変数の値、ファイルの中身

Alcon 側では、アプリが言ったこと（自己申告）と、受け口が実際に見たもの（接続元・User-Agent）を分けて表示する。承諾前の資産は「未確認」のまま並ぶ。

## 挙動

- 受け口に届かない、トークンが取り消された、設定が無い——どの場合もアプリは止まらず、一行の記録を出して以後は送らない
- 出来事は 5 秒ごとにまとめて送り、1 回 50 件まで。未送信が 500 件を超えたら古いものから捨てる
- 停止は best effort。強制終了では送られず、`last_seen_at` が止まることが停止のしるしになる
