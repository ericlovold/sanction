import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { authenticateOwner } from "@/lib/ownerAuth"
import { POLICY_TEMPLATES, getTemplate, resolvePolicy, type PolicyShape } from "@/lib/policyTemplates"

// Owner-facing policy management. Read the current policy + the available
// templates, or apply a template (optionally with field overrides). All
// monetary fields are in CENTS. Owner-authed (x-mgmt-key) — never touches the
// agent data plane.

const cents = z.number().int().nonnegative()

const overridesSchema = z
  .object({
    daily_token_budget_usd: cents.optional(),
    daily_spend_budget_usd: cents.optional(),
    per_transaction_max_usd: cents.optional(),
    auto_approve_under_usd: cents.optional(),
    escalate_over_usd: cents.optional(),
    allowed_categories: z.array(z.string()).optional(),
    blocked_categories: z.array(z.string()).optional(),
  })
  .strict()

const putSchema = z
  .object({
    wallet_id: z.string(),
    template: z.string().optional(),
    overrides: overridesSchema.optional(),
  })
  .refine((b) => b.template || b.overrides, {
    message: "Provide a template id and/or overrides",
  })

function mapOverrides(o: z.infer<typeof overridesSchema> = {}): Partial<PolicyShape> {
  const out: Partial<PolicyShape> = {}
  if (o.daily_token_budget_usd !== undefined) out.dailyTokenBudgetUsd = o.daily_token_budget_usd
  if (o.daily_spend_budget_usd !== undefined) out.dailySpendBudgetUsd = o.daily_spend_budget_usd
  if (o.per_transaction_max_usd !== undefined) out.perTransactionMaxUsd = o.per_transaction_max_usd
  if (o.auto_approve_under_usd !== undefined) out.autoApproveUnderUsd = o.auto_approve_under_usd
  if (o.escalate_over_usd !== undefined) out.escalateOverUsd = o.escalate_over_usd
  if (o.allowed_categories !== undefined) out.allowedCategories = o.allowed_categories
  if (o.blocked_categories !== undefined) out.blockedCategories = o.blocked_categories
  return out
}

export async function GET(req: NextRequest) {
  const walletId = req.nextUrl.searchParams.get("wallet_id")
  if (!walletId) return NextResponse.json({ error: "wallet_id required" }, { status: 400 })

  const owner = await authenticateOwner(req, walletId)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const policy = await db.policy.findUnique({ where: { walletId } })
  return NextResponse.json({
    policy,
    templates: POLICY_TEMPLATES,
  })
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 })
  }

  const { wallet_id, template, overrides } = parsed.data

  const owner = await authenticateOwner(req, wallet_id)
  if (!owner.wallet) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const tpl = template ? getTemplate(template) : undefined
  if (template && !tpl) {
    return NextResponse.json(
      { error: `Unknown template '${template}'`, available: POLICY_TEMPLATES.map((t) => t.id) },
      { status: 400 },
    )
  }

  const resolved = resolvePolicy(tpl, mapOverrides(overrides))

  const policy = await db.policy.upsert({
    where: { walletId: wallet_id },
    create: { walletId: wallet_id, ...resolved },
    update: resolved,
  })

  return NextResponse.json({ policy, applied_template: tpl?.id ?? null })
}
