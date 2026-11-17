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

3. Open `/plugin` in Claude Code. On the **Installed** tab, select Sanction,
   choose **Configure**, and enter the dedicated seat key. To check whether
   the key is set, run `claude plugin configure sanction@sanction` in a terminal.

The stored plugin key is scoped to `https://getsanction.com`. For a self-hosted instance, set both `SANCTION_URL` and that instance’s `SANCTION_AGENT_KEY` in your environment.

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

One [Bash hook](hooks/claude-hook.mjs) checks these command prefixes locally.
A command that mentions multiple listed prefixes produces one approval request.
The reviewer sees each match and the exact tool input.

## The approval loop

1. Claude tries a gated command. The hook asks Sanction for a human decision
   and blocks the command. No policy edit is needed.
2. Open the request in Sanction to review the working directory and full tool input.
   Slack cards link to these details when Slack is configured.
3. Retry with the same session, working directory, and tool input, including the
   description if provided. The hook redeems the grant once. Claude Code then
   applies its normal permission rules.

A changed command, another session, or a second run needs a new approval. A
rejected or timed-out request stays blocked; retrying opens a new request.
A wallet policy that denies `claude-code.Bash` cannot be approved around.

## Limits

- **Not a sandbox.** Whoever controls the host's settings can disable the
  plugin. It guards against mistakes, not a hostile operator.
- **Prefix matching is best-effort.** `git -C . push`, `rm -fr` and words
  assembled from variables (`git $X`) are not caught. `echo "git push"` is
  gated. Claude Code's own permission rules remain the place for deny lists.
- **Availability.** A Sanction outage blocks commands matching the list. If the local Bash hook cannot start or times out, Claude Code blocks the Bash call.
- **Approval is not execution.** A redeemed grant shows the command was
  permitted. It does not prove the command ran or succeeded.

Pending state holds only request IDs and idempotency keys, under
`~/.local/state/sanction/hooks` (override with `SANCTION_HOOK_STATE_DIR`).
