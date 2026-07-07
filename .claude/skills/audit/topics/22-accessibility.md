# 22 — Accessibility

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Can people using assistive tech, keyboards, or imperfect vision
actually use the UI? (WCAG 2.1 AA lens; code-level audit.)

If the project has **no user-facing UI**, say so, score N/A with a one-line
report, and stop.

## Investigate

- Semantics: real elements (`button`, `nav`, `label`, headings in order) vs.
  div-soup with click handlers; forms with associated labels; images with
  meaningful `alt`.
- Keyboard: interactive elements reachable and operable (no `div onClick`
  without key handling/tabindex); focus styles not stripped
  (`outline: none` with no replacement); modals trapping and restoring focus.
- ARIA: used correctly and sparingly — flag `aria-*` misuse and redundant
  roles; live regions for async updates (toasts, validation errors).
- Contrast & color: obvious low-contrast token pairs in the palette (check the
  design tokens/theme file); color as the only signal for state.
- Dynamic behavior: error messages announced or only painted; loading states;
  motion/animation without `prefers-reduced-motion` respect.
- Tooling: any a11y lint (eslint-plugin-jsx-a11y, axe) configured and passing?

## Amateur / AI-built signals

- Every "button" is a styled div.
- alt="image" on all images, or none at all.
- A11y linter installed by the scaffold, rules disabled where they complained.

## Report

Write `audit/accessibility.md` per the conventions template. Read-only.
