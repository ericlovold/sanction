// What the dashboard says about the Claude Code plugin. The plugin itself is
// the source of truth: tests/claude-code-seat-page.test.tsx fails if the gated
// list here drifts from `gatedPrefixes` in claude-plugin/hooks/claude-hook.mjs.

export const CLAUDE_CODE_GATED = [
  "git push", "npm publish", "gh pr merge", "rm -rf",
  "terraform apply", "terraform destroy", "kubectl delete",
] as const

export const CLAUDE_CODE_INSTALL = [
  "claude plugin marketplace add ericlovold/sanction",
  "claude plugin install sanction@sanction",
] as const

export const CLAUDE_CODE_CONFIGURE_CHECK = "claude plugin configure sanction@sanction"
