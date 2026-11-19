import "../../brand.css"
import "./connect.css"
import { brandFontVars } from "../../brand-fonts"
import { ConnectShell } from "./connect-shell"

export default function McpConnectionLayout({ children }: { children: React.ReactNode }) {
  return <div className={`sanction ${brandFontVars}`}><ConnectShell>{children}</ConnectShell></div>
}
