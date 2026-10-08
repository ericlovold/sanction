export const stories = [
  {
    "n": "01",
    "track": "people",
    "title": "Approve a production change",
    "story": "An engineer asks a coding agent to run a migration on the billing database. The agent doesn't just run it. It sends Sanction the exact command, the target, and why, and waits. The designated owner reads that exact proposal and approves it. The agent gets a one-use grant for that command and nothing else.",
    "strip": [
      {
        "i": "agent",
        "t": "Agent",
        "s": "migrate billing|--target prod"
      },
      {
        "i": "shield",
        "t": "Escalated",
        "s": "require_approval|reason given",
        "tone": "esc"
      },
      {
        "i": "person",
        "t": "Owner reviews",
        "s": "exact command|approves once"
      },
      {
        "i": "ticket",
        "t": "Grant",
        "s": "1 use · expires|args bound",
        "tone": "ok"
      }
    ],
    "note": "A retry with a different --target is refused and needs a new decision.",
    "reviewed": "The tool, the server, and the full arguments: the actual command, not a summary of it.",
    "coop": "sanction_authorize_tool with require_approval, then sanction_check_authorization, then redeem with the grant_id. The agent honors proceed.",
    "enf": "Put the deploy or infrastructure MCP server behind Sanction's broker. The call is forwarded only with an allowed decision.",
    "boundary": "Sanction governs calls routed through it. Approval authorizes the proposed operation; it does not establish that a deployment is safe or execute the deployment."
  },
  {
    "n": "02",
    "track": "people",
    "title": "Approve an unexpected expense",
    "story": "Someone needs a paid API plan or extra compute that crosses their normal review threshold but remains within the hard budget. They don't edit the standing budget and they don't need an exception that lasts all quarter. They ask for that one purchase. A person approves that amount for that purpose, and the budget policy stays as it was.",
    "strip": [
      {
        "i": "card",
        "t": "Request",
        "s": "$240 · compute|for this job"
      },
      {
        "i": "shield",
        "t": "Over threshold",
        "s": "escalate_over_usd",
        "tone": "esc"
      },
      {
        "i": "person",
        "t": "Approver",
        "s": "this amount|this purpose"
      },
      {
        "i": "check",
        "t": "Policy intact",
        "s": "standing budget|unchanged",
        "tone": "ok"
      }
    ],
    "note": "Illustrative amounts. Hard limits still deny, even with a person available.",
    "reviewed": "The amount, what it pays for, and the reason. The standing daily budget isn't changed.",
    "coop": "sanction_authorize with the amount. Policy escalates above the review threshold, and the agent waits for the decision.",
    "enf": "The LLM gateway meters supported calls and returns 402 on new calls once recorded daily usage reaches the budget. In-flight usage can cross the budget. External purchases need a caller that honors the decision.",
    "boundary": "Approval does not raise a hard budget limit or make a payment. An external purchase still needs a caller that honors the decision."
  },
  {
    "n": "03",
    "track": "people",
    "title": "Review something before it leaves the company",
    "story": "An assistant drafts a customer email, a contract redline, or a public post. Before it sends, it submits the real recipient and the real content. A human approves that exact message to that exact recipient. If the agent edits the content or changes the recipient afterward, that's a new decision.",
    "strip": [
      {
        "i": "mail",
        "t": "Draft ready",
        "s": "to: renewal@…|body + attachment"
      },
      {
        "i": "shield",
        "t": "Escalated",
        "s": "outbound send",
        "tone": "esc"
      },
      {
        "i": "slack",
        "t": "Human reviews",
        "s": "dashboard|or Slack"
      },
      {
        "i": "ticket",
        "t": "Send once",
        "s": "same recipient|same content",
        "tone": "ok"
      }
    ],
    "note": "Slack is optional. The dashboard approval inbox is the baseline.",
    "reviewed": "Recipient, subject, body, and attachments, exactly as the send tool will receive them.",
    "coop": "The send tool's arguments go into sanction_authorize_tool. The agent sends only after proceed, using the matching grant_id.",
    "enf": "Route the email or social MCP server through the broker so the send is forwarded only with an allowed decision.",
    "boundary": "Only a person with authority over the wallet can approve. A channel membership alone does not grant approval authority."
  },
  {
    "n": "04",
    "track": "people",
    "title": "Give a contractor narrowly scoped access",
    "story": "A contractor's agent needs to work in your repository for two weeks. You don't share your keys. You give it its own agent seat with a tool allow-list, a budget, and an expiry date. Sensitive credentials stay in the vault and are used only on the governed execution path. When the seat expires, the key stops working.",
    "strip": [
      {
        "i": "agent",
        "t": "Contractor seat",
        "s": "own key|own identity"
      },
      {
        "i": "stack",
        "t": "Scoped policy",
        "s": "tool allow-list|daily budget"
      },
      {
        "i": "vault",
        "t": "Vault",
        "s": "credentials stay|server-side",
        "tone": "ok"
      },
      {
        "i": "clock",
        "t": "Expires",
        "s": "key fails closed|after end date",
        "tone": "dark"
      }
    ],
    "reviewed": "Anything outside the allow-list or above budget escalates or is denied. Expiry is automatic.",
    "coop": "Over the approvals profile, the contractor's agent asks Sanction and honors the answer.",
    "enf": "Give the contractor the broker URL, not the upstream. Calls are policy-checked, tools/list shows only allowed tools, and the upstream credential is injected server-side.",
    "boundary": "Enforcement covers the governed execution path. Separate access to an upstream service remains outside that boundary."
  },
  {
    "n": "05",
    "track": "people",
    "title": "Coordinate work across AI providers",
    "story": "A team researches in one assistant, builds in another, and reviews in Slack. Each agent connects to the same Sanction wallet under its own identity. Whichever tool asks, decisions land in one shared history, and the team can see what was requested, who decided, and what was redeemed.",
    "strip": [
      {
        "i": "agent",
        "t": "Research",
        "s": "assistant A"
      },
      {
        "i": "agent",
        "t": "Build",
        "s": "assistant B"
      },
      {
        "i": "shield",
        "t": "One service",
        "s": "same policy|same wallet",
        "tone": "dark"
      },
      {
        "i": "history",
        "t": "One history",
        "s": "every decision|every host",
        "tone": "ok"
      }
    ],
    "note": "Each host needs its own configured connection and agent identity.",
    "reviewed": "Each request on its own merits, attributed to the agent and host that sent it.",
    "coop": "Each host connects to the approvals profile. Every agent asks the same service before acting.",
    "enf": "Tool traffic routed through the broker is checked before forwarding. An SDK integration enforces the decision only when its calling code gates execution on that decision. Other paths remain cooperative.",
    "boundary": "Connection and enforcement depend on each host’s integration. Sharing a decision history does not make every host an enforced execution path."
  },
  {
    "n": "06",
    "track": "agents",
    "title": "Stop at the edge of a budget",
    "story": "An agent does routine paid work inside its allowance without interrupting anyone. When one expense crosses the review threshold, it escalates that expense and waits. When an action would break a hard limit, it gets a denial, and asking a human doesn't change that.",
    "strip": [
      {
        "i": "agent",
        "t": "Routine",
        "s": "within allowance",
        "tone": "ok"
      },
      {
        "i": "card",
        "t": "Large expense",
        "s": "over threshold"
      },
      {
        "i": "shield",
        "t": "Escalate",
        "s": "one review",
        "tone": "esc"
      },
      {
        "i": "stop",
        "t": "Hard limit",
        "s": "deny · no|override",
        "tone": "no"
      }
    ],
    "reviewed": "Only the expense that crossed the threshold. Routine spend stays quiet.",
    "coop": "sanction_authorize before each spend returns allow, escalate, or deny. sanction_wallet_status shows remaining headroom.",
    "enf": "The LLM gateway meters supported calls and returns 402 on new calls once recorded daily usage reaches the budget. In-flight usage can cross the budget; this budget check is separate from the approval-and-grant loop.",
    "boundary": "An escalation timeout does not override hard limits. Gateway checks happen before provider calls; in-flight usage can affect the final cost."
  },
  {
    "n": "07",
    "track": "agents",
    "title": "Ask before acquiring new capabilities",
    "story": "Before it installs a skill, enables a plugin, or calls a new API, the agent asks. The organization's capability policy allows it, escalates it, or blocks it. Gaining a new capability is governed the same way spending money is.",
    "strip": [
      {
        "i": "plug",
        "t": "Wants",
        "s": "skill:install:|web-reader"
      },
      {
        "i": "shield",
        "t": "Capability rules",
        "s": "block → allow →|escalate",
        "tone": "dark"
      },
      {
        "i": "person",
        "t": "Review",
        "s": "if escalated",
        "tone": "esc"
      },
      {
        "i": "check",
        "t": "Decision",
        "s": "recorded",
        "tone": "ok"
      }
    ],
    "note": "Rules use namespaced IDs with prefix matching, e.g. api:github.com/*",
    "reviewed": "The namespaced capability the agent wants, e.g. skill:install:… or api:….",
    "coop": "sanction_authorize_capability before the install or the first call to the new API.",
    "enf": "Enforced where the install or API path goes through Sanction. A host's own plugin installer stays cooperative.",
    "boundary": "Authorization records a decision; it does not install a skill or plugin. A host’s own installer must honor that decision or gate execution itself."
  },
  {
    "n": "08",
    "track": "agents",
    "title": "Escalate an exceptional action and resume once",
    "story": "The agent reaches a step that needs human judgment. It submits the exact action, pauses, and checks back. Once someone approves, it redeems the grant for that identical action, one time. If the arguments change, it has to ask again. If redemption fails, it stops and reports instead of asking again on its own.",
    "strip": [
      {
        "i": "agent",
        "t": "Submit",
        "s": "exact action"
      },
      {
        "i": "clock",
        "t": "Wait",
        "s": "next_action: wait",
        "tone": "esc"
      },
      {
        "i": "ticket",
        "t": "Redeem once",
        "s": "identical input|+ grant_id",
        "tone": "ok"
      },
      {
        "i": "stop",
        "t": "Changed args",
        "s": "new decision|required",
        "tone": "no"
      }
    ],
    "note": "If redemption fails, the agent stops and reports. It doesn't re-request automatically.",
    "reviewed": "The paused action, exactly as it will run.",
    "coop": "sanction_authorize_tool → sanction_check_authorization → retry_with_grant → proceed. This is the synthetic first request in the connection guide.",
    "enf": "The same loop through the broker: the forward happens only with the redeemed grant.",
    "boundary": "A grant authorizes one matching request. An outcome log records what the caller reports; it is not independent proof that the action ran."
  },
  {
    "n": "09",
    "track": "agents",
    "title": "Use credentials without possessing them",
    "story": "An agent needs to call an API that requires a secret. It holds its Sanction key. A governed integration—the MCP broker or LLM gateway—adds the stored upstream credential on the server side. The agent can complete the supported call without receiving the credential as a tool result.",
    "strip": [
      {
        "i": "agent",
        "t": "Agent",
        "s": "holds only|its Sanction key"
      },
      {
        "i": "shield",
        "t": "Authorize",
        "s": "scoped operation",
        "tone": "dark"
      },
      {
        "i": "vault",
        "t": "Inject",
        "s": "server-side|from vault",
        "tone": "ok"
      },
      {
        "i": "plug",
        "t": "Upstream API",
        "s": "credential added|server-side"
      }
    ],
    "note": "Broker and gateway inject server-side. sanction_inject_credential hands the value to the agent, so it isn't this story.",
    "reviewed": "The operation and its scope. Calls to the vaulted provider key are limited to metered endpoints.",
    "coop": "Not applicable. This story is about the enforced path by definition.",
    "enf": "The broker decrypts and injects the upstream credential server-side. The gateway injects a stored provider key for supported metered calls. Both keep credential handling on the forwarding path.",
    "boundary": "Sanction stores encrypted credentials. Server-side injection avoids returning the credential as a tool result; upstream responses must not echo secrets. The direct credential-injection tool returns a credential value and is a different path."
  },
  {
    "n": "10",
    "track": "agents",
    "title": "Collaborate without passing around blanket authority",
    "story": "A research agent hands work to a purchasing or deployment agent. Each one acts under its own identity and its own limits. The handoff passes the work, not permission. The receiving agent asks Sanction for what it intends to do. If a parent agent deliberately delegates, it mints a short-lived, scoped mandate instead of sharing its key.",
    "strip": [
      {
        "i": "agent",
        "t": "Research",
        "s": "own identity"
      },
      {
        "i": "handoff",
        "t": "Handoff",
        "s": "work, not|permission"
      },
      {
        "i": "agent",
        "t": "Purchasing",
        "s": "own identity|own limits"
      },
      {
        "i": "shield",
        "t": "Asks again",
        "s": "its own decision",
        "tone": "esc"
      }
    ],
    "note": "A handoff does not transfer an approval. Each agent remains accountable for its own request.",
    "reviewed": "The receiving agent's proposed action, under the receiving agent's own policy.",
    "coop": "Each agent connects with its own identity and asks before acting. An approval granted to one agent can't be redeemed by another.",
    "enf": "A parent can issue a short-lived mandate with a credential scope and a spend cap. The mandate is verified by Sanction on the consuming path; enforcement depends on that path checking it. Agents keep separate keys.",
    "boundary": "Approvals are bound to an agent and cannot be transferred to another. A scoped mandate is a separate delegation mechanism, not a transferable approval."
  }
] as const
