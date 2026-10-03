# Agent log

Append-only. Newest entries at the bottom. Read only the tail if you are continuing work.

## 2026-10-03 — Tracker → GitHub Projects parity: discovery + plan

- Created branch `feat/tracker-projects-parity` off `d1a668cb2`.
- Mapped the tracker feature. Key correction: `plugins/tracker` is declarations only;
  all UI lives in `plugins/tracker-resources`, model in `models/tracker`,
  generic view infra in `plugins/view` + `plugins/view-resources`.
- Verified the biggest gap: Huly model is **TxModel-fixed**, so user-defined custom
  fields cannot be real `core.class.Attribute`s. The `custom*` convention in
  `ViewletSetting.svelte:230` is about derived/exported column *labels*, not runtime
  attributes. Plan therefore uses a `ProjectField` definition doc + a
  `Record<string, any>` shadow prop on `Issue`.
- Verified `ViewOptions.groupBy` is already `string[]` and `groupDepth` exists in
  `ViewOptionsModel` but is hardcoded to 1 — nested grouping needs only a real builder.
- Verified `view.class.FilteredView` is already a server-persisted saved view with
  `filters` + `viewOptions` + `sharable` + `users`, but is scoped to the workspace
  alias, not a project, and cannot carry a column set.
- Plan written to `docs/tracker-projects-parity/plan.md` (8 phases, 7 architecture
  decisions, risk table).

## 2026-10-03 — Reconciled GitHub Projects research into the plan (plan REWRITTEN)

Research agent came back with verified corrections (official docs + live GraphQL schema
+ REST + `gh` CLI v2.98.0). Rewrote `plan.md` from scratch. Scope got **smaller and
sharper**, not bigger:

- GitHub has exactly **3 layouts** (Table, Board, Roadmap). No calendar, no gantt-timeline,
  no workload. Insights is a separate top-level section, not a layout.
- The view names in the screenshot (Current iteration, Next iteration, Prioritized
  backlog, In review, My items) are **NOT GitHub defaults** — GitHub ships none. They are
  community/template convention. We ship them as a seeded template.
- **No custom trigger→action automation builder** in GitHub. Only 2 built-in workflows
  + auto-add + auto-archive. Recommending a field-change webhook over a rule engine.
- Exactly **6 custom field types**: TEXT, NUMBER, DATE, SINGLE_SELECT, MULTI_SELECT,
  ITERATION. No checkbox, no people, no URL. Max 50 fields/project, 50 options/select.
- No "stack by" / nested grouping. No "Health"/"Priority"/"Estimate"/"Due date" built-ins.
  No pie charts (6 layouts: Bar/Column/Stacked bar/Stacked column/Stacked area/Line).
- Export is `.tsv`, not CSV.
- Views are **project-wide and shared** — GitHub has **no personal views**. Dropped the
  personal/shared split from the design.

**New highest-leverage decision added — D3: adopt GitHub's filter grammar** (field:/has:/no:/
is:/@me/@today/@current/@next/@previous/ranges a..b/wildcards/AND/OR+parens) as a pure
tokenizer+parser+compiler module, with TWO consumers: server-side string→DocumentQuery, and
client-side evaluation for custom fields the server cannot index. Sharing the tokenizer means
they cannot drift.

**Honest scope cut recorded — D6:** historical Insights charts (X-axis=Time, Open/Completed
series, "Burn up" default) need field-value history that Huly does not have. Options are
replay `DOMAIN_TX` (degrades), snapshot collection (correct, costly), or ship current
charts only. Recommendation: current charts only in v1. Do NOT fake burn-up with TX replay.

Phase list went from 8 to 12 and is now ordered by real dependency: fields(0-1) → views(2)
→ grammar(3) → bulk edit(4) → iterations(5) → roadmap(6) → board(7) → hierarchy/slice/sum(8)
→ insights(9) → workflows(10) → project-level roles(11).

Next: get answers on the 7 open questions in plan.md §8, then time-box Phase 0 as a
2-3 day spike to validate the custom-field-on-record design end to end.