# Clayware asset relay — 一行で Space に参加する

ローカルで動くアプリや AI のバックエンドに一行足すと、そのアプリは Clayware の Space に名乗り出て、Space のオーナーが承諾した時点で「資産」として認識される。以後、アプリが何をしたか（起動・停止、どの外部サービスと AI プロバイダに通信したか、アプリ自身が言う出来事）が Clayware に残る。受け口の仕様は [docs/asset-relay.md](../docs/asset-relay.md)。

## Node

```js
import './clayware.mjs';   // この一行
```

`sdk/node/clayware.mjs` をアプリにコピーして、エントリポイントの先頭で読み込む。依存なし、Node 18 以上。

## Python

```python
import clayware   # この一行
```

`sdk/python/clayware.py` をアプリのディレクトリに置く。標準ライブラリだけ、Python 3.8 以上。

## 環境変数

| 変数 | 意味 |
|---|---|
| `CLAYWARE_RELAY` | 受け口の URL。`https://<project>.supabase.co/functions/v1/asset-relay`。Clayware の Settings › Customize › Connected assets に表示される |
| `CLAYWARE_SPACE` | 名乗り出る Space の id。同じ画面に表示される。初回だけ必要 |
| `CLAYWARE_NAME` | 資産の名前（省略時は package.json の name かフォルダ名） |
| `CLAYWARE_KIND` | `app` / `ai_agent` / `script` / `service` / `other`（省略時 `app`） |
| `CLAYWARE_STATE` | トークンの保存先（省略時 `./.clayware/asset.json`）。`.gitignore` に `.clayware/` を足す |
| `CLAYWARE_SILENT` | `1` で標準エラー出力への一行の記録を止める |

鍵の発行や貼り付けは要らない。初回の名乗りでトークンを受け取り、`.clayware/asset.json` に保存するので、再起動しても同じ資産として続く。

## 何を送るか

- **名乗り（自己申告）**：名前、バージョン、ランタイム、ホスト名、フォルダ名、エントリポイント、どの AI プロバイダの鍵を持っているか（鍵の有無だけ。値は送らない）、Node なら依存パッケージ名
- **出来事**：起動・停止、外向き HTTP のホスト名（5 秒ごとにまとめる。URL のパスや本文は送らない）、アプリが `clayware.event(kind, summary, payload)` で言ったこと
- **送らないもの**：要求の本文、環境変数の値、ファイルの中身

Clayware 側では、アプリが言ったこと（自己申告）と、受け口が実際に見たもの（接続元・User-Agent）を分けて表示する。承諾前の資産は「未確認」のまま並ぶ。

## 挙動

- 受け口に届かない、トークンが取り消された、設定が無い——どの場合もアプリは止まらず、一行の記録を出して以後は送らない
- 出来事は 5 秒ごとにまとめて送り、1 回 50 件まで。未送信が 500 件を超えたら古いものから捨てる
- 停止は best effort。強制終了では送られず、`last_seen_at` が止まることが停止のしるしになる

## 実行役：自分の PC のブラウザを AI に貸す

`sdk/node/runner/` は、Clayware の AI の実行に、自分の PC の Google Chrome を貸す常駐プログラム。AI は、検索では中身が取れない一覧・検索結果・詳細ページをブラウザで開き、絞り込み・ページ送り・詳細を開くといった操作をする。

```bash
cd sdk/node/runner && npm install
CLAYWARE_RELAY=https://<project>.supabase.co/functions/v1/asset-relay CLAYWARE_SPACE=<Space の id> node clayware-runner.mjs
```

- 初回は Space に名乗り出る。Settings › Customize › Connected assets で承諾すると、承諾した人の AI の実行から使えるようになる
- ブラウザは専用のプロフィール（`~/.clayware/browser`）で開き、画面に見えるので AI の操作を見守れる。普段の Chrome のログインは共有しない。AI に見せたいサイトだけ、そのウィンドウでログインする
- 既定は読み取りのみ。フォームを送る画面遷移は止める。`--allow-writes` で外す。`--headless` で画面を出さない
- トークンとプロフィールは `~/.clayware/`（`CLAYWARE_HOME` で変更）。止めるときは Ctrl+C、Clayware 側で Revoke すると次の呼び出しで止まる

### 使い捨ての仮想マシンで動かす（シェル・ファイルも使える）

Vercel Sandbox のような使い捨ての仮想マシンの中では、`--isolated --shell` を付けて起動する。AI はブラウザに加えて、コマンドの実行（`vm_shell`、1 回 40 秒まで、長い処理は裏に回す）とファイルの読み書き（`vm_write_file` / `vm_read_file`）を使える。手元の PC では付けない。

```bash
vercel sandbox create --name clayware-vm-1 --timeout 45m --region hnd1
vercel sandbox copy sdk/node/runner/clayware-runner.mjs clayware-vm-1:/vercel/sandbox/runner/clayware-runner.mjs
vercel sandbox copy sdk/node/runner/package.json clayware-vm-1:/vercel/sandbox/runner/package.json
vercel sandbox exec clayware-vm-1 -- bash -lc "cd /vercel/sandbox/runner && npm install && sudo PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright-core install --with-deps chromium && PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright-core install chromium"
vercel sandbox exec clayware-vm-1 -- bash -lc "cd /vercel/sandbox/runner && CLAYWARE_HOME=/vercel/sandbox/.clayware CLAYWARE_WORKDIR=/vercel/sandbox/work CLAYWARE_RELAY=… CLAYWARE_SPACE=… nohup node clayware-runner.mjs --browser chromium --headless --isolated --shell > /vercel/sandbox/runner.log 2>&1 &"
```

- `PLAYWRIGHT_HOST_PLATFORM_OVERRIDE` は、Playwright 1.56 が Ubuntu 26.04 をまだ知らないための指定
- 仮想マシンが止まるとプロセスも止まる（ファイルは残る）。再開したら最後のコマンドで起動し直す
- AI がシェルを使えるのは `isolated` と申告し、承諾された実行役だけ
