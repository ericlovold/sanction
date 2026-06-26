import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Procurement agent. Attempts purchases, subscriptions, and transfers, routing " +
    "every spend through Sanction's authorize gate (approve / escalate / deny).",
  model: process.env.EVE_MODEL ?? "anthropic/claude-sonnet-4.6",
});
