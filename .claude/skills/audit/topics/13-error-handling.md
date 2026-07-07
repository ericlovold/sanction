# 13 — Error handling

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** When something fails — bad input, dead network, full disk — does
this system fail loudly and safely, or silently and weirdly?

## Investigate

- Swallowed errors: grep for empty catch blocks, `catch (e) {}`,
  `except: pass`, `.catch(() => {})`, errors logged then execution continuing
  as if nothing happened.
- Input validation at boundaries: are request bodies/params validated (schema
  layer) before use, or trusted? Try to trace one endpoint end-to-end.
- Error responses: consistent shape and status codes, or a mix of stack traces,
  strings, and default 500s? Do responses leak internals (stack, SQL, paths)?
- Retry/timeout posture: outbound calls (HTTP, DB) with timeouts? Retries with
  backoff where transient failure is expected? Anything unbounded?
- Crash consistency: partial-write hazards — multi-step mutations without
  transactions; cleanup on failure paths.
- Process-level: unhandled rejection/exception handlers; does one bad request
  kill the process?

## Amateur / AI-built signals

- Five different error-handling styles across one codebase (AI session per style).
- `console.log(error)` then proceeding to use the failed result.
- try/catch wrapping everything, catching nothing meaningfully.

## Report

Write `audit/error-handling.md` per the conventions template. Read-only.
