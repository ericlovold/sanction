import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { validatePolicyInvariants } from "@/lib/policy"

// Policy fields are integer cents (matches prisma `model Policy`). Body uses the
// same camelCase shape as the `policy` block in examples/policies/*.json so a
// blueprint can be applied verbatim.
const cents = z.number().int().nonnegative()
const categories = z.array(z.string().min(1).max(64)).max(64)

const policySchema = z
  .object({
    dailyTokenBudgetUsd: cents.optional(),
    dailySpendBudgetUsd: cents.optional(),
    perTransactionMaxUsd: cents.optional(),
    autoApproveUnderUsd: cents.optional(),
    escalateOverUsd: cents.optional(),
    monthlySpendBudgetUsd: cents.nullable().optional(),
    allowedCategories: categories.optional(),
    blockedCategories: categories.optional(),
  })
  .strict()

const schema = z.object({ wallet_id: z.string() }).and(policySchema)

const PUBLIC_FIELDS = {
  dailyTokenBudgetUsd: true,
  dailySpendBudgetUsd: true,
  perTransactionMaxUsd: true,
  autoApproveUnderUsd: true,
  escalateOverUsd: true,
  monthlySpendBudgetUsd: true,
  allowedCategories: true,
  blockedCategories: true,
  updatedAt: true,
} as const

// Read the current policy for a wallet (management-plane).
export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id") ?? ""
  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const policy = await db.policy.findUnique({ where: { walletId }, select: PUBLIC_FIELDS })
  if (!policy) return NextResponse.json({ error: "No policy for this wallet" }, { status: 404 })
  return NextResponse.json({ wallet_id: walletId, policy })
}

// Partial-update a wallet's policy (management-plane). Only the fields supplied
// are changed; omitted fields keep their current value. Upserts so a wallet
// without a policy row (e.g. legacy/bootstrapped) gets one with schema defaults
// plus the supplied overrides.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { wallet_id, ...updates } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No policy fields supplied" }, { status: 400 })
  }

  // Validate invariants against the post-update state (merge of current + updates),
  // so a partial patch can't leave the policy in a shape the decision engine
  // can't satisfy.
  const current = await db.policy.findUnique({ where: { walletId: wallet_id } })
  const invariantError = validatePolicyInvariants({ ...current, ...updates })
  if (invariantError) return NextResponse.json({ error: invariantError }, { status: 422 })

  const policy = await db.policy.upsert({
    where: { walletId: wallet_id },
    update: updates,
    create: { walletId: wallet_id, ...updates },
    select: PUBLIC_FIELDS,
  })

  return NextResponse.json({ wallet_id, policy })
}
