# Authorization conformance vectors

These versioned, synthetic fixtures pin Sanction's authorization semantics at
adapter and grant boundaries. They are regression evidence, not certification
of a host, provider, or end-to-end execution system.

```bash
npm run test:authorization-conformance
```

The tests also run in the ordinary Vitest suite and CI coverage gate. They need
no live credentials, database, external model, or running Sanction server.

## Boundaries covered

| Corpus / runner | What it checks |
|---|---|
| `tests/fixtures/authorization/adapter-v1.json` | Fixed request bodies and decision envelopes for spend, provision, tool, and capability authorization; approval checks remain distinct from permission to execute. |
| `tests/authorization-adapters.conformance.test.ts` | MCP request/response behavior across HTTP-backed calls, the real internal dispatcher, and the checked-in stdio package, including fail-closed errors. REST handlers and database reads are mocked. |
| `tests/fixtures/authorization/grants-v1.json` | Exact tool request representations, matching outcomes, identity, expiry, reuse, and competing failure conditions. |
| `tests/authorization-grants.conformance.test.ts` | Real binding/encryption and grant validation with synthetic persistence. |
| `tests/authorization-broker.conformance.test.ts` | The same binding vectors survive `tools/call` classification. The server identity represents trusted route configuration, not a field supplied by the caller. |

Expected representations and outcomes are literal fixture values. A test must
not derive its expected result by calling the implementation under test, or
merely assert that two adapters agree: both could make the same mistake.

## Representation rules

Tool bindings sort object keys recursively. Array order, value types, string
whitespace, case, and Unicode representation remain significant. Missing
arguments mean an empty object; a missing server has the binding representation
`null`. This is Sanction's current JSON representation contract, not a claim of
RFC 8785 conformance. JSON numbers are interpreted with JavaScript number
semantics; original numeric spellings and duplicate object keys are not retained
after JSON parsing.

Schema admission and binding equivalence are separate questions. A value that
can be represented by the binding helper is not necessarily admitted by every
public endpoint. Do not widen an endpoint schema to make a fixture pass.

## Extending the suite

1. Add a synthetic input and an independently reviewed expected outcome to the
   relevant JSON corpus. Preserve stable case IDs and document intentional
   semantic changes rather than regenerating golden outputs from the code.
2. Run it through the applicable adapter or validation boundary. State what is
   mocked and what executes for real.
3. Assert authority fields, verdict, reason code, and prohibited side effects.
   An error or denial must not silently become permission or consume authority.
4. If a fixture exposes a security-semantic disagreement, report it separately.
   A conformance update must not silently redefine policy to make tests green.

## Limits

This suite does not test provider UIs, OAuth consent, Slack reviewer identity,
live HTTP deployment, cross-language implementations, upstream execution, or
distributed exactly-once effects. The adapter corpus checks transport fidelity;
it does not independently prove the policy verdict supplied at its mocked API
boundary. Existing route, policy, and database tests cover those other layers.

In particular, `tests/tool-grant.db.test.ts` checks concurrent single-use
redemption against real PostgreSQL under `npm run test:db`. Mocked persistence
cannot establish that guarantee. Single-use authorization also does not prove
that an upstream action executed once or succeeded.

Hosted approval MCP remains cooperative: a host must ask and honor the result.
Broker enforcement applies only to calls routed through the broker. These
fixtures do not change either boundary or the separate frozen VERITAS contract.
