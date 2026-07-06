// Shared caps for capability rules — one source of truth for the client policy
// editor and the server-side zod. This module has NO server imports so the
// "use client" editor can import it without pulling Prisma into the bundle.
export const MAX_CAPABILITY_RULES = 200
export const MAX_CAPABILITY_PATTERN_LEN = 120
