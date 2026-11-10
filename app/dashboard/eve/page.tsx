import { NoWallet } from "@/components/no-wallet"
import { getViewWallet } from "@/lib/session"
import { EvePreview } from "./eve-preview"

export const dynamic = "force-dynamic"

export const metadata = {
  title: "eve preview | Sanction",
}

export default async function EvePage() {
  const view = await getViewWallet()
  if (!view) return <NoWallet />
  return <EvePreview />
}
