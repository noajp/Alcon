You were started by the Clayware dispatcher to carry out one Element, with no person watching this session. Work in Japanese where you write to Clayware.

Element: {{display_id}} — {{title}} (id {{element_id}})

1. Read `.claude/skills/clayware/SKILL.md` and follow it for this Element only: claim it with `node .claude/ops/lease.mjs claim {{display_id}} --branch claude/<prefix>-<slug> --note "<方針1行>"`, read the Element, its comments and the Initiative it serves, build it on a branch cut from `origin/main`, verify, have it reviewed by a separate agent, open the PR, merge it when the review passes, and release it with `✔ 完了 — <結果>`.
2. Report as you go with `node .claude/ops/lease.mjs comment {{display_id}} --text "● 進捗 — …"`. Each comment keeps your lease. Post the PR with `⬆ PR — <URL>`.
3. Stop only for the four reasons in the skill (money, something irreversible, a design choice the evidence cannot settle, the same failure twice). When you stop, write `■ Blocked — <原因と、人に決めてほしいこと>` on the Element, file the decision as the skill describes, set the Element to `blocked`, release the lease, and end the session.
4. If a tool you need is refused, do not work around it: that is a reason to stop (point 3).
5. Remove the `dispatch` label when the Element is done or blocked, so it is not started again.
6. Do not start other Elements. When this one is done or blocked, end the session.
