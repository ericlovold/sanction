import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Adversarial tester. Deliberately attempts actions that should be blocked — " +
    "overspending, blocked categories, out-of-scope or over-clearance credential " +
    "access — and reports whether Sanction correctly stopped each one.",
  model: process.env.EVE_MODEL ?? "anthropic/claude-sonnet-4.6",
});
