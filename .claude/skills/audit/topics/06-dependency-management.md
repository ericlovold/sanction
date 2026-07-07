# 06 — Dependency management

Read `../conventions.md` first (severity scale, scoring, report template).

**Question:** Are the dependencies real, current, locked, and safe?

## Investigate

- Lockfile: present, committed, and in sync with the manifest? (`npm ls` /
  equivalent dry-run; flag lockfile-manifest drift.)
- Hallucinated/unused deps: cross-check every manifest dependency against
  actual imports. Flag packages never imported, and imports with no matching
  dependency (working only via transitive luck).
- Vulnerabilities: run the ecosystem's audit (`npm audit`, `pip-audit`) if
  available offline; otherwise flag notably old majors of security-critical
  packages (auth, crypto, parsers).
- Abandonment risk: pinned to deprecated or archived packages? Forks of forks?
- Version discipline: wildcard/`latest` ranges vs. sane pinning; duplicate
  packages doing the same job (two HTTP clients, two date libs).
- Supply-chain posture: install scripts, `.npmrc`/registry overrides, git-URL
  dependencies.

## Amateur / AI-built signals

- Dependencies the AI hallucinated: present in the manifest, imported nowhere,
  or worse — a typo-squat of a real package name.
- Both `package-lock.json` and `yarn.lock` committed.
- Twenty deps for a project using five.

## Report

Write `audit/dependency-management.md` per the conventions template. Read-only —
audits may run, installs/updates may not.
