# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, and /10x-impl-review.

## Feature flags must carry a kill date

- **Context**: Feature flag additions
- **Problem**: Flags without an expiry date stay in the codebase permanently. Engineers forget to clean them up after rollout, accumulating dead code paths, technical debt, and feature creep where temporary features become the default state.
- **Rule**: Every feature flag must include a kill date (calendar or milestone-based) in the flag definition or adjacent comment so the team is forced to make an explicit removal decision when the date arrives.
- **Applies to**: plan, implement, impl-review
