# Plan: Bring `/tracker/` to GitHub Projects feature parity

Branch: `feat/tracker-projects-parity`
Status: **PLAN ONLY** — no implementation code written yet.
Research basis: official GitHub docs + live GraphQL schema + REST API + `gh` CLI v2.98.0.

---

## 0. Corrections to the naive reading of the screenshot

The reference screenshot is a **Huly-shaped wishlist**, not a literal GitHub default. Verified
against official sources:

| Common assumption | Reality (verified) |
|---|---|
| GitHub has list / calendar / gantt-timeline / workload layouts | **No — exactly 3 layouts**: `Table`, `Board`, `Roadmap`. Confirmed by the `ProjectV2ViewLayout` enum and the REST `layout` param. Insights is a **separate top-level section**, not a layout. |
| `Current iteration`, `Next iteration`, `Prioritized backlog`, `In review`, `My items` are GitHub default views | **UNCONFIRMED — GitHub ships none of these.** A blank project gets one view of the layout you picked. Those names are community/template convention. We will ship them as a **template**, which is legitimate — GitHub has templates, it just doesn't document the view names. |
| Users can build custom trigger→action automations | **No.** Only 2 fixed built-in workflows + auto-add + auto-archive. `ProjectV2Workflow` exposes only `id/number/name/enabled`. Automation otherwise goes through **GitHub Actions** via the `project_v2_item` webhook. |
| CSV export | **`.tsv`**, called "Export view data". |
| "Health", "Priority", "Estimate", "Due date" are built-in fields | **No.** `Estimate`/`Priority`/`Health` are *custom* fields users create. There is no `DUE_DATE` in `ProjectV2FieldType`. |
| "Stack by" / nested grouping / collapsed groups | **Not documented.** GraphQL has `groupByFields` + `verticalGroupByFields` but no nesting semantics. Grouping is single-level. |
| Health/insights charts include pie/donut/quadrant | **No.** Exactly 6 layouts: Bar, Column, Stacked bar, Stacked column, Stacked area, Line. |

**Consequence:** the scope below is *smaller and sharper* than a naive "all GitHub features" list.

---

## 1. Where the code actually is (correction to the premise)

`plugins/tracker` is **declarations only** (3 files, 925 lines). It is not where the UI is.

| Package | What it holds |
|---|---|
| `plugins/tracker` | `Issue`/`Project`/`Milestone`/`Component` interfaces + `plugin()` id registry |
| `plugins/tracker-assets` | Icon sprite + 14 locale JSONs |
| **`plugins/tracker-resources`** | **All real UI** — ~250 files, Kanban + Gantt + item drawer |
| `models/tracker` | `TIssue` model, viewlet/column registry, filters, actions, migrations |
| `plugins/view`, `plugins/view-resources` | Generic viewlet host, `FilterBar`, `ViewletSetting`, `ViewOptions` |
| `packages/kanban`, `packages/gantt`, `packages/panel` | Reusable primitives |

---

## 2. Verified gap analysis

✅ present · ⚠️ partial · ❌ absent

### 2.1 Views

| Capability | Status | Where / note |
|---|---|---|
| Table layout | ⚠️ `view.viewlet.Table` exists but bound only to `Project` | register it for `Issue` |
| Board layout | ✅ | `KanbanView.svelte` (570 lines) |
| **Roadmap layout** | ❌ | Huly has a Gantt instead — different thing, no Start/Target field pairing, no markers, no Month/Quarter/Year zoom |
| **View tabs** | ❌ | `ViewletSelector` renders *viewlet types*, not saved views |
| `+ New view` | ❌ `tracker.component.Views` id declared but never registered | `plugin.ts:535` |
| Per-view column set | ❌ one global `ViewletPreference` per viewlet | `ViewletSetting.svelte:455` |
| Per-view filter as a **string** | ❌ stored as JSON `Filter[]` blob | `FilteredView.filters: string` (JSON, not a grammar) |
| **Unsaved-changes dot + Save changes** | ❌ | |
| Duplicate / Rename / Delete / Reorder view | ❌ | |
| Per-view layout switch | ⚠️ layout is bound to the viewlet | |
| Views shared project-wide | ⚠️ `FilteredView` has `sharable` + `users[]` — GitHub has **no personal views** at all | simplify |
| Views scoped to a project | ❌ `attachedTo` is the workspace alias | |

### 2.2 Fields

| Capability | Status | Note |
|---|---|---|
| Fixed `Issue` schema | ✅ | `models/tracker/src/types.ts:186-296` |
| **User-defined custom fields** | ❌ **biggest gap** | no `FieldDefinition` doc anywhere in the repo |
| TEXT / NUMBER / DATE custom fields | ❌ | |
| SINGLE_SELECT custom (max 50 options, colors, description) | ❌ | |
| MULTI_SELECT custom | ❌ | |
| ITERATION custom field | ❌ | no `Iteration` class. Dead `{sprint:1}` index at `index.ts:812` |
| Sub-items (parent issue + sub-issue progress) | ✅ strong | `attachedTo` + `parents` + `childInfo` |
| **Hierarchy display** (tree, expand/collapse ≤8 levels, state persists) | ❌ Huly has sub-issue *editing* but no tree *display* with persisted expansion | GA 2026-03-19, default ON for new views |
| Field limits (50 fields/project, 50 options/select) | ❌ | must enforce |
| Field default values for new items | ❌ | shipped 2026-04-09 |
| Org-level shared fields | ❌ | |
| Field reorder + row reorder | ⚠️ `sortable: true` on 1 of 11 viewlets | `viewlets.ts:956` |
| **Field sum** (Σ of number fields, per group) | ❌ | |
| Per-field notifications | ⚠️ hardcoded array | `models/tracker/src/index.ts:194-200` |

### 2.3 Board

| Capability | Status | Note |
|---|---|---|
| Column field = any single-select | ⚠️ column = group value of `groupBy[0]` | needs a dedicated `columnField` option |
| Column field = **iteration** field | ❌ | |
| **Swimlanes** (`group by` on a board = horizontal sections) | ❌ | shipped 2023-07-27 |
| Per-column **card limits** (advisory, per view) | ❌ | |
| Show/hide columns | ⚠️ | |
| Card fields governed by the view's field list | ❌ card body hardcoded | `KanbanView.svelte:414-509` |
| "Sorted board ⇒ no manual reorder in column" | ⚠️ Huly writes `rank` only when `orderBy === Manual` | already close |

### 2.4 Filtering

| Capability | Status | Note |
|---|---|---|
| Filter bar + chips + 7 per-type editors | ✅ | |
| Keyword search + scope + highlight | ✅ | |
| Filter **grammar**: `field:`, `has:`, `no:`, `is:`, `label:`, `assignee:`, `@me`, `@today`, `@current`, `@next`, `@previous`, `@k±n`, ranges `a..b`, `*` wildcards, `AND`/`OR` + parentheses | ❌ | advanced search GA 2026-07-16 |
| Click a card value to filter | ❌ | |
| `(N) matching items` counter | ⚠️ `resultIssueCountStore` exists | |
| Slice-by panel | ❌ | |

### 2.5 Item editing

| Capability | Status | Note |
|---|---|---|
| Item detail drawer | ✅ rich (439 + 268 lines) | |
| Inline cell editors per field | ✅ good | |
| **Spreadsheet-style bulk edit**: copy/paste cells, fill handle, multi-select, `Shift`+arrows, `Delete` to clear, Undo toast | ❌ | Huly bulk actions are ~12 fixed action types |
| Draft items (real project items until converted) | ❌ Huly's `IssueDraft` is transient popup state | |
| Archive (restorable) | ⚠️ `hideArchived` exists | |
| Row height / density | ❌ | shipped 2026-06-25 |
| Item limit 50,000 | ❌ | |

### 2.6 Iterations

| Capability | Status | Note |
|---|---|---|
| Iteration field | ❌ | |
| 3 auto-created iterations on field creation | ❌ | |
| Duration in days/weeks, editable name, breaks | ❌ | |
| `@current` / `@next` / `@previous` filter keywords | ❌ | |
| Bulk "Move items to…" | ❌ | |
| Rollups (count, done count, estimate sum) | ⚠️ `IAggregationManager` exists, unused for this | |
| Project **status updates** (`ON_TRACK`/`AT_RISK`/… + body) | ❌ | separate feature |

### 2.7 Insights

| Capability | Status | Note |
|---|---|---|
| Charts over project items | ❌ | |
| 6 layouts (Bar, Column, Stacked bar/column/area, Line) | ❌ | |
| Config: X-axis field, Group-by field, Y-axis (Count or Sum/Avg/Min/Max of a number field), filter | ❌ | |
| **Historical charts** (X-axis = Time; Open / Completed / Closed PRs / Not planned; default "Burn up") | ❌ | **blocked — needs a field-value history model; Huly has none** |
| Archived items excluded | ⚠️ | |

### 2.8 Workflows

| Capability | Status | Note |
|---|---|---|
| Built-in: issue closed → status Done | ⚠️ Huly has status categories but no such rule | |
| Built-in: PR merged → status Done | ❌ no PR model | stretch |
| Auto-add (repo + filter) | ❌ n/a — no repo concept. Huly analogue: auto-add sub-issues of a type into a project | |
| Auto-archive (filter) | ❌ | |
| `ProjectV2Workflow` doc (name, enabled) | ❌ | |
| `@github-project-automation` attribution | ❌ | `tx.modifiedBy` analogue |
| `project_v2_item` webhook with `changes.field_value` | ❌ | Huly has `TxUpdateDoc` in `DOMAIN_TX` — reusable |
| Custom trigger→action builder | ❌ **and out of scope** — GitHub does not have it | |

### 2.9 Project-level

| Capability | Status | Note |
|---|---|---|
| **Per-project roles** (base No access/Read/Write/Admin + collaborators) | ❌ Huly is a flat `members: AccountUuid[]` | |
| Project settings page with field sidebar | ❌ | |
| Project description + Markdown README | ❌ | |
| Project templates (carry views, fields, workflows, insights) | ❌ | |
| Project visibility public/private | ❌ | |
| Tracker-specific permissions | ⚠️ exactly 1 (`ForbidCreateProject`) | |

### 2.10 What we already have — do not rebuild

`packages/gantt` (time scale, zoom, viewport, drag, working-days calendar) ·
`packages/kanban` (drag columns, rank) · `view.mixin.Groupping` + `IAggregationManager` ·
`view.class.FilteredView` (server-persisted; extend it) · `view.mixin.ClassFilters` + 7 filter
components · `ViewletSetting`/`ViewletClassSettings` (column UI) · sub-issue hierarchy +
`ControlPanel` attribute loop · `gantt/lib/scheduler.ts` · 33 Gantt test files as the house
testing pattern · `tests/sanity/tests/tracker/*` for e2e.

**Huly already exceeds GitHub** (not parity work, protect these from regression): per-item Gantt
rows, dependency arrows (FS/SS/FF/SF + lag), critical path, cascade scheduling with undo, working
days + HR holidays, time-spend reports, PDF/PNG export, kanban swimlane zoom, estimation reports.

---

## 3. Architecture — the seven decisions

### D1 — Custom fields: registry doc + shadow record on the item

**Constraint:** the model is **TxModel-fixed**. `core.class.Attribute` docs are generated by the
model build and pushed via `TxModel` at server upgrade — you cannot create an attribute at
runtime. So a user-defined field can never be a real `Attribute`. (The `custom*` convention in
`ViewletSetting.svelte:230` and `converter-resources/*` concerns derived/exported column *labels*
and is not a runtime-attribute mechanism.)

**Design:**

```
tracker.class.ProjectField              (DOMAIN_TRACKER, space = the Project)
  label: string
  key: string                // generated slug, unique per project, e.g. "storyPoints"
  type: ProjectFieldType     // Text | Number | Date | SingleSelect | MultiSelect | Iteration
  position: number
  project: Ref<Project>
  description?: string
  defaultValue?: any         // Text/Number/SingleSelect only — Date does NOT support it (GitHub parity)
  // SingleSelect / MultiSelect:
  options?: ProjectFieldOption[]   // { value, label, color, description }   max 50

tracker.class.Issue += @Prop(TypeRecord()) customFields: Record<string, any>
```

Exactly the **6** `ProjectV2CustomFieldType` values. No checkbox, no people, no URL — those do not
exist in GitHub Projects.

**Options considered**

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. `Record<string, any>` prop on `Issue`** (chosen) | 1 prop, 1 migration, values ride every query, notifications/aggregators read them, presenter is trivial | not server-indexable per key → custom-field filter/sort/group runs client-side | ✅ v1 |
| B. `IssueFieldValue` AttachedDoc collection | server-indexable, scales past 100k | 1 query per field read, N per row to hydrate, breaks the single-fetch query model | ⏳ scale path |
| C. Shadow scalars `custom_<key>` on `Issue` | Mongo-indexable | one global index per key, impossible to create at runtime; unbounded prop sprawl | ❌ |

**Mitigation for A's limit:** a configured ceiling `TRACKER_CUSTOM_FIELD_SCAN_LIMIT` (default
5000). Above it, custom-field filter/sort/group is **disabled with an explicit UI error**, never
silently truncated. Fail fast, not a silent throttle.

**Enforce at the model level:** ≤50 fields per project, ≤50 options per select field.
Where? A server trigger on `ProjectField` create — the last line of defence against a bad client.

**Plugs in at**
1. `models/tracker/src/projectField.ts` — `ProjectField` + `ProjectFieldOption` (new file, keeps
   `types.ts` from bloating)
2. `TIssue.customFields` prop + migration in `models/tracker/src/migration.ts`
3. `tracker.aggregation.ProjectFieldRegistry` — an `IAggregationManager`-shaped resource so
   presenters resolve key→definition without each re-querying
4. `CustomFieldPresenter.svelte` reads `issue.customFields?.[field.key]`
5. Per-type editors: `Text`, `Number`, `Date`, `SingleSelect`, `MultiSelect`, `Iteration`
6. Detail panel: the generic attribute loop at `ControlPanel.svelte:236-266` renders it free
7. `CustomFieldFilter.svelte` + `tracker.function.BuildCustomFieldQuery` → client-side predicate

### D2 — Saved views: extend `FilteredView`, do not build a parallel concept

GitHub views are **project-wide and shared** — "when a view is saved, anyone who opens the project
will see the saved view". There are **no personal views**. So drop the personal/shared split.

```ts
// plugins/view/src/types.ts:110 — additive fields only
export interface FilteredView extends Doc {
  // ...existing: name, location, filters, viewOptions, filterClass, viewletId, sharable, users, createdBy, attachedTo
  project?: Ref<Project>                   // NEW — scope to a project space
  config?: (BuildModelKey | string)[]      // NEW — ordered visible field list (GitHub: visibleFieldIds)
  cardProperties?: string[]                // NEW — board: which fields show on cards
  descriptor?: Ref<ViewletDescriptor>      // NEW — the layout (table | board | roadmap)
  columnField?: string                     // NEW — board column field
  order?: number                           // NEW — tab order (GraphQL: POSITION)
  icon?: Asset                             // NEW
  filterText?: string                      // NEW — GitHub's view filter is a STRING (see D3)
  groupBy?: string[]                       // NEW — GitHub stores grouping on the view, not in localStorage
  sortBy?: [string, SortingOrder][]        // NEW
  fieldSum?: string[]                      // NEW
  sliceField?: string                      // NEW
  hierarchy?: boolean                      // NEW — show sub-issue tree
  rowHeight?: RowHeight                    // NEW — Single|Medium|Tall|ExtraTall
  columnLimits?: Record<string, number>    // NEW — advisory per-column caps
  dirty?: boolean                          // NEW — unsaved-changes dot
}
```

**Deliberate removal:** personal/shared distinction. Keep the fields for back-compat but stop
using them; new views are always shared. Do not add per-view ACLs — GitHub has none.

**Two-sources-of-truth problem (critical):** `ViewOptions` is persisted in **localStorage**
(`view-resources/src/viewOptions.ts:47-62`) while `FilteredView` is a **server doc**.
Rule: **an active saved view is authoritative**; localStorage is the fallback for ad-hoc state.
Expose exactly one accessor, `getEffectiveViewConfig()`, that all views read. Otherwise this
will produce drift bugs that are very hard to debug.

**UI:** `plugins/view-resources/src/components/view/SavedViewBar.svelte` (tab bar + `+ New view` +
per-tab kebab: rename / duplicate / delete / drag-to-reorder + unsaved dot) and
`CreateViewPopup.svelte`.

**Template:** seed GitHub-style views (`Current iteration`, `Next iteration`, `Prioritized
backlog`, `Roadmap`, `In review`, `My items`) via an `OnProjectCreate` trigger. Be honest in the
code comment: these are *our* template names, not GitHub defaults (GitHub ships none).

### D3 — Adopt GitHub's filter grammar, compile to `DocumentQuery`

This is the highest-leverage decision. GitHub stores a view's filter as a **string** in a real
grammar; Huly stores a JSON blob of `Filter[]`. Porting the grammar gives us, for free:
`field:` · `has:` · `no:` · `is:` · `label:` · `assignee:` · `milestone:` · `type:` ·
`sub-issues.is:` · `@me` · `@today[-Nd]` · `@current` · `@next` · `@previous` · `@k±n`
arithmetic · `>` `>=` `<` `<=` · inclusive ranges `a..b` with `*` wildcards · `title:"..."` ·
comma = OR, repeat = AND, quoted values · and `AND`/`OR` + parentheses (GA 2026-07-16).

Design: **one grammar, two consumers** — a client compiler string → `DocumentQuery<Issue>`
for server-side fetch, and a client-side evaluator for custom fields (D1) which the server cannot
index. Both share the tokenizer and the operator semantics, so they cannot drift.

Deliver as a small, well-tested module: `plugins/view-resources/src/filter/grammar/{tokenizer,parser,compile,evaluate}.ts`
with jest tests. Reusable by every future view — this is the DRY seam.

Note the documented GitHub limitation we should *beat*: OR across fields was unsupported until
2026-07-16. We should support it from day 1.

### D4 — Iterations

```
tracker.class.Iteration           (DOMAIN_TRACKER)
  project: Ref<Project>
  field: Ref<ProjectField>        // owning iteration field
  label: string
  number: number
  startDate: Timestamp
  duration: number               // days (GitHub: duration + startDay, same idea)
  status: IterationStatus        // Planned | Active | Closed
  isBreak?: boolean
```

Plus `@Prop(TypeRef(Iteration)) iteration?: Ref<Iteration> | null` + `@Index(IndexKind.Indexed)`
on `TIssue` and an index entry `{iteration: 1}`.

- Creating an Iteration **field** auto-creates **3 iterations** (GitHub parity).
- `@current` / `@next` / `@previous` resolve against `startDate` + `duration`.
- Breaks supported (a break is an iteration with `isBreak`).
- Iteration is usable as a **board column field** and as the **Roadmap Start/Target date source**.
- Rollups via the existing `IAggregationManager` seam.

Iteration fields are self-contained (no Gantt/Kanban dependency) so Insights and Workload can use
them too. Do **not** subclass `Milestone` — Milestone has different semantics.

### D5 — Roadmap as the third layout

GitHub's Roadmap is **not** a Gantt. It is a single high-level bar chart:
- **Start date** + **Target date** fields chosen per view; each may be a **date field or an
  iteration field**
- **Markers**: vertical lines for iterations, item dates, milestones (togglable)
- **Zoom**: Month / Quarter / Year
- Drag an item → changes its dates or its iteration
- Group by / Sort / Slice by / Field sum all behave as in Table
- **No per-item rows, no dependency arrows**

Build it as a new `ViewletDescriptor` + component. **Reuse** `packages/gantt/time-scale.ts` for
the Month/Quarter/Year math and viewport; **do not** reuse `GanttView.svelte` (4893 lines — do not
grow it) and do not reuse `lib/build-rows.ts` (it builds per-item rows, the opposite of what
Roadmap wants). New files only.

The existing Gantt stays as a Huly-only extra view. Roadmap and Gantt are separate descriptors
with separate icons so users can tell them apart.

### D6 — Insights, and the history problem

Chart model: 6 layouts (Bar, Column, Stacked bar, Stacked column, Stacked area, Line). Config:
layout, X-axis field, Group-by field, Y-axis (`Count` or `Sum`/`Average`/`Minimum`/`Maximum` of a
number field), filter string (D3 grammar). Archived items excluded.

**The blocker:** *historical* charts set X-axis = Time and need series `Open` / `Completed` /
`Closed PRs` / `Not planned` (default "Burn up"). Huly has **no field-value history** — `TxUpdateDoc`
lives in `DOMAIN_TX` and is not designed to be queried as a time series over arbitrary fields.

Options:
- **A.** Query `DOMAIN_TX` for `TxUpdateDoc` on `tracker.class:Issue` and replay. Cheap to build,
  but `DOMAIN_TX` is the transaction log — queryable but unindexed for this shape, and long
  retention is not guaranteed. Fine for MVP; will degrade.
- **B.** Snapshot model: a nightly/rolling `tracker.class.IssueFieldSnapshot` collection
  (issue × date × field values). Correct, bounded, queryable, but adds real storage and a
  backfill story.
- **C.** Skip historical charts in v1; ship current charts only, honestly.

**Recommendation:** C for the first ship, then B if the burn-up chart proves valuable. Do **not**
ship A pretending it is B. This is the one place where honest scope reduction beats a clever
implementation.

UI: `InsightsPanel` reached from a graph icon in the project header (matching the screenshot's
`Insights` button). Note GitHub has **no API for charts** — charts are UI-only. We get to choose;
persisting chart configs as docs is strictly better and cheap.

### D7 — Workflows: built-ins only, not a builder

GitHub ships no custom trigger→action builder. So:

```
tracker.class.Workflow        (DOMAIN_TRACKER)
  project, name, enabled: boolean
  kind: WorkflowKind          // SetStatusDoneOnClose | MoveSubIssuesIntoProject | AutoArchive
  config?: Record<string, any>
```

- **`SetStatusDoneOnClose`** — when an Issue's `status` category becomes `done`/`canceled`, ensure
  the Done status option is set. Semantically near-trivial in Huly (status *is* the field), so this
  reduces to "optionally auto-set the Done status when the underlying issue is closed".
- **`AutoArchive`** — a filter string (D3 grammar) + cadence; archives matching items. Archived
  items keep all field values and stay restorable (`hideArchived` already exists).
- **`AutoAddFromQuery`** — Huly's analogue of GitHub's repo-scoped auto-add: a filter string that
  pulls matching issues into the project. No repo concept needed.
- Attribution: automation tx carry a marker so timelines show the change as automated
  (`tx.modifiedBy` analogue of `@github-project-automation`).

**Explicitly out of scope:** a general trigger→action builder. If we want it, GitHub Actions +
a `project_v2_item`-equivalent webhook is the parity-faithful route — Huly already writes
`TxUpdateDoc` into `DOMAIN_TX`, so a webhook on field-value change is a much smaller lift than
a rule engine, and it gives users the full power of code. **Recommend the webhook over the
builder**, and say so in the plan.

---

## 4. Phasing

Each phase ships independently and ends green. **No phase starts before the previous phase's
`rushx build` + `rushx _phase:validate` + unit tests pass.**

| # | Phase | Ships | Why this order |
|---|---|---|---|
| **0** | **Custom-field foundation** | `ProjectField` doc, `customFields` record, registry resource, CRUD UI, editors, detail-panel rendering, limits enforced | Load-bearing. Insights, Workload, field-sum, per-view columns and workflows all aggregate over fields. Nothing else is worth building first. |
| **1** | **Custom fields as columns** | Optional columns, filter, client-side sort, group-by-select, `sortable: true` for column drag-reorder | Makes fields usable in views |
| **2** | **Saved views + tabs** | `FilteredView` extension, `SavedViewBar`, `+ New view`, per-view columns, unsaved dot, rename/duplicate/delete/reorder, `getEffectiveViewConfig()`, default-view template | The single biggest UX jump; unblocks per-view everything |
| **3** | **Filter grammar** | Tokenizer/parser/compiler/evaluator, `@`-keywords, ranges, wildcards, AND/OR + parens, click-value-to-filter, `field:` addressing | Unblocks per-view filters and auto-archive |
| **4** | **Spreadsheet-style bulk edit** | Cell multi-select, `Shift`+arrows, copy/paste, fill handle, `Delete` to clear, Undo toast, row + column drag-reorder, row height | Table becomes genuinely spreadsheet-like |
| **5** | **Iterations** | Iteration field, 3 auto-created, duration/breaks, `@current/@next/@previous`, board column field, rollups, bulk move | Powers `Current iteration` / `Next iteration` views |
| **6** | **Roadmap layout** | New descriptor + component, Start/Target field pairing, markers, Month/Quarter/Year zoom, drag-to-reschedule | Completes the 3-layout parity set |
| **7** | **Board parity** | Column field (select *or* iteration), swimlanes via group-by, per-column advisory limits, show/hide columns, card fields from the view's field list | Depends on 2 + 5 |
| **8** | **Hierarchy + slice + field sum** | Sub-issue tree display ≤8 levels with persisted expansion (default on), slice-by panel, Σ number fields per group | Depends on 2 |
| **9** | **Insights (current charts only)** | 6 layouts, config panel, persisted chart docs, archived excluded | Honest v1; historical/burn-up is a separate decision (D6) |
| **10** | **Workflows (built-ins)** | `Workflow` doc, Done-on-close, auto-archive, auto-add-by-query, automation attribution, field-change webhook | Deliberately last — it writes data |
| **11** | **Project-level** | Settings page with field sidebar, description + README, templates, status updates | Workspace-level roles only (decision 5) |

**Recommended first slice: Phases 0 + 1.** Time-box Phase 0 to a 2–3 day spike to validate D1 end
to end (create field → set value → read in detail panel → render as column) before committing to
the roadmap.

**Scope extras (reinstated by the user, 2026-10-03):** Calendar view, Workload view, nested/stacked
grouping ("stack by"), and a custom trigger->action automation builder were first dropped because
GitHub Projects does not have them. The user decided they **stay in scope**: the tracker should be
at least as good as the GitHub board. They are scheduled as phases 12-15 *after* GitHub parity
(phases 0-11) so they never compete with parity work. Still out of scope: per-field permissions,
personal views, pie/donut charts, historical insights / burn-up (see D6).

| # | Extra phase | Notes |
|---|---|---|
| **12** | Calendar layout | Date-field driven, reuses saved-view infrastructure from phase 2 |
| **13** | Workload layout | Per-assignee capacity vs. Estimate/Iteration, depends on phases 0 and 5 |
| **14** | Nested grouping | Multi-level group-by in Table and Board; extends the group-by from phases 1 and 7 |
| **15** | Automation builder | Trigger->action rules on top of the phase 10 workflow doc; field-change webhook ships in phase 10 |

---

## 5. Files this touches

**New packages:** none. `models/tracker` additions only, unless Phase 6/9 forces a split.

**New files (representative)**

```
models/tracker/src/projectField.ts          # ProjectField + ProjectFieldOption
models/tracker/src/iteration.ts             # Iteration
models/tracker/src/workflow.ts              # Workflow + kinds
plugins/tracker/src/projectField.ts          # interfaces + ProjectFieldType enum (6 values)
plugins/tracker/src/iteration.ts
plugins/tracker/src/workflow.ts
plugins/tracker-resources/src/projectFields/{registry,CrudPopup,optionsEditor}.ts|svelte
plugins/tracker-resources/src/projectFields/editors/{Text,Number,Date,SingleSelect,MultiSelect,Iteration}Editor.svelte
plugins/tracker-resources/src/components/roadmap/{RoadmapView,RoadmapMarkers,RoadmapToolbar}.svelte
plugins/tracker-resources/src/components/insights/{InsightsPanel,ChartConfigPanel,charts/*}.svelte
plugins/tracker-resources/src/components/workflows/{WorkflowsPopup,WorkflowEditor}.svelte
plugins/tracker-resources/src/components/iterations/{IterationBrowser,IterationEditor,IterationSelector,IterationRollupPresenter}.svelte
plugins/view-resources/src/components/view/{SavedViewBar,CreateViewPopup,ViewTab,CardFieldRenderer}.svelte
plugins/view-resources/src/filter/grammar/{tokenizer,parser,compile,evaluate}.ts   # D3 — pure, heavily tested
plugins/view-resources/src/utils/nested-groups.ts                                   # keep (harmless) or drop
server-plugins/tracker-resources/src/project/on-project-create.ts                 # seed default views
server-plugins/tracker-resources/src/workflow/{on-workflow-evaluate,on-field-change}.ts
```

**Modified (hot spots — expect conflict risk)**

- `models/tracker/src/types.ts` — `+customFields`, `+iteration`, `ProjectField`/`Iteration`/`Workflow` classes
- `models/tracker/src/viewlets.ts` — Roadmap descriptor, `issueConfig`, group/sort/filter whitelists
- `models/tracker/src/migration.ts` — `customFields` backfill, `iteration` backfill
- `models/tracker/src/index.ts` — indexes, notification types, permissions, limits trigger
- `models/tracker/src/plugin.ts` — ids + `IntlString`s
- `models/view/src/index.ts` + `plugins/view/src/types.ts` — `FilteredView`
- `plugins/view-resources/src/viewOptions.ts` — `getEffectiveViewConfig()` precedence rule
- `plugins/tracker-resources/src/components/issues/KanbanView.svelte` — column field, swimlanes, card refactor
- `plugins/tracker-resources/src/components/issues/IssuesView.svelte` — `SavedViewBar` in header
- `plugins/tracker-resources/src/components/issues/edit/ControlPanel.svelte` — custom-field rows
- `plugins/tracker-assets/lang/*.json` — 14 locales; key parity enforced by an existing test

---

## 6. Risks

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| 1 | **TxModel-fixed schema** blocks runtime attributes | 🔴 blocking | D1 record-on-item; field *definitions* are data |
| 2 | Custom-field filter/sort/group must be client-side | 🔴 high | Configurable `TRACKER_CUSTOM_FIELD_SCAN_LIMIT`; fail fast above it |
| 3 | `ViewOptions` in **localStorage** vs `FilteredView` on the **server** = two sources of truth | 🔴 high | Explicit precedence + one `getEffectiveViewConfig()` accessor |
| 4 | Scope creep into non-GitHub features (calendar, workload, rule engine) | 🔴 high | §0 lists what was dropped and why; Phase budget table has none of them |
| 5 | Historical Insights charts need a model that does not exist | 🟠 med-high | D6: ship current charts, decide B (snapshots) separately. Never fake it with `DOMAIN_TX` replay |
| 6 | Modifying `models/view` (`FilteredView`) touches every plugin | 🔴 high | Additive fields + migration; full `rush build` before merge |
| 7 | `KanbanView.svelte` card body hardcoded | 🟡 med | Refactor in Phase 2 before card config lands in Phase 7 |
| 8 | 14-locale key parity enforced by tests | 🟡 med | Every `IntlString` added to all locales in the same change |
| 9 | `IssuesView.svelte` deliberately never unmounts the viewlet (virtual-scroller starvation) | 🟡 med | `SavedViewBar` must swap via the existing `viewlet` binding — no overlay mount |
| 10 | `GanttView.svelte` is 4893 lines | 🟡 med | Do not grow it. Roadmap is new files; only time-scale moves to `packages/gantt` |
| 11 | Automations write data | 🟠 med-high | Built-ins only, attribute to a system actor, cap per run, dry-run flag in config |
| 12 | ~~Per-project roles~~ dropped (workspace-level only) | - | No `core` permission changes |
| 13 | Unmeasured phase estimates | 🟡 med | Phase 0 is a time-boxed spike; re-estimate after |

---

## 7. Validation strategy (per phase)

```bash
cd <pkg> && rushx test            # unit tests
cd <pkg> && rushx build && rushx _phase:validate   # the required gate
rush build --to <pkg>             # cross-package type check before PR
# NEVER run rushx format automatically — repo rule, it can corrupt files
```

- Pure logic (grammar, nested groups, query compiler, rollups, limit guards) gets a jest file
  next to it, matching `gantt/lib/__tests__/`.
- New layouts get an e2e spec in `tests/sanity/tests/tracker/`.
- Locale parity is already covered by `plugins/tracker-assets/src/__tests__/lang*.test.ts` — it
  fails the build if a new `IntlString` misses a locale. Use it as a checklist.
- Model changes need a `@Migration` step in `models/tracker/src/migration.ts` **and** a test in
  `models/tracker/src/__tests__/migration.test.ts` (existing pattern to copy).

---

## 8. Decisions (resolved by the user, 2026-10-03)

1. **Scope** - Calendar, Workload, nested grouping and the automation builder **stay in scope**
   (phases 12-15, after parity). Goal: the tracker alone is as good as a GitHub board.
2. **Default view names** - follow GitHub Projects behaviour (a new project starts with one view of
   the chosen layout). Named views (`Current iteration`, etc.) are an optional template only.
3. **Project size** - follow GitHub Projects limits (50,000 items per project, 50 custom fields,
   Insights/field limits as in GitHub). Option B (separate collection) is not needed at launch;
   enforce these limits and set `TRACKER_CUSTOM_FIELD_SCAN_LIMIT` accordingly.
4. **Historical insights / burn-up** - out of scope (maybe later).
5. **Roles** - workspace-level only. Per-project roles are dropped from phase 11.
6. **Automation** - field-change webhook first (phase 10); rule builder later (phase 15).
7. **Merge strategy** - one large PR. Phases are still built and validated sequentially on this
   branch (build + `_phase:validate` + tests green before the next phase starts).

---

*Append-only. Next entry should record the Phase 0 spike result.*

---

## Phase 5 implementation notes (Iterations)

**Deviations from D4**

- **No `TIssue.iteration` prop.** An issue's iteration is the iteration id stored in
  `issue.customFields[field.key]`, like every other custom field (D1). A project can therefore have several
  Iteration fields, each with its own iterations, and no model migration or index is needed. The cost is the
  same as for all custom fields: filter/sort/group run on the client over the scanned issues.
- **`tracker.class.Iteration` has no `project` prop**: `space` is the project (D4 says the same). `field`
  references the owning `ProjectField`. `number` is the ordinal for default titles (`Iteration 4`), 0 for breaks.
- **No stored status.** `getIterationState(iteration, now)` derives `planned | current | completed` from
  `startDate` + `duration` (whole local days; `end` is the last millisecond of the last day).
- Default duration of a new iteration is not stored on the field: it is the duration of the last iteration
  (a week when there is none). The creation form asks for the duration (days or weeks) and the first start date
  (default today) and creates three consecutive iterations together with the field in one `client.apply` batch
  (`generateInitialIterations`).

**Behaviour**

- Changing the duration or start date of an iteration moves all later iterations (and breaks) by the same
  number of days, so gaps stay; a start that would run into the previous iteration is rejected (`planIterationChange`).
  Adding appends after the last item; "Insert break after" inserts a break (`isBreak`, not assignable, not
  offered in editors/groups/filters, ignored by `@current/@next/@previous`) and shifts what follows.
  Deleting leaves the other dates alone; the server (`OnIterationRemove`) strips the id from issues. Removing
  the field or the project removes its iterations. Completed iterations are listed in their own collapsible section.
- Editor: single-select popup, current iteration marked, `No iteration`; presenter shows the title with the date
  range as tooltip. Cell paste accepts titles and `@current/@next/@previous[+-N]`.
- Filter: `iteration:@current`, `@next`, `@previous`, `+/-N`, `>@current`, titles (grammar callback is wired to the
  project's iterations); the legacy custom-field filter has an any-of rule with the three keywords plus iterations.
- Sort by iteration start date; group by iteration (calendar order, `No <field>` last). The group header shows the
  date range, count, done count (status category Won) and estimation sum (`computeIterationRollups`), plus a menu
  `Move items to...`.
- View extension additions (`ClientViewExtension`): optional `extraProjection` and `getGroupExtras`.

**Remaining gaps / not done**

- "Move items to..." moves the items of the group as currently shown (respects the active filter), not every
  item of the iteration in the project.
- Board column field and Roadmap date source from iterations are Phase 7 / 12 (the data and pure helpers exist).
- Iteration settings are saved per edit, not with the form's Save button; no undo.
- Not exercised in a running UI or e2e (no sanity spec added); verified by jest, `rush validate`, `svelte-check`.
- `rush validate --from @hcengineering/tracker` fails only in `@hcengineering/prod` on type errors in earlier
  phase files (`view-resources` filter grammar parser/compile and `tableEdit`), unrelated to this phase.


---

## Phase 6 implementation notes (Roadmap layout)

**What was built**

- Third layout `Roadmap` (`tracker.viewlet.Roadmap` descriptor, `tracker.viewlet.IssueRoadmap` viewlet, icon
  `tracker.icon.Roadmap`, component `tracker.component.RoadmapView`). It is offered by `SavedViewBar` next to Table and
  Board (`viewLayouts` of `IssuesView`), and appears in the generic viewlet selector like the Gantt does.
- New files only; `GanttView.svelte` is untouched. Pure logic is in `plugins/tracker-resources/src/roadmap/`
  (`timeScale`, `dates`, `layout`, `markers`, `reschedule`, `config`, `label`, `grouping`, `customValue`) with jest tests
  next to it (also run under four time zones). UI is in `components/roadmap/` (`RoadmapView`, `RoadmapToolbar`,
  `RoadmapOptionsPopup`).
- Date sources (stored as ids in the view): `issue:startDate|dueDate|deadline`, `milestone:startDate|targetDate`
  (read only), `field:<key>` (custom Date field), `iteration:<key>` (an Iteration field: start = first day of the
  iteration, target = its last day). Each view picks a start and a target source (default start date / due date).
- Item rendering: both dates -> bar (an inverted start/target is drawn from the earlier to the later day with a hatch);
  one date -> marker; none -> listed in a collapsible "Unscheduled" section at the bottom, with a "Set dates" button
  (date picker) and click-on-timeline to put the item on a day.
- Zoom Month / Quarter / Year (header: months over weeks, quarters over months, years over quarters), today line,
  Today button, horizontal and vertical scroll with a sticky title column and sticky header, rows are windowed.
- Markers menu: milestones (flag at the target date), iterations of chosen Iteration fields (line at the start, shaded
  span), dates of items of chosen date sources (busiest 100 days). Fields menu: what the label of an item contains
  (identifier, title, status, assignee, priority, labels, component, milestone, estimation, custom fields).
- Drag the bar = move both dates keeping the duration (timestamps keep their time of day); drag an edge = write only
  that date, clamped so the range keeps at least one day. Iteration sources snap to the iteration whose first (start)
  or last (target) day is closest, so dragging an item over an iteration field moves it to another iteration.
  Milestone dates are read only: an item that takes a date from its milestone cannot be moved (a toast says so), the
  other edge can still be resized. Markers can be moved, not resized. Esc cancels a drag. Every change is one
  `EditJournal` batch of Phase 4 (`tableEdit.updateOp` + `runIssueOps`) and shows an "Undo" toast.
- Group by and Sort by reuse the generic view options (Customize View): model keys `status, kind, assignee, priority,
  component, milestone` plus custom/iteration keys through the existing `clientViewExtension` (category order comes from
  the extension). The view starts ungrouped: `ViewOptionsModel.defaultGroupBy` is a new optional field (additive) that
  `getViewletDefaultOptions` and `ViewletSettingButton` honour.

**Per-view config and dirty tracking**

- The roadmap settings (`start`, `target`, `zoom`, `markers`, `fields`) live in the view options under the key
  `roadmap`. The saved view already stores, restores and diffs `viewOptions`, so nothing in `SavedViewBar` had to change
  for saving, "unsaved changes" or discarding. The default config is not stored (`withRoadmapConfig`), so a view that
  was never customized stays clean and changing a setting back clears the dot (covered by a test through
  `isViewDirty`). Group-by and sort-by are the normal `viewOptions.groupBy/orderBy` of the same object.
- Settings that point at something deleted (a removed field) are dropped from the displayed config
  (`sanitizeConfig`) but are not rewritten in the saved view.

**Deviations / decisions**

- `packages/gantt` `time-scale.ts` was not reused: it only knows Day/Week/Month/Quarter zooms and computes in UTC,
  while the roadmap needs Month/Quarter/Year and has to agree with iterations and Date fields, which are local days.
  The roadmap has its own small local-day axis (`timeScale.ts`).
- The table "config" columns do not apply to a roadmap; "Configure columns" is hidden for this layout and the Fields
  menu of the roadmap replaces it.
- No `rank`-based manual ordering and no slice-by / field-sum (Phase 8).
- GitHub's docs do not describe single-date items, unscheduled items or resizing; the behaviour above (marker,
  Unscheduled section, edge resize) follows the task brief.

**Not done / limits**

- At most 5000 items are loaded; above that a notice is shown (not silently cut). No auto-scroll while dragging near
  the edge of the viewport; no keyboard rescheduling.
- Group headers are plain text (no avatars/status icons); item labels are plain text.
- Drag to reschedule of a group header value (changing the group) is not supported.
- Not exercised in a running UI or e2e (no sanity spec added): verified by jest, `rush validate` and `svelte-check`.
