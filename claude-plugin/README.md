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

| Rule | Commands that run |
|---|---|
| `git-push` | `git push` |
| `npm-publish` | `npm publish` |
| `gh-pr-merge` | `gh pr merge` |
| `rm-rf` | `rm -rf` |
| `terraform-apply` | `terraform apply` |
| `terraform-destroy` | `terraform destroy` |
| `kubectl-delete` | `kubectl delete` |

One [Bash hook](hooks/claude-hook.mjs) checks for these commands locally. It
also catches options before the subcommand (`git -C dir push`,
`kubectl -n prod delete`), a path to the program (`/usr/bin/git push`), and
recursive plus force in any spelling (`rm -fr`, `rm -r -f`).
A command that matches several rules produces one approval request.
The reviewer sees each match and the exact command.

## The approval loop

1. Claude tries a gated command. The hook asks Sanction for a human decision
   and blocks the command. No policy edit is needed.
2. Open the request in Sanction to review the working directory and full tool input.
   Slack cards link to these details when Slack is configured.
3. Retry the same command in the same session and working directory. Claude's
   description of the command is not part of the approval, so a reworded retry
   still redeems it. The hook redeems the grant once. Claude Code then applies
   its normal permission rules.

A changed command or other tool input, another session, or a second run needs a
new approval. A rejected or timed-out request stays blocked; retrying opens a new
request.

A wallet policy that denies `claude-code.Bash` cannot be approved around. If the
wallet's policy has a tool allow-list, it must include `claude-code.Bash`. The
**Coding agent seat** pack lists it; a policy saved from an older copy of that
pack needs it added in the policy editor. The hook's refusal says when this is
the cause.

## Limits

- **Not a sandbox.** Whoever controls the host's settings can disable the
  plugin. It guards against mistakes, not a hostile operator.
- **Matching is best-effort.** Words assembled from variables (`git $X`),
  aliases, scripts that run the command for you, and tools outside the list
  (`pnpm publish`) are not caught. `echo "git push"` is gated, and so is a rare
  harmless command such as `git --no-pager log push`. Claude Code's own
  permission rules remain the place for deny lists.
- **Availability.** A Sanction outage blocks commands matching the list. If the local Bash hook cannot start or times out, Claude Code blocks the Bash call. A check interrupted partway blocks that exact action for up to a minute.
- **Approval is not execution.** A redeemed grant shows the command was
  permitted. It does not prove the command ran or succeeded.

Pending state holds only request IDs and idempotency keys, under
`~/.local/state/sanction/hooks` (override with `SANCTION_HOOK_STATE_DIR`).
