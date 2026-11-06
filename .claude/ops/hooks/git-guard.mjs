// PreToolUse guard for Bash: refuses the git commands that have destroyed
// other sessions' work in this repo (several sessions share it at once).
//
//   git reset --hard          discards every uncommitted change in the tree
//   git push … main/master    main moves only through a merged PR
//   git push --force / -f     rewrites what others may have built on
//                             (--force-with-lease is allowed)
//
// Exit 2 refuses the call and shows the reason to the agent; anything else
// lets it through. Reads the hook's JSON on stdin.

import { readFileSync } from 'node:fs'

let input = {}
try { input = JSON.parse(readFileSync(0, 'utf8') || '{}') } catch { process.exit(0) }
const cmd = String(input?.tool_input?.command ?? '')

// One git invocation per segment, so `cd x && git push` is read as a push.
const segments = cmd.split(/&&|\|\||;|\n/).map((s) => s.trim())
const refuse = (why) => { process.stderr.write(`git-guard: ${why}\n`); process.exit(2) }

for (const seg of segments) {
  if (!/\bgit\b/.test(seg)) continue
  if (/\bgit\s+(?:-C\s+\S+\s+)?reset\b[^|]*--hard\b/.test(seg)) {
    refuse('`git reset --hard` は他のセッションの未コミットの作業を消すので使わない。自分の変更だけを戻すなら `git restore <path>`、最新を見るなら `git switch --detach origin/main`。')
  }
  if (/\bgit\s+(?:-C\s+\S+\s+)?push\b/.test(seg)) {
    if (/(?:^|\s)(?:--force(?!-with-lease)\b|-f\b)/.test(seg)) {
      refuse('force push はしない。どうしても要るなら `--force-with-lease` を使い、理由を報告する。')
    }
    if (/(?:\s|:)(?:refs\/heads\/)?(?:main|master)(?:\s|$)/.test(seg)) {
      refuse('main には直接 push しない。ブランチを push して PR を作り、CI が通ってからマージする。')
    }
  }
}
process.exit(0)
