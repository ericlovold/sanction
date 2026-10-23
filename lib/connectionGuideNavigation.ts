export const connectionHosts = [
  { slug: "claude", name: "Claude" },
  { slug: "cursor", name: "Cursor" },
  { slug: "codex", name: "Codex" },
  { slug: "grok-consumer", name: "Grok (consumer)" },
  { slug: "grok-bot", name: "Grok Bot" },
  { slug: "chatgpt", name: "ChatGPT" },
] as const

const steps = ["connect", "check", "request"] as const
type Host = (typeof connectionHosts)[number]

// Fragments describe navigation only, never connection or approval status.
export function parseConnectionFragment(fragment: string) {
  const params = new URLSearchParams(fragment.replace(/^#/, ""))
  const host = connectionHosts.find(({ slug }) => slug === params.get("host")) ?? null
  const requestedStep = steps.findIndex((step) => step === params.get("step"))
  return { host, step: !host || host.slug === "chatgpt" ? 0 : Math.max(0, requestedStep) }
}

export function connectionFragment(host: Host, step: number) {
  const slug = host.slug === "chatgpt" ? steps[0] : steps[step] ?? steps[0]
  return `#host=${host.slug}&step=${slug}`
}
