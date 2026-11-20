// The founder's note on /about, in Eric's own words. While this is null the
// page shows the founder card without a note. To publish one, replace null:
//
//   export const FOUNDER_NOTE: FounderNote = {
//     headline: "The belief, in one line",
//     paragraphs: ["What you saw.", "What you believe.", "What you won't do."],
//   }
export type FounderNote = { headline: string; paragraphs: string[] }

export const FOUNDER_NOTE: FounderNote | null = null
