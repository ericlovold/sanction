# Sanction demo — "an agent gets stopped" (60s)

The hook: **don't give your agent your credit card — give it a Sanction key.**
This is the shot list for a ~60-second launch video.

## Fastest path (terminal-only, one take)

```bash
export GOOGLE_API_KEY=...          # already in your shell
bash examples/demo.sh              # provisions, runs, auto-approves the escalation
```

Record the terminal with QuickTime (Cmd-Shift-5) or [asciinema](https://asciinema.org)
(`asciinema rec sanction.cast`). The script paces itself (~1.3s/step) so it's readable.

## The arc the viewer sees

| Time | On screen | The point |
|------|-----------|-----------|
| 0:00 | Title card: "An autonomous agent — governed." | Set the stakes |
| 0:05 | `provisioning a wallet + agent…` + policy line | Setup is two API calls |
| 0:12 | 🤖 three real **Gemini** calls, each `✓ logged` with token cost | Every model call is metered |
| 0:30 | 💳 `$8 GitHub` → **✅ approved** | Routine spend just works |
| 0:38 | 💳 `$45 Snowflake` → **⏸ escalated — needs a human** | The agent *pauses*, doesn't spend |
| 0:45 | (owner approves) → **✅ approved** → "proceeding" | Human in the loop, instantly |
| 0:52 | 💳 `$5 crypto` → **⛔ denied (CATEGORY_BLOCKED)** | Hard guardrail holds |
| 0:58 | Dashboard URL | "and it's all tracked" |

End card suggestion: **"Sanction — the trust layer for autonomous agents. onesanction.com"**

## Split-screen take (more compelling)

Show the agent on the left, the **Approvals** dashboard on the right, and click
Approve yourself when the $45 escalates:

```bash
# point the dashboard at this wallet first, then:
NO_AUTO_APPROVE=1 bash examples/demo.sh
```

The agent prints the `request_id` and polls; when you click **Approve** in the
dashboard (`/dashboard/approvals`), the agent unblocks live. That "I clicked, it
moved" moment is the whole pitch.

## Caption track (for a silent autoplay cut)

1. "This agent runs on Gemini. It can spend money."
2. "Every model call is metered against a budget."
3. "$8 tool? Approved automatically."
4. "$45? It stops and asks a human."
5. "Crypto? Hard no."
6. "Don't give your agent a credit card. Give it a Sanction key."
