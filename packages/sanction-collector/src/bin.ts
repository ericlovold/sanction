// Entry point: npx tsx packages/sanction-collector/src/bin.ts scan
import { main } from "./cli"

process.exitCode = main(process.argv.slice(2))
