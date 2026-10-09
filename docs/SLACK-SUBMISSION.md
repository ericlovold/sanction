# Slack Marketplace review packet

Prepared 2026-10-03 for the **Sanction approval app**. This packet is not evidence
of submission, eligibility, or acceptance. Track the broader distribution effort
in [MARKETPLACE-SUBMISSION.md](MARKETPLACE-SUBMISSION.md). Slackbot MCP requires
separate configuration and review.

## Listing copy

**Name:** Sanction

**Short description:** Approve or deny AI agent actions from Slack.

**Long description:** Sanction checks AI agent actions against your organization's
policy and sends requests needing a human decision to your chosen Slack channel.
Approve or deny the request in Slack, or open it in Sanction for review. Sanction
records the decision and its actor; approval issues a single-use, expiring grant
that the agent can redeem on retry.

A Sanction admin connects the workspace and chooses the channel. Anyone who can
use the approval buttons in that channel can decide, so use a private channel
containing the intended approvers. A Sanction account, wallet, policy, and active
agent are needed to exercise the approval flow. The app does not read channel
messages. The Slack interaction records an authorization decision; the agent
performs any subsequent action through its configured integration.

Tool-approval cards link to **Review request in Sanction** and explain that full
arguments are not shown in the channel. A signed-in wallet admin opens the linked
request and selects **Review exact request** to decrypt it. Slack membership alone
does not grant access to that view. The existing Slack Approve/Deny buttons remain
available; review is guidance, not a new enforced prerequisite.

| Listing field | Value |
| --- | --- |
| Landing / install page | https://getsanction.com/slack |
| Privacy policy | https://getsanction.com/privacy |
| Support | https://getsanction.com/support |
| Support contact | eric@getsanction.com |

Use **Install from your landing page**. The OAuth start route requires a Sanction
admin session and redirects unauthenticated visitors to sign-in; it does not meet
Slack's optional Direct Install requirement for an immediate 302 to Slack OAuth.
The publisher must confirm the portal's pricing selection and legal declarations.

## Scope justifications

| Bot scope | Why this app requests it |
| --- | --- |
| `chat:write` | Send approval cards, decision notifications, budget alerts, and the installation confirmation to the selected channel. |
| `incoming-webhook` | Let the installing admin select a channel during OAuth and return that channel's identifier. The app stores the selection and sends messages using its encrypted bot token. |

The requested scopes are defined in `lib/slackOAuth.ts`. OAuth state is signed,
expires after ten minutes, and is checked against the current admin's wallet.
Bot tokens use envelope encryption. Interactive requests require Slack's signature
and an action token bound to the wallet, workspace, and channel. These are source
checks, not evidence of a successful production installation or a security audit.

## Publisher prerequisites

- [ ] In [Slack app management](https://api.slack.com/apps), select the production
  app and enable public distribution; verify the registered OAuth callback is
  `https://getsanction.com/api/slack/oauth/callback` and Interactivity Request URL
  is `https://getsanction.com/api/slack/interactive`.
- [ ] Verify the deployed version has removed legacy platform-token delivery.
  The source requires per-install OAuth tokens; saved archive-URL routes stay
  stored but no longer deliver. Reconnect affected routes with **Add to Slack**
  or replace them with incoming-webhook URLs. Verify deployment and production
  configuration privately before attesting public-distribution readiness.
- [ ] Confirm the portal's live usage eligibility. Slack requires ten active
  workspace installs maintained throughout review; its guidelines also name ten
  weekly active users. Active workspaces have been used within 28 days and exclude
  sandboxes. Do not count local records as proof of Slack's counters.
- [ ] Resolve suitability with Slack's reviewers: the guidelines exclude financial
  transactions and certain remote execution uses. Explain the authorization flow
  accurately; an approval-only description does not guarantee acceptance.
- [ ] Upload real Slack listing screenshots: 1600×1000, PNG/JPEG, under 2 MB each.
  Use only synthetic reviewer data. No screenshots are supplied by this packet.
- [ ] Confirm support coverage, security/compliance answers, terms, and an app
  collaborator. Slack expects support responses within two business days; the
  existing Sanction support page promises one business day.
- [ ] Supply a dedicated Sanction reviewer account with a wallet, policy, active
  test agent, and admin access. Provide login instructions and any required
  testing mailbox access privately in the portal's test-account fields. Never put
  credentials, wallet identifiers, or keys in this document.

## Reviewer setup and lifecycle

Reviewers must be able to install into **their own Slack workspace**. Slack does
not accept supplied Slack workspace credentials as a substitute. The publisher
must complete this walkthrough on a workspace other than the development
workspace before submission, then record the evidence below.

1. Open the landing page, read the privacy/support pages without signing in, and
   select **Add to Slack**. Sign in using the dedicated Sanction admin account.
   Confirm installation resumes; select the reviewer's workspace and a private
   test channel. Authorize the two scopes above.
2. Confirm return to **Dashboard → Approvals**, the connected workspace/channel,
   and the confirmation message in Slack. Verify no other wallet's requests
   appear in that channel.
3. Select **Send a test escalation** in Approvals. It requires an active agent and
   policy and creates a labeled $30 test request without making a purchase or
   running the policy rules. Verify the card reaches the selected channel.
4. Select **Approve** in Slack. Verify the card names the decision and actor and
   the dashboard history shows the approval and grant. This button test proves the
   approval interaction, not agent redemption or downstream action execution.
5. Send another test escalation and select **Deny**. Verify the rejection in
   Slack and dashboard history, with no new approval grant. Exercise **Review in
   Sanction** and confirm it opens the matching request for an authorized admin.
6. Disconnect the workspace from Sanction's Approvals page. Send another test
   escalation and verify delivery to the disconnected channel stops; an old
   decision button must no longer authorize a pending request.
7. Reconnect, then uninstall the app through Slack's app management. Verify Slack
   delivery stops and record the resulting Sanction UI state. Dashboard
   disconnect currently marks the local install revoked; it does not call Slack's
   token-revocation API. No Slack uninstall-event handler is implemented. Do not
   claim automatic uninstall reconciliation or remote token revocation.

## Evidence and submission record

- [ ] Portal usage counters and public-distribution readiness recorded privately.
- [ ] External-workspace install, routing, approval, denial, disconnect, uninstall,
  and reconnect tested; findings resolved before submission.
- [ ] Reviewer account and login instructions tested from a fresh browser session.
- [ ] Listing screenshots and install-to-uninstall demo recorded with dummy data.
- [ ] Listing, scope explanations, and security/compliance answers checked against
  the deployed version; Slack's automated submission checks pass.
- [ ] Submit through **Submit to Slack Marketplace → Review and Submit**. Record
  submission date/reference and reviewed commit in the private handoff; update
  the distribution checklist only after the portal confirms submission.
- [ ] After acceptance, verify the public listing and a fresh-workspace install.

## Official requirements checked

- [Current ten-workspace requirement](https://docs.slack.dev/changelog/2026/09/01/slack-marketplace-install-requirement/)
- [Distribution and submission entrypoint](https://docs.slack.dev/slack-marketplace/distributing-your-app-in-the-slack-marketplace/)
- [Listing, scope, support, and security requirements](https://docs.slack.dev/slack-marketplace/slack-marketplace-app-guidelines-and-requirements/)
- [Reviewer access and external-workspace testing](https://docs.slack.dev/slack-marketplace/slack-marketplace-review-guide/)
