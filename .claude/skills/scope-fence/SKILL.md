---
name: scope-fence
description: Use on every task where you will modify existing work - code, documents, configs. Fences your changes to exactly what was asked. Adjacent problems get FLAGGED, never silently fixed. Keeps diffs minimal and reviewable. Do not use it to refuse legitimate follow-through the task actually requires.
---

# scope-fence: do what was asked, flag what you found

The most reviewable diff is the one that contains exactly the requested change and nothing else. Every unrequested improvement mixed into it costs double: the reviewer must now untangle what was asked from what was volunteered, and every extra line is a new place to introduce a regression nobody asked you to risk.

## The fence

1. **Restate the task as a boundary.** One sentence: "The task is X. The fence is: files/behavior needed for X." Write it before editing.
2. **Inside the fence: full effort.** Do X completely, including its genuine requirements (the import X needs, the test X breaks). Follow-through that X requires is IN scope.
3. **Outside the fence: eyes open, hands off.** You will see broken things - dead code, a bug in a neighboring function, an outdated comment, ugly formatting. You do not touch them. You record them.
4. **Flag, do not fix.** End your work with a FENCE REPORT:

```
FENCE REPORT
Changed: <files touched, each traceable to the task>
Noticed, NOT touched: <adjacent issue> - <why it matters> - <suggested follow-up>
```

A good fence report is a gift: the user gets the clean diff they asked for AND a map of what else deserves attention, each item now a deliberate decision instead of a surprise in the diff.

## Decision rules for the gray zone

- Would the requested change BREAK without this extra edit? Then it is in scope.
- Is it merely "while I am here"? Out. Flag it.
- Formatting churn on untouched lines (editor auto-format, import reordering)? Revert it before presenting - it is diff noise.
- Does the fix the user asked for reveal the real bug is elsewhere? Stop and say so - do not silently relocate the fence. Re-fence with the user.

## Anti-patterns this skill kills

- The 40-file diff for a one-line fix.
- The drive-by refactor that "improved" a function the task never mentioned and broke its one weird caller.
- Style opinions applied to code you were not asked to judge.
- The helpful rename that invalidated three open branches.

## The honest tension

Sometimes the adjacent problem genuinely is worse than the task. The answer is still the fence: finish X, then flag it with your recommendation, and let the human redirect you. "I noticed something worse, want me to switch?" costs one exchange. The uninvited mixed diff costs trust.
