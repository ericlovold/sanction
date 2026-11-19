import { Markdown } from "@/components/markdown"
import { ConnectionGuideSteps, type ConnectionGuideContent } from "@/components/connection-guide-steps"
import { connectionHosts } from "@/lib/connectionGuideNavigation"

// Keep setup, limitations, and test prompts tied to the maintained guide.
function section(source: string, heading: string) {
  const lines = source.split("\n")
  const start = lines.findIndex((line) => line === heading)
  if (start < 0) return ""
  const level = heading.match(/^#+/)?.[0].length ?? 1
  const end = lines.findIndex((line, index) => index > start && new RegExp(`^#{1,${level}} `).test(line))
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim()
}

function promptFrom(source: string) {
  return source.split("\n").filter((line) => line.startsWith("> ")).map((line) => line.slice(2)).join(" ")
}

export function ConnectionGuide({ source }: { source: string }) {
  const choose = section(source, "## 1. Choose your host")
  const check = section(source, "## 2. Check the connection")
  const request = section(source, "## 3. Request your first approval")
  const redemption = section(source, "## 4. Check once, then redeem exactly once")
  const hosts = Object.fromEntries(connectionHosts.map(({ name, slug }) => {
    const row = source.split("\n").find((line) => line.startsWith(`| ${name} |`))?.split("|")
    const setup = row?.[2]?.trim()
    const evidence = row?.[3]?.trim()
    const details = name === "Cursor" || name === "Codex" ? section(source, `### ${name}`) : ""
    return [slug, {
      setup: <Markdown source={setup ?? "See the full connection reference below for setup instructions."} />,
      details: <>
        {details && <Markdown source={details} />}
        {name === "Grok Bot" && <Markdown source="Read the [Grok Bot guide](/docs/grok-bot) for OAuth and shared-account boundaries." />}
      </>,
      evidence: evidence ? <Markdown source={evidence} /> : null,
    }]
  }))
  // Only rendered content and clipboard strings cross the client boundary;
  // the markdown parser stays on the server while host/step navigation stays local.
  const content: ConnectionGuideContent = {
    intro: <Markdown source={source.split("\n## ")[0]} />,
    prerequisite: <Markdown source={choose.split("\n\n")[0]} />,
    endpoint: choose.match(/```text\n([^\n]+)\n```/)?.[1],
    hosts,
    check: { content: <Markdown source={check} />, prompt: promptFrom(check) },
    request: { content: <Markdown source={request} />, prompt: promptFrom(request) },
    redemption: { content: <Markdown source={redemption} />, prompt: promptFrom(redemption) },
    reference: <Markdown source={source} />,
  }
  return <ConnectionGuideSteps content={content} />
}
