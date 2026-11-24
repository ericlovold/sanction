import { connectionHosts } from "./connectionGuideNavigation"

// The text a person pastes into their AI host's chat at each step of the
// connection guide, so the agent starts from the same facts they do. Pure and
// client-safe: every input is a display string, never an id, key or token.

export const agentBlockSteps = ["connect", "check", "request"] as const
export type AgentBlockStep = (typeof agentBlockSteps)[number]

/** A signed-in wallet's own details. Null means generic (signed out). */
export type AgentBlockAccount = {
  wallet: string
  /** Active seat names, in the order the consent screen lists them. */
  seats: string[]
  /** Admin or owner: may approve the connection and decide requests. */
  admin: boolean
  /** An active Slack install receives this wallet's approval requests. */
  slack: boolean
}

/** Guide text the blocks quote. All of it comes from docs/CONNECT.md and the MCP server. */
export type AgentBlockGuide = {
  endpoint: string
  /** MCP_DECISION_INSTRUCTIONS, verbatim: the block must not restate it. */
  rules: string
  /** Host slug to that host's setup text. */
  setup: Record<string, string>
  prompts: { check: string; request: string }
}

const SEAT_LIMIT = 8
const titles: Record<AgentBlockStep, string> = { connect: "connect", check: "check the connection", request: "request one test approval" }

// Names are typed by wallet admins and land in a prompt. Keep each on one line
// so a name cannot add lines to the block, and never echo one shaped like a key.
function label(name: string) {
  const flat = name.replace(/[\p{Cc}\s]+/gu, " ").trim().slice(0, 64)
  return /\b(?:pxy|sk)_\w/i.test(flat) ? "(name hidden: it looks like a key)" : flat || "(unnamed)"
}

function seatList(seats: string[]) {
  if (!seats.length) return "No active seats yet; one can be created on that screen."
  const shown = seats.slice(0, SEAT_LIMIT).map(label).join(", ")
  return `Active seats: ${shown}${seats.length > SEAT_LIMIT ? `, and ${seats.length - SEAT_LIMIT} more` : ""}.`
}

export function agentConnectBlock(hostSlug: string, step: AgentBlockStep, guide: AgentBlockGuide, account: AgentBlockAccount | null) {
  const host = connectionHosts.find(({ slug }) => slug === hostSlug)
  // ChatGPT has no verified connection path, so there is nothing to tell an agent.
  if (!host || host.slug === "chatgpt") return null
  // A step whose prompt is missing from the guide gets no block, not half of one.
  if (step !== "connect" && !guide.prompts[step]) return null
  const inbox = `${new URL(guide.endpoint).origin}/dashboard/approvals`
  const slack = account?.slack ? "; they also arrive in this wallet's Slack channel" : ""
  const viewer = account !== null && !account.admin

  const actingFor = account
    ? `Acting for: ${label(account.wallet)} (a Sanction wallet).${viewer ? " My role there is viewer." : ""}`
    : "Acting for: the Sanction wallet I sign in to."
  const seat = viewer
    ? `Seat: a wallet admin chooses which seat you act as on Sanction's consent screen; I cannot approve this connection. ${seatList(account.seats)}`
    : `Seat: I choose which seat you act as on Sanction's consent screen.${account ? ` ${seatList(account.seats)}` : ""}`
  const approvals = viewer
    ? `Approvals: wallet admins decide requests at ${inbox}${slack}. I cannot decide them.`
    : `Approvals: I decide requests at ${inbox}${slack}.`

  const doNow = step === "connect"
    ? `Connect to the server above. Setup for ${host.name}, for whichever of us can do it: ${guide.setup[host.slug] ?? ""}\nTell me when Sanction's sign-in and consent screen opens; that part is done in a browser. Then stop, and call no Sanction tool until I ask.`
    : step === "check"
      ? `${guide.prompts.check} If the result names a seat, tell me which one.`
      : guide.prompts.request

  return [
    `Sanction setup for ${host.name}, step ${agentBlockSteps.indexOf(step) + 1} of 3: ${titles[step]}.`,
    actingFor,
    `Server: ${guide.endpoint} (remote MCP over Streamable HTTP; sign-in is OAuth, so there is no key to paste).`,
    seat,
    approvals,
    "",
    `Do now: ${doNow}`,
    "",
    "Never ask me for an agent key, management key or token, and never display one.",
    "",
    `How to read every Sanction result (the server's own instructions): ${guide.rules}`,
  ].join("\n")
}
