import type { Metadata } from "next"
import Link from "next/link"
import "../brand.css"
import { brandFontVars } from "../brand-fonts"

export const metadata: Metadata = {
  title: "Sanction terms of service",
  description: "Terms for using the hosted Sanction service.",
}

const sections: [string, string[]][] = [
  [
    "Service and scope",
    [
      "These terms govern the hosted Sanction service at getsanction.com, including its dashboard, APIs and hosted connectors. Sanction is operated by Sanction AI (Eric Lovold), Minnesota, United States. By using the service, you agree to these terms. If you use it for an organization, you must have authority to act for that organization."
    ]
  ],
  [
    "Your account and authority",
    [
      "You are responsible for your account, credentials, connected agents, policy settings and approval decisions. Only submit data and authorize actions you have the right to use or perform. Protect your keys and report suspected unauthorized access to eric@getsanction.com."
    ]
  ],
  [
    "What an approval means",
    [
      "Sanction evaluates requests against configured policies and records decisions. An approval is permission within that workflow, not proof that an action was executed, succeeded, is lawful or is safe. You remain responsible for reviewing the proposed action and its consequences.",
      "Connecting the approvals MCP does not intercept other tools. Enforcement depends on routing actions through an enforcing integration. Third-party hosts and services retain their own permissions, terms and availability. Disconnecting a host stops future access through that connection; it does not undo actions already taken."
    ]
  ],
  [
    "Acceptable use",
    [
      "Do not use the service for unlawful activity, access data or systems without permission, bypass tenant isolation or authorization controls, or interfere with service availability. Do not submit secrets in descriptions or tool arguments when a dedicated credential mechanism is available."
    ]
  ],
  [
    "Data and privacy",
    [
      "You retain rights to the data you submit. You permit Sanction to process it as needed to provide and secure the service, including recording decisions and delivering configured notifications. Data handling is described in our privacy policy."
    ]
  ],
  [
    "Free use and separate agreements",
    [
      "Individual use is free and does not require a payment card. Enterprise services and any paid commitments require a separate agreement. These terms do not create a paid subscription. If a signed agreement conflicts with these terms, that agreement controls for the services it covers. Source-code use is governed by the applicable repository or package license."
    ]
  ],
  [
    "Availability and changes",
    [
      "The service may change or become temporarily unavailable. Unless a separate agreement says otherwise, no service-level commitment is provided. Maintain the independent safeguards and records your use requires. Material changes to these terms will be identified on this page with an updated revision date and communicated through reasonable available means before taking effect."
    ]
  ],
  [
    "Stopping use and suspension",
    [
      "You may stop using the service and disconnect integrations at any time. Contact eric@getsanction.com to request account deletion. We may suspend access to address misuse, security threats or legal requirements. Suspension and disconnection do not reverse completed external actions."
    ]
  ],
  [
    "Warranty and responsibility",
    [
      "To the extent permitted by applicable law, the service is provided as is and as available, without warranties of uninterrupted operation, fitness for a particular purpose or error-free decisions. Nothing in these terms excludes rights or liability that applicable law does not allow to be excluded."
    ]
  ],
  [
    "Contact",
    [
      "Questions about these terms or the service: eric@getsanction.com."
    ]
  ]
]

export default function TermsPage() {
  return (
    <div className={`sanction ${brandFontVars}`} style={{ minHeight: "100vh", background: "var(--surface-page)", color: "var(--text-body)" }}>
      <header className="border-b" style={{ borderColor: "var(--paper-3)" }}>
        <nav className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
          <Link href="/" className="font-semibold tracking-tight">Sanction</Link>
          <Link href="/support" className="sanction-link text-sm">Support</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-20">
        <p className="sn-mono text-xs" style={{ color: "var(--pine-7)" }}>TERMS OF SERVICE · REVISED 7 OCTOBER 2026</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight">Terms of service.</h1>
        <p className="mt-5 text-lg leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          The responsibilities that apply when you use Sanction to govern agent actions.
        </p>
        <p className="mt-4"><Link href="/privacy" className="sanction-link">Read the privacy policy</Link></p>
        <div className="mt-14 space-y-10">
          {sections.map(([title, paras]) => (
            <section key={title}>
              <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
              <ul className="mt-3 space-y-3">
                {paras.map((p) => (
                  <li key={p} className="text-[15px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{p}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
    </div>
  )
}
