# Sanction for Claude Code

Pauses a short list of risky shell commands until a person approves the exact
command. Everything else runs as usual, with no network call.

This plugin is not listed in any Anthropic marketplace. It installs from this
repository.

## Install

Needs Claude Code 2.1.295 or newer and Node 20 or newer on `PATH`.

1. In Sanction, create a dedicated seat for this machine (**Roster → Add
   agent**) and copy its `pxy_` key. Never use a management key.
2. Add the marketplace and install:

   ```bash
   claude plugin marketplace add ericlovold/sanction
   ```

   ```bash
   claude plugin install sanction@sanction
   ```

3. Enter the key when Claude Code asks for **Sanction agent key**. Claude Code
   keeps it in the platform's secure store, not in `settings.json`.

`SANCTION_AGENT_KEY` in the environment overrides the stored key.
`SANCTION_URL` points the hook at a self-hosted Sanction.

## What it gates

| Rule | Commands starting with |
|---|---|
| `git-push` | `git push` |
| `npm-publish` | `npm publish` |
| `gh-pr-merge` | `gh pr merge` |
| `rm-rf` | `rm -rf` |
| `terraform-apply` | `terraform apply` |
| `terraform-destroy` | `terraform destroy` |
| `kubectl-delete` | `kubectl delete` |

The list lives in [`hooks/hooks.json`](hooks/hooks.json). Claude Code does the
matching, including inside `&&` chains and `$( )`. It also runs these filters
on any command containing `$( )`, backticks or `$VAR`, so the hook checks the
command text itself and stays out of the way unless the gated words appear.

## The approval loop

1. Claude tries a gated command. The hook asks Sanction for a human decision
   and blocks the command. No policy edit is needed.
2. You review the exact working directory and command in the approval inbox,
   or in Slack when configured, and approve or reject.
3. Claude retries the identical command in the same session. The hook redeems
   the one-use grant and lets that one run through.

A changed command, another session, or a second run needs a new approval. A
rejected or timed-out request stays blocked; retrying opens a new request.
A wallet policy that denies `claude-code.Bash` cannot be approved around.

## Limits

- **Not a sandbox.** Whoever controls the host's settings can disable the
  plugin. It guards against mistakes, not a hostile operator.
- **Prefix matching is best-effort.** `git -C . push`, `rm -fr` and words
  assembled from variables (`git $X`) are not caught. `echo "git push"` is
  gated. Claude Code's own permission rules remain the place for deny lists.
- **One approval per rule.** `git push && npm publish` matches two rules and
  needs two approvals.
- **Fails closed.** If Sanction is unreachable, the hook times out, or Node is
  missing, the gated command is blocked.
- **Approval is not execution.** A redeemed grant shows the command was
  permitted. It does not prove the command ran or succeeded.

Pending state holds only request IDs and idempotency keys, under
`~/.local/state/sanction/hooks` (override with `SANCTION_HOOK_STATE_DIR`).
