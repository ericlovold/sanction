import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Operations agent that needs secrets to do its job. Obtains a scoped, " +
    "time-limited execution JWT from Sanction and injects credentials through it — " +
    "never hardcoding or storing secrets.",
  model: process.env.EVE_MODEL ?? "anthropic/claude-sonnet-4.6",
});
