import { defineAgent } from "eve";

// Orchestrator. Delegates demo scenarios to the four tester subagents
// (shopper, researcher, operator, redteam) and narrates what Sanction did.
// It also holds the Sanction connection itself, so it can run any scenario
// directly if you'd rather not delegate during a live demo.
export default defineAgent({
  model: process.env.EVE_MODEL ?? "anthropic/claude-sonnet-4.6",
});
