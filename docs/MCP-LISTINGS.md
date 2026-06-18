# MCP listing submissions

Do these **after** `npm publish` + `mcp-publisher publish` (so the package and registry
entry exist). Each is a fork → edit one line → PR. Copy-paste ready.

Canonical facts:
- Repo: `https://github.com/ericlovold/sanction`
- npm: `sanction-mcp` · run with `npx sanction-mcp`
- Site: `https://onesanction.com`
- Server type: TypeScript, connects to a hosted API → emoji `📇 ☁️`

---

## 1. punkpeye/awesome-mcp-servers  (highest-traffic)

Repo: https://github.com/punkpeye/awesome-mcp-servers
Add under **💰 Finance & Fintech** (best fit for the positioning; **🛡️ Security** is a fine alt).
Keep the list roughly alphabetical by repo name.

```markdown
- [ericlovold/sanction](https://github.com/ericlovold/sanction) 📇 ☁️ - Financial control for autonomous AI agents: spend authorization, token budgets, and an encrypted credential vault. The agent asks before it spends, calls a paid API, or touches a secret.
```

PR title: `Add Sanction (financial control for AI agents)`
PR body: `Adds Sanction — an MCP server for agent spend authorization, token budgets, and a credential vault. Hosted API + npx sanction-mcp. https://onesanction.com`

---

## 2. modelcontextprotocol/servers  (official repo, community list)

Repo: https://github.com/modelcontextprotocol/servers
Edit `README.md` → **"Community Servers"** section. Alphabetical by name.

```markdown
- **[Sanction](https://github.com/ericlovold/sanction)** - Financial control for autonomous agents: spend authorization, token budgets, and a credential vault — the agent asks before it spends or uses a secret.
```

PR title: `Add Sanction to Community Servers`
(Read their CONTRIBUTING.md first — they sometimes require the server to be published and to follow the entry ordering exactly.)

---

## 3. wong2/awesome-mcp-servers

Repo: https://github.com/wong2/awesome-mcp-servers
Same one-line format as #1, under a Security/Finance-type section:

```markdown
- [Sanction](https://github.com/ericlovold/sanction) - Spend authorization, token budgets, and a credential vault for autonomous AI agents.
```

---

## 4. Directories that auto-index (no PR needed)

These pull from the **official MCP registry** and/or **npm**, so once you've run
`mcp-publisher publish` and `npm publish`, they should pick Sanction up automatically.
Check after ~24h; submit manually only if missing:

- **Glama** — https://glama.ai/mcp/servers (indexes the registry)
- **mcp.so** — https://mcp.so (has a "Submit" button if not auto-listed)
- **Smithery** — https://smithery.ai (often requires a `smithery.yaml`; optional)

---

## Suggested order
1. `npm publish` + `mcp-publisher publish` (the source of truth).
2. PR to **punkpeye** (#1) — most reach.
3. PR to **modelcontextprotocol/servers** (#2) — most credibility.
4. Check the auto-indexers after a day; backfill #3/#4 as needed.
