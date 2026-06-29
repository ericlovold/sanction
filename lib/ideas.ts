import { db } from "@/lib/db"

// Public shape of an idea — never includes authorEmail.
export type PublicIdea = {
  id: string
  title: string
  detail: string | null
  category: string | null
  status: string
  voteCount: number
}

// Published ideas only, ordered by votes. The page groups them by status.
export async function listPublishedIdeas(): Promise<PublicIdea[]> {
  const ideas = await db.idea.findMany({
    where: { isPublished: true },
    orderBy: [{ voteCount: "desc" }, { createdAt: "desc" }],
    take: 200,
    select: { id: true, title: true, detail: true, category: true, status: true, voteCount: true },
  })
  return ideas
}
