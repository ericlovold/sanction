import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Research agent that makes LLM calls and meters every one through Sanction's " +
    "token budget, stopping when the daily budget is exhausted.",
  model: process.env.EVE_MODEL ?? "anthropic/claude-sonnet-4.6",
});
