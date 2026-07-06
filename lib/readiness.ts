// The Agent Authority Readiness diagnostic — pure scoring, no IO.
// Same discipline as the decision engine: deterministic over its inputs, so
// the result page is replayable and the whole thing unit-tests without a DB.
// The output is an authority map, not a vanity score: current level, where
// authority needs a gate, the first governed workflow, and a policy posture
// that maps onto real policy packs (lib/policyPacks.ts).

export type Environment = "law" | "clinic" | "finance" | "realestate" | "dev" | "agency" | "other"

export type Activity =
  | "drafting"
  | "retrieval"
  | "tools"
  | "external_send"
  | "credentials"
  | "spend"
  | "write_systems"
  | "unsure"

export type DataClass = "public" | "internal" | "client" | "financial" | "phi" | "privileged" | "secrets"

export type ApprovalInstinct =
  | "client_data"
  | "external_send"
  | "spend"
  | "new_tools"
  | "credentials"
  | "threshold"
  | "first_time"

export type ReadinessInput = {
  environment: Environment
  activities: Activity[]
  data: DataClass[]
  approvals: ApprovalInstinct[]
}

export type Risk = { title: string; detail: string; weight: number }

export type ReadinessResult = {
  level: 0 | 1 | 2
  levelName: string
  // Echoes of the user's OWN answers — "you told us …" — so the level reads
  // as heard, not judged. MUST derive from actual selections, never from
  // canned per-level copy: a user who picked "spends money" seeing a
  // "sensitive data" driver is the same trust break one layer down.
  drivers: string[]
  risks: Risk[] // top 3, highest weight first
  firstWorkflow: string
  posture: { auto: string[]; escalate: string[]; deny: string[]; evidence: string[] }
  packId: "metering-first" | "startup-defaults" | "team-workspace" | "compliance-baseline"
  packName: string
  fit: { primary: string; detail: string }
}

export const LEVELS = [
  { level: 0, name: "Shadow AI", line: "People are using AI, but there is no inventory, policy, or record." },
  { level: 1, name: "Assisted AI", line: "AI drafts and summarizes; humans execute everything by hand." },
  { level: 2, name: "Tool-Using AI", line: "AI calls tools, reads internal data, or operates inside workflows." },
  { level: 3, name: "Governed AI", line: "Privileged actions pass a policy gate: approve, escalate, or deny." },
  { level: 4, name: "Delegated AI", line: "Agents hold scoped authority through grants, budgets, and clearance." },
  { level: 5, name: "Evidenced AI", line: "Every privileged action is replayable, attributable, and exportable." },
] as const

const ACTING: Activity[] = ["tools", "external_send", "credentials", "spend", "write_systems"]

const SENSITIVE: DataClass[] = ["client", "financial", "phi", "privileged", "secrets"]

const DATA_LABEL: Record<DataClass, string> = {
  public: "public data",
  internal: "internal documents",
  client: "client-confidential data",
  financial: "financial records",
  phi: "health data (PHI)",
  privileged: "legally privileged material",
  secrets: "credentials and secrets",
}

export function scoreReadiness(input: ReadinessInput): ReadinessResult {
  const acts = new Set(input.activities)
  const data = new Set(input.data)
  const env = input.environment

  // ── Level: taking this diagnostic means no policy gate exists yet, so the
  // current state caps at 2. Levels 3–5 are the ladder ahead.
  const level: 0 | 1 | 2 =
    acts.has("unsure") || acts.size === 0 ? 0 : ACTING.some((a) => acts.has(a)) ? 2 : 1

  // ── Drivers: the user's own answers, echoed back. Each line exists only
  // if the matching option was actually selected.
  const drivers: string[] = []
  if (acts.has("unsure")) drivers.push("You told us nobody can list which AI tools are in use.")
  if (acts.has("credentials")) drivers.push("You told us AI can access credentials.")
  if (acts.has("external_send")) drivers.push("You told us AI sends email or messages that leave the organization.")
  if (acts.has("spend")) drivers.push("You told us AI spends money or provisions resources.")
  if (acts.has("write_systems")) drivers.push("You told us AI writes to your systems.")
  if (acts.has("tools") && drivers.length < 3) drivers.push("You told us AI uses tools inside your workflows.")
  const sensitiveNamed = SENSITIVE.filter((d) => data.has(d) && d !== "secrets").map((d) => DATA_LABEL[d])
  if (sensitiveNamed.length > 0 && drivers.length < 4)
    drivers.push(`You told us it can reach ${sensitiveNamed.join(", ")}.`)
  else if (data.has("secrets") && !acts.has("credentials") && drivers.length < 4)
    drivers.push("You told us it can reach credentials and secrets.")
  if (drivers.length === 0) drivers.push("You told us AI only drafts and retrieves today — nothing acts yet.")

  // ── Risk map: activity × data, weighted; environment bumps what its
  // regulator actually cares about.
  const risks: Risk[] = []
  const sensitiveTouched = SENSITIVE.filter((d) => data.has(d))

  if (acts.has("unsure"))
    risks.push({
      title: "Shadow usage",
      detail: "Nobody can list which AI tools are in use or what they touch. You cannot govern an inventory you do not have.",
      weight: 8,
    })
  if (data.has("secrets") || acts.has("credentials"))
    risks.push({
      title: "Credential exposure",
      detail: "AI tools can reach passwords or API keys with no scoped, expiring grant. One prompt injection is one exfiltrated secret.",
      weight: 10,
    })
  if (acts.has("external_send") && sensitiveTouched.length > 0)
    risks.push({
      title: "Ungated external sends",
      detail: `AI can send email or messages carrying ${sensitiveTouched.map((d) => DATA_LABEL[d]).join(", ")} — with no decision gate before it leaves.`,
      weight: 9,
    })
  if (data.has("phi") && ACTING.some((a) => acts.has(a)))
    risks.push({
      title: "PHI in tool-using AI",
      detail: "Health data flows through AI tooling with no authorization boundary — the exact gap a BAA conversation exposes.",
      weight: env === "clinic" ? 10 : 9,
    })
  if (data.has("privileged") && ACTING.some((a) => acts.has(a)))
    risks.push({
      title: "Privilege at risk",
      detail: "Legally privileged material is reachable by AI tools without a confidentiality gate — the question a bar opinion makes you answer.",
      weight: env === "law" ? 10 : 8,
    })
  if (acts.has("spend"))
    risks.push({
      title: "Unbounded spend",
      detail: "AI can spend or provision with no per-transaction limit, daily budget, or escalation threshold.",
      weight: 7,
    })
  if (acts.has("write_systems"))
    risks.push({
      title: "Unreviewed system writes",
      detail: "AI writes to production systems or records without approval on first-time or high-impact changes.",
      weight: 6,
    })
  if (acts.has("tools") && risks.length === 0)
    risks.push({
      title: "Invisible tool calls",
      detail: "AI invokes tools inside workflows with no record of what was called, when, or why.",
      weight: 5,
    })
  if (risks.length === 0)
    risks.push({
      title: "Authority creep ahead",
      detail: "Today AI only drafts. The next tool someone connects changes that quietly — set the gate before it is needed.",
      weight: 3,
    })

  risks.sort((a, b) => b.weight - a.weight)
  const topRisks = risks.slice(0, 3)

  // ── First governed workflow: derived from the top risk.
  const firstWorkflow = FIRST_WORKFLOW[topRisks[0].title] ?? FIRST_WORKFLOW.default

  // ── Policy posture. Mirror their own approval instincts where given; always
  // hold the hard lines.
  const escalate = new Set<string>()
  if (acts.has("external_send")) escalate.add("External sends (email, messages) — anything leaving the org")
  if (sensitiveTouched.some((d) => d !== "secrets")) escalate.add("Access to client, financial, health, or privileged data")
  if (acts.has("spend") || input.approvals.includes("spend") || input.approvals.includes("threshold"))
    escalate.add("Spend above a per-transaction threshold")
  if (input.approvals.includes("first_time") || acts.has("write_systems")) escalate.add("First-time actions and system writes")
  if (escalate.size === 0) escalate.add("Any action that leaves a draft state")

  const deny = new Set<string>()
  deny.add("Credential use outside a scoped, expiring execution grant")
  if (input.approvals.includes("new_tools") || acts.has("tools")) deny.add("New tools or plugins that have not been reviewed")

  const evidence = ["Decision log with the policy each call ran under", "Approval records tied to the person who approved"]
  if (data.has("phi") || data.has("privileged") || data.has("financial"))
    evidence.push("Assessor-ready export — the audit trail as a document, not a database")

  const posture = {
    auto: ["Drafting and summarization", "Retrieval over internal documents"],
    escalate: [...escalate],
    deny: [...deny],
    evidence,
  }

  // ── Pack + fit.
  const compliance = data.has("phi") || data.has("privileged") || env === "law" || env === "clinic" || (env === "finance" && data.has("financial"))
  const packId = compliance
    ? "compliance-baseline"
    : env === "agency"
      ? "team-workspace"
      : acts.has("spend") || acts.has("write_systems")
        ? "startup-defaults"
        : "metering-first"
  const packName = {
    "compliance-baseline": "Compliance baseline",
    "team-workspace": "Team workspace",
    "startup-defaults": "Startup defaults",
    "metering-first": "Metering first",
  }[packId]

  const localFit = (env === "law" || env === "clinic") && (data.has("phi") || data.has("privileged") || data.has("client"))
  const fit = localFit
    ? {
        primary: "Sanction Local",
        detail: "Private AI on hardware you own — local models, zero egress by design, and the audit trail your assessor reads. Governance without a third party to vet.",
      }
    : env === "dev" || env === "agency"
      ? {
          primary: "Sanction MCP",
          detail: "Add the Sanction MCP server in front of the agents you already run — spend, tool, and credential authorization in one 5-minute install.",
        }
      : {
          primary: "Hosted Sanction",
          detail: "Point your AI tooling at Sanction's gateway and policy engine — budgets, approvals, and an audit trail without running anything yourself.",
        }

  return {
    level,
    levelName: LEVELS[level].name,
    drivers: drivers.slice(0, 4),
    risks: topRisks,
    firstWorkflow,
    posture,
    packId,
    packName,
    fit,
  }
}

const FIRST_WORKFLOW: Record<string, string> = {
  "Credential exposure":
    "Before AI touches any credential, it requests a scoped execution grant — short-lived, single-purpose, audit-logged. Everything else is denied by default.",
  "Ungated external sends":
    "Before AI sends anything outside the organization or touches client data, the action passes a policy gate — approve, escalate, or deny — with a record either way.",
  "PHI in tool-using AI":
    "Before AI reads or moves health data, the action passes a policy gate, and every decision lands in an assessor-ready audit trail.",
  "Privilege at risk":
    "Before AI reads or moves privileged material, the action passes a confidentiality gate, and every decision lands in an audit trail the firm controls.",
  "Unbounded spend":
    "Every AI-initiated spend passes a budget check: auto-approve under a floor, escalate to a human above it, deny past the daily cap.",
  "Shadow usage":
    "Start by routing one team's AI usage through a metering gate — no blocking, just an inventory of who calls what. Govern once you can see.",
  default:
    "Pick the one workflow where AI already acts, and put a policy gate in front of it: approve routine actions, escalate exceptions, deny hard boundaries.",
}
