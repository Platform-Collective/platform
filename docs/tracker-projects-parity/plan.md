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


---

## Phase 7 implementation notes (Board parity)

**What was built**

- Pure logic in `plugins/tracker-resources/src/board/` with jest tests next to it: `config` (the `board` settings block,
  column field resolution), `columns` (columns and swimlanes of a custom field), `swimlanes` (the swimlane x column grid),
  `limits` (advisory column limits), `move` (what a drop writes), `cardFields` (what a card shows).
- UI in `components/board/`: `CardFieldRenderer` (the card body, replaces the hardcoded body of `KanbanView.svelte`),
  `BoardColumnHeader` (count/limit, column menu), `BoardLanes` (swimlanes), `HiddenColumnsPanel`, `DimensionTitle`,
  `BoardOptionsSection` (board rows of the Customize View popup).
- `KanbanView.svelte` was reworked around a column axis and an optional swimlane axis; without swimlanes it still renders
  the shared `packages/kanban` board (keyboard navigation and manual rank are unchanged), with swimlanes it renders `BoardLanes`.

**Behaviour (GitHub Projects board)**

- Column field: Status (default), Assignee, Priority, Component, Milestone, any single-select custom field or any Iteration
  field. Chosen in Customize View ("Column field"). Custom/iteration columns list every option (every iteration, in calendar
  order, breaks left out) even when empty, and "No <field>" is the first column. A drop writes the status / the attribute /
  `customFields[key]` (an option id or an iteration id; "No <field>" clears it). The "+" of a column creates the issue with
  the column's value (`CreateIssue` got an optional `customFields` prop for that).
- Swimlanes = the "Group by" of the view (Customize View > Grouping, same as GitHub). Single level; a built-in attribute or
  a custom field (the client view extension keys are now offered for every layout, they used to be offered to the table only).
  Lanes without cards are dropped unless "show empty groups" is on; "No <field>" is the last lane. A lane can be collapsed.
  Dropping a card on a cell writes the column value and the lane value in one update (`resolveDropUpdate`). Group by the same
  field as the columns is ignored. A new board starts without swimlanes (`defaultGroupBy: '#no_category'` on the Kanban viewlet).
- Column menu (header "..."): Hide column, Set / Edit / Remove column limit. The limit is advisory and per column: the header
  shows `count/limit`, and a column over its limit is tinted red; nothing stops a drop. Limits count the cards of the column
  over all swimlanes. Typing 0 removes a limit; closing the popup without a number leaves it alone.
- Hidden columns leave the board and are listed in a "Hidden columns" area at its right edge with a Show button; Customize View
  has "Show hidden columns (n)" and "Clear column limits (n)".
- Card fields follow the view's field list (Configure columns, saved per view): assignee, sub-issues, priority, component,
  milestone, due date, labels, estimation, attachments, comments and every custom/iteration field (shown when the issue has a
  value). The chips follow the order of the list. The title, identifier, status marker, parent and notification marker are
  always shown. The default list is the old look (`assignee` was added to the Kanban viewlet config for this).
- Sorting: manual rank is written only when the sort is Manual (unchanged); in swimlane mode there is no manual order inside a cell.

**Per-view config and dirty tracking**

- `columnField`, `columnLimits` and `hiddenColumns` live in the view options under the key `board` (the same precedent as
  `roadmap`; limits and hidden columns are kept per column field). The saved view already stores, restores and diffs
  `viewOptions`, so the effective config, the unsaved dot and discard work with no change in `SavedViewBar`; the default config
  is not stored, so a changed-and-changed-back board is clean again (covered by a test through `isViewDirty`). The swimlane
  field is the normal `viewOptions.groupBy` of the same object.
- A column field that no longer exists (a deleted custom field) shows the status columns; the saved value is kept.

**Shared code touched (additive)**

- `packages/kanban`: `KanbanRow`/`Kanban` take an optional `getGroupQuery` (full documents of a column by ids, for columns that
  are not a plain attribute); `KanbanRow` is exported.
- `view-resources`: `ViewOptions` / `ViewOptionsButton` / `ViewletSettingButton` take an optional `extra` / `extraOptions`
  component shown after the generic rows of the Customize View popup (it reports changes with `update`, like the rows do); an
  option set to `undefined` is deleted from the options instead of stored. The client view extension keys are offered to any layout.

**Deviations / decisions**

- Swimlanes reuse the generic Group by instead of a second control, so on a board Grouping no longer means "columns". A
  board whose localStorage options hold an old group-by other than the status now gets swimlanes by that field.
- `columnField` / `columnLimits` are not new `FilteredView` props (D2 lists them): the view options block carries them like the
  roadmap settings, which keeps one place for per-view layout state.
- In swimlane mode the whole board scrolls, column headers and lane headers are sticky; there is no per-column scroll.
- "No assignee/component/milestone" columns and lanes now accept drops (they write `null`); before, such a drop was refused.
- Collapsed swimlanes are not persisted (session only).
- The hook for column totals (`columnTotal` in `KanbanView.svelte`, shown by `BoardColumnHeader` as `total`) is unset; Phase 8
  will provide the sum of a number field.

**Not done / limits**

- Not exercised in a running UI or e2e (no sanity spec added): verified by jest, `rush validate --to @hcengineering/prod`
  and `svelte-check` of tracker-resources, view-resources and kanban.
- The legacy `ViewletPreference` of the Kanban viewlet (a user's own column choice) does not contain `assignee`, so those users
  see cards without the avatar until they switch it on.
- A drop on a lane/column whose category has no value for the project of the card (status of another project) is refused.


---

## Phase 8 implementation notes (Hierarchy, Slice by, Field sum)

**What was built**

- Pure logic with jest tests next to it. `plugins/view-resources/src/hierarchy.ts` (generic tree rows: nesting, expansion, depth
  cap, cycles, large lists) and in `plugins/tracker-resources/src/`: `hierarchy/` (`config`, `expansion`, `progress`;
  `expansionStore.ts` is the svelte store on top of `expansion`), `slice/` (`config`, `fields`, `values`, `sums`) and `fieldSum/`
  (`config`, `sum`; `load.ts` only translates the estimation label).
- UI: `components/slice/{SlicePanel,IconSlice}`, `components/fieldSum/{FieldSumGroupSummary,FieldSumFooter}`,
  `components/view/ProjectViewOptionsSection` (the rows that `IssuesView` adds to the "Customize view" popup: board section,
  Hierarchy toggle, Field sum toggles). `IssuesView`, `KanbanView`, `RoadmapView` and `BoardColumnHeader` were extended.
- Strings (10) were added to `tracker.string` and to all 14 locale files of `tracker-assets` by plain text insertion (ru
  translated, the others English); `view-assets` needed none (the expander tooltip text comes from the host).

**Behaviour**

- Hierarchy (Table only). Sub-issues are nested under their parent with a chevron (up to 8 levels, deeper issues follow as
  top level rows right after their tree). Collapsed by default; the expanded rows are kept per viewer and per view in local
  storage (`tracker.hierarchy.expanded.<project>.<viewId>`, at most 2000 ids). The tree is built per group over the issues the
  view shows: an issue whose parent is not in that group (filtered out, other group, other page of the filter) is a top level
  row and keeps showing the parent name, so nothing is lost; an issue is shown once. Sort order is kept among siblings. The
  chevron tooltip and the existing sub-issues button of the row show the progress `done of total` (direct sub-issues, all of
  them, whether the view shows them or not; done = status category Won or Lost, the same rule as the button). The tree needs
  the whole group, so the list loads up to the scan limit per group in this mode. Drag-to-rank is off while the tree is on.
  It needs the "Sub-issues" view option to be on (root-only lists have nothing to nest).
- Opt-in per saved view: `viewOptions.hierarchy === true`. Absent = off, so views saved before and the unsaved default view
  stay flat. A new Table view (and a view whose layout is switched to Table) starts with it on (`SavedViewBar` got the optional
  props `newViewOptions` and `activeViewId`). Off is not stored, so on-then-off leaves the view clean.
- Slice by (Table and Roadmap; no button on Board and Gantt). Toolbar button next to the filter button opens a left panel
  with a field menu and the values of the field with counts, `All items` and `No <field>`. A click chooses a value (a second
  click on the only chosen one goes back to All), Cmd/Ctrl-click adds or removes values. Fields: status, priority, assignee,
  labels, component, milestone and the single select, multi select and iteration custom fields. The counts are over what the
  view shows without the slice itself (filter string and chips applied), the slice narrows the result on top of it (AND). The
  values of custom fields are all listed (also with 0), built-in ones only when in use, and a chosen value is always listed.
  Stored as `viewOptions.slice = { field, value: string[] }` (`field` is the filter name of a built-in or `customFields.<key>`,
  `value` empty = All, `__none__` = "No <field>"; the key exists while the panel is open). Deleted options are dropped from the
  effective choice, a deleted field falls back to the first one; neither rewrites the saved view.
- Field sum. The "Customize view" popup lists Estimation and every Number custom field with a toggle; stored as
  `viewOptions.fieldSums: string[]` (`estimation`, `customFields.<key>`). Shown: in every group header of the Table (not on
  an ungrouped table, as on GitHub), in the group headers of the Roadmap, in the board column headers (`columnTotal` hook of
  Phase 7), in the slice panel next to the counts, and as a footer below Table and Roadmap with the total of the whole view.
  Only the issues the view shows are summed (filter, search and slice applied); values that are not finite numbers are
  ignored (`NaN`, text, empty), the sum is compensated and printed with at most 2 decimals.
- Scan limit (`TRACKER_CUSTOM_FIELD_SCAN_LIMIT`). Slice counts and the narrowing use the same bounded scan as the custom field
  filters; above the limit the panel says so and the slice is not applied. The hierarchy checks the size of the view with a
  count query and is turned off above the limit with a banner; the footer shows a note instead of a total. Group header sums
  and board totals read the documents the list already holds.

**Shared code touched (additive, opt-in)**

- `ClientViewExtension` got the optional `hierarchy` and `groupSummary`; the list reads them only when the view options of the
  list turn the feature on (`hierarchy` / `fieldSums` keys), so the sub-issues list of an issue, related issues and every other
  embedded list are unaffected although the extension store is global.
- `ListCategory` builds the tree rows, `ListItem` has an optional `tree` prop (chevron + indent, emits `toggle-tree`), `ListHeader`
  renders the optional summary, `List` projects the properties the summary reads. `SavedViewBar` has the two props above.

**Deviations / decisions**

- GitHub's docs do not describe grouping together with the hierarchy beyond "preserved"; here a child whose parent is in another
  group is shown flat in its own group.
- Slice and field sums are stored in the view options (the precedent of `roadmap` / `board`), not as `FilteredView.sliceField` /
  `fieldSum` props of D2: one place for the per-view layout state, and saving, restoring and the unsaved dot work unchanged.
- The columns of the table shift right by one rem per level of the tree (the chevron cell is the first cell of the row); the
  identifier/title columns are not re-aligned.
- Progress in the row is the existing sub-issues button; the chevron adds the tooltip. No separate progress column was added.

**Not done / limits**

- No expand all / collapse all, no keyboard expand/collapse, no drag to re-parent. Arrow-key navigation follows the existing
  order logic of the list, which is not aware of the tree rows.
- Hierarchy on the Roadmap and Board is not offered.
- The slice panel cannot be resized, has no search box, and slices by custom Text, Number and Date fields are not offered.
- Not exercised in a running UI or e2e (no sanity spec added): verified by jest (tracker-resources, view-resources,
  tracker-assets), `svelte-check` of view-resources and tracker-resources and `rush validate --to @hcengineering/prod`. The layout
  of the slice panel and of the footer in the page flex chain is by reasoning, not by eye.


---

## Phase 9 implementation notes (Insights, current charts)

**What was built**

- Model: `tracker.class.InsightChart` (`DOMAIN_TRACKER`, `space` = project; `name`, `layout`, `xField`, `xBucket?`, `groupField?`,
  `yAggregate {type, field?}`, `filter`, `position`). Types in `plugins/tracker/src/insightChart.ts`, class `TInsightChart` in
  `models/tracker`, the class id is declared once in `plugins/tracker` (`tracker.class.InsightChart`), strings in the tracker-resources
  `plugin.ts`. `xBucket` is an addition to the brief: it is the day/week/month size of a date X-axis. `OnProjectRemove`
  (`server-plugins/tracker-resources`) removes the charts of a removed project (jest test next to the existing trigger tests). No
  `@Migration` step: a new class in an existing domain has nothing to migrate.
- Pure logic with jest tests in `plugins/tracker-resources/src/insights/`: `config` (layouts, normalization, dirty tracking, edits,
  resolving a config against the project's fields), `fields` (what each project field can be: category / date / number), `aggregate`
  (buckets, series, Count/Sum/Average/Minimum/Maximum, "No <field>", ordering, date buckets), `build` (fields -> request for the
  aggregation), `drill` (filter string behind a bar), `layout` (scales, ticks, bars, lines, areas in pixels), `colors`. Tests also run
  under four time zones (dates are local days, like iterations).
- UI in `components/insights/`: `InsightsPanel` (page: charts sidebar, filter bar, chart, configuration), `ChartConfigPanel`,
  `charts/ChartCanvas` (SVG, written in-repo; no chart library exists in the repo), `charts/ChartLegend`, `IconInsights`. `IssuesView`
  got an "Insights" button in the project header (`header-tools` slot).
- Strings (50) were added to `tracker.string` and to all 14 locale files by plain text insertion (ru translated, the others English).

**Behaviour (GitHub Projects Insights, current charts)**

- The page covers the project view (its own header has the way back); the view keeps its state, so unsaved view changes survive
  opening Insights. The page lists the charts of the project; a project without charts shows the default chart "Issues by status"
  (Column, X = Status, Count). The default chart is virtual and is stored the first time it is saved, renamed, duplicated or when a
  chart is added. (The GitHub default "Burn up" is a historical chart and is out of scope, D6 option C.)
- Chart menu (the "..." of a chart or right-click): rename, duplicate (`X (copy)`), delete (with confirmation). `+ New chart` adds
  `Chart N` with the default configuration. The selected chart is remembered per viewer and project (local storage).
- Configuration panel: Layout (exactly Bar, Column, Stacked bar, Stacked column, Stacked area, Line), X-axis, Group by (optional),
  Y-axis (Count of items, or Sum / Average / Minimum / Maximum of a number field: the estimation or a Number custom field), a bucket
  size (Day / Week / Month) when the X-axis is a date, and the filter string bar above the chart (the Phase 3 `FilterQueryBar`).
  X-axis and Group by: status, priority, assignee, labels, component, milestone and the single select, multi select and iteration
  fields (text and number fields are not offered). A date field (due date, start date, deadline, Date custom fields) can be the
  X-axis of a Line or Stacked area only; switching to another layout moves the X-axis back to the first category field.
- Bar and Column with a group-by draw the series side by side, the stacked layouts stack them (negative values stack downwards), Line
  draws a line per series, Stacked area stacks the areas. Labels: items with several values (labels, multi select) count in each of
  them; items without a value are in a last "No <field>" bucket / series (neutral color); the options of the project's own fields are
  all listed (also with 0), the options of the others (status of another type, people, labels) only when used. Statuses follow the
  workflow order, people / labels / components / milestones are alphabetical, iterations calendar order. Weeks start on Monday.
- Y aggregates: the count counts every item; the others use the items that have a finite number in the field (anything else is
  ignored); a bucket with no numbers has no value for average / minimum / maximum (a gap, not a 0), 0 for the sum.
- Date axis: every bucket from the first item to the last is drawn (empty ones are 0 / a gap); beyond 1000 buckets only the buckets
  that have items are drawn. Items without a date are the last "No <field>" point: on a Line it is a separate marker, on a Stacked area
  a stacked column next to the areas (they cannot be joined to the dates).
- Unsaved changes: the draft is compared with the saved chart (`isChartDirty`; filter whitespace and an unused bucket are not changes,
  a change that is changed back is clean again). A dot shows on the chart in the sidebar and the toolbar offers Discard changes,
  Save to new chart and Save changes. A saved chart that changes elsewhere is taken unless the draft has changes of its own.
- A field that was removed from the project (X-axis, group-by, Y number field) falls back (first category field / no grouping / count)
  with a notice; the saved chart is not rewritten. A filter that no longer parses is not applied and the chart is not drawn.
- Scan limit: the chart is computed over a scan of the project's issues (server-narrowed by the indexable part of the filter, the rest
  evaluated on the client) capped at `TRACKER_CUSTOM_FIELD_SCAN_LIMIT` + 1. Above the limit an explicit message is shown and nothing is
  drawn (never a truncated chart). Archived projects' issues are not scanned (the usual `findAll` rule).
- Hover shows a tooltip (category, series, value, item count); the marks are focusable (Enter / Space activate) and carry a text
  label; the chart has a text description. Click a bar, point or segment: the project view opens with that bucket's filter (the
  chart's filter AND `field:value`, or `no:field`, or a day range for a date bucket); view chips, legacy custom field rules and the
  slice are cleared for that, so the view shows exactly the issues behind the number. The result is an unsaved change of the active
  saved view (Discard brings the old filter back).

**Deviations / decisions**

- Group by also accepts the same field set as the X-axis (category fields only; a date cannot be a series), and cannot repeat the
  X field. GitHub's docs do not say which layouts support Group by; here all six do.
- The "popup list of the filtered items" (optional in the brief) was not built; the click goes to the project view instead.
- Charts are not scoped per user: any member who can edit the project can save, rename and delete them (like saved views); a
  read-only viewer (`restrictionStore.readonly`) sees the controls disabled / hidden.
- The configuration panel is on the right, the filter above the chart (as on GitHub); below 60rem the three columns stack.

**Not done / limits**

- Historical charts (X-axis = time, burn up) are not built and not faked (D6).
- No pie / donut, no chart export, no reordering of charts by drag (they follow `position`; duplicate / new append).
- Not exercised in a running UI or e2e (no sanity spec added): verified by jest (tracker-resources, tracker-assets,
  server-tracker-resources, model-tracker), `svelte-check` of tracker-resources and `rush validate --to @hcengineering/prod`,
  `--to @hcengineering/model-tracker`. Layout of the page in the panel (absolute overlay), the tooltip position and the colors are by
  reasoning, not by eye.


---

## Phase 10 implementation notes (Built-in workflows, archive, field-change webhook)

**What was built**

- Archive. `Issue.archivedAt?: Timestamp | null` (hidden `TIssue` prop; `null` after a restore). Huly's `hideArchived` is about archived
  *projects*, so it was not reusable. Pure helpers in `plugins/tracker/src/archive.ts`. Actions `Archive` / `Restore`
  (`tracker.action.ArchiveIssue` / `RestoreIssue`, `input: 'any'`, so they work on the context menu and on a bulk selection; Archive is shown
  for issues without `archivedAt`, Restore for archived ones). "Archived items" popup (restore / delete one, restore all / delete all, first 200
  rows, count of the rest) from the project header and from the project settings. Archived items keep every value.
- Grammar (`view-resources/src/filter/grammar`): `is:archived` (and `-is:archived`), `mentionsArchived`, `archiveScopeQuery`. GitHub's rule is
  applied: archived items are left out of the project views, slice, counts, field sums, hierarchy and Insights unless the filter mentions
  archived items, in which case the filter alone decides. `IssuesView` adds `archivedAt: null` to the server query (everything that scans, counts
  or sums derives from it); `InsightsPanel` does the same for the chart scan. `updated:` (the time of the last change, `modifiedOn`) was
  missing and was added to the filter schema (`updated:<@today-2w`); it is not offered as a chart axis.
- Filter schema moved: `buildIssueFilterSchema` / `fieldFilterName` now live in `plugins/tracker/src/issueFilterSchema.ts` (types repeat the
  shape of the grammar's `FieldSpec`); `tracker-resources/issueFilter.ts` re-exports them. The server needs the same schema for workflow
  filters. `buildWorkflowFilterSchema` (same file family, `workflow.ts`) is that schema without labels and with English priority names.
- Workflow doc `tracker.class.Workflow` (`DOMAIN_TRACKER`, `space` = project): `name`, `enabled`, `kind`, `filter?`, `config?` (`target`),
  `runRequestedAt?`. Kinds: `setStatusDoneOnClose`, `itemReopened`, `itemAdded`, `autoArchive`, `autoAddFromQuery`. One doc per kind (the
  oldest wins if two clients created one at once). A kind without a doc has its defaults (virtual, like the default Insights chart), so there
  is no migration and no project-create trigger.
- Server (`server-plugins/tracker-resources`): sync trigger `OnIssueWorkflow` (item workflows), async trigger `OnWorkflowEvaluate` (filter
  workflows), async trigger `OnProjectItemWebhook`, sync trigger `OnProjectWebhookRemove`; `OnProjectRemove` also removes workflows, webhooks
  and the secrets of the webhooks. UI: `WorkflowsPopup` (toggle per workflow, field / value pickers, filter bar with the Phase 3
  `FilterQueryBar` and a preview count) and `WebhooksPopup`, both opened from the project settings (the edit-project popup).
- Strings (62) were added to `tracker.string` and to all 14 locale files by plain text insertion (ru translated, the others English).

**Workflow semantics and defaults (GitHub parity, with the Huly deviations)**

- Item closed / Item reopened / Item added to project. GitHub writes its separate Status field. Huly's issue status already *is* the
  open/closed state, so these workflows write a **single-select custom field** (the Status field analogue): closed = the issue status
  moves from an open category to done or canceled (Won / Lost category) -> field = Done; reopened = it moves from a closed to an open
  status -> field = the default open value (`Todo`, `To do` or `Open`); added = a new issue gets `Todo` unless it already has a value. The
  target is automatic (the first single-select field called `Status` that has such an option) or chosen in the form (`config.target`);
  a chosen target that disappears makes the workflow do nothing, never fall back. Without a target nothing happens. Defaults like GitHub:
  these three are **on**, Auto-archive and Auto-add are **off** and need a filter before they can be switched on. The previous status is
  rebuilt from the transaction history (`history.ts`), a move between two closed statuses is not a close.
- Auto-archive. Archives the not archived issues that match the filter. Default text for a new workflow: `is:closed updated:<@today-2w`.
  Items that already match are archived when it is switched on (GitHub does the same). A filter that is empty, does not parse, is over 1000
  characters or mentions archived items is skipped (and the form says so), never guessed at. Restoring an item bumps `modifiedOn`, so an
  `updated:` filter does not archive it again at once.
- Auto-add. GitHub pulls matching issues of a repository into the project. Huly has no repository, an issue belongs to exactly one project and
  moving it renumbers it (identifier, rank, status mapping), which would have to be redone on the server and is destructive. So the workflow
  **never moves or copies anything**. Its Huly analogue restores archived items of the project that match the filter (the inverse of
  Auto-archive). To keep the two from undoing each other, an item that the project's Auto-archive would archive again is not restored
  ("archive wins"). Documented in the form.
- Caps and idempotency. A filter workflow reads at most 2000 issues per run (oldest first) and changes at most 100 per run per workflow
  (`MAX_WORKFLOW_ITEMS_PER_RUN`); a backlog is worked off over several runs. The filter is always evaluated again on the scanned issues on the
  server (the database query is only a narrowing), so the result does not depend on how much of the filter the database can take. Every
  write is skipped when the value is already there, so repeating a run changes nothing.
- Loop protection and attribution. Every write of a workflow is authored by the system account (`core.account.System`, passed as
  `modifiedBy` of the transaction) and a workflow never reacts to a transaction authored by it (`isAutomationAuthor`). The activity timeline
  shows an unknown author as "System"; there is no separate "Project automation" label in the timeline (the webhook payload does say
  `sender.type = Automation`, `name = Project automation`).
- When filter workflows run. The server has no periodic runner (triggers are transaction driven; the periodic code lives in separate
  services), so they are evaluated (1) when a workflow doc is created or changed, (2) after an issue of the project changes, at most once a
  minute per project (`control.cache`), (3) when a client opens the project: it touches `runRequestedAt` of the stored, enabled filter
  workflows once per session. **Limitation:** a project in which nothing happens and nobody opens does not age items into a filter until one of
  those happens.
- Workflow filters use the vocabulary of the project views minus labels (a label is a separate document per issue). Priorities are named in
  English whatever the language of the viewer (`priority:urgent`), because the server does not translate. `@me` has no meaning on the server.

**Field-change webhook (parity with `projects_v2_item`)**

- No webhook facility existed (the love / payment / github hits are inbound webhooks), so a minimal one was built: docs
  `tracker.class.ProjectWebhook` (`space` = project: `url`, `enabled`, `events`, `hasSecret`) and `tracker.class.ProjectWebhookSecret`.
  At most 20 per project (UI check, and the server only uses the 20 oldest).
- Events (the `action` of GitHub's event): `created`, `edited`, `archived`, `restored`, `deleted`. `edited` is one delivery per changed field
  with `changes.field_value = { field_node_id, field_name, field_type, from, to }` (`from` rebuilt from the history; select-like values are
  `{ id, name }`, dates ISO strings). Watched: title, status, priority, assignee, component, milestone, estimation, start / due date,
  deadline and every custom field (by type: text, number, date, single_select, multi_select, iteration). Payload keys: `action`,
  `project_item`, `changes`, `project`, `workspace`, `sender`, `delivery`. Headers: `X-Huly-Event: project_item`, `X-Huly-Delivery`,
  `X-Huly-Signature-256: sha256=<hex HMAC SHA-256 of the exact body>` (only when a secret is set; verified against GitHub's published
  reference vector in the tests).
- Delivery. Async trigger, so it never delays the transaction, and the deliveries are not even awaited by it: they run in the background
  (5 at a time, 5 s timeout, one retry after 1 s for a network error, timeout, 5xx or 429, none after another answer). Changes made by the
  workflows are delivered too (they are in the operation's transactions). At most 100 events per run, payload bounded to 64 KiB (values are
  dropped first, the field stays named). There is **no persistent queue**: a delivery in flight when the server stops is lost, and there is no
  delivery log or redelivery UI.
- Security model.
  - SSRF: https only, no credentials in the URL, internal host names and private / loopback / link-local (cloud metadata) / CGNAT /
    multicast / reserved IPv4 and IPv6 ranges are refused, IPv6 addresses that embed IPv4 (mapped, NAT64, 6to4) are judged by the IPv4 part.
    The same pure validator runs in the form and on the server. On the server the name is resolved by the socket's own `lookup`, every
    address must be public, and the connection goes to the address that was checked (no second resolution, so no DNS rebinding); an IP
    in the URL is checked directly; redirects are never followed; the answer body is never read. A refused target is never retried.
    `TRACKER_WEBHOOK_ALLOW_PRIVATE=true` (development only) allows http and local targets. This uses Node's `http(s).request` with a custom
    `lookup`, not `fetch` (a `fetch` call cannot be pinned to a checked address); the tests mock the transport.
  - Secret: it is typed once, stored as `ProjectWebhookSecret` in the **personal space** of the person who typed it (no other member of the
    project can read it, the server can), the webhook doc only carries `hasSecret`, and the form never shows a secret again (an empty
    field keeps the current one; a new one is a new doc and the newest wins, so setting one rotates it). The secret is not in any payload
    or header. Residual risks: the author can read their own secret doc through the API, and the old secret docs of a rotation stay in the
    author's personal space until the webhook is removed (removing a webhook or a project removes all of its secrets).
  - Who can configure: any member who can write the project's docs (same as saved views and charts). The data a webhook receives is data
    its configurer can read anyway.

**Shared code touched**

- `server-plugins/tracker-resources` now depends on `@hcengineering/view-resources` (deep import of the pure filter grammar,
  `@hcengineering/view-resources/src/filter/grammar`, no svelte is loaded; the same pattern as `model-tracker` importing
  `tracker-resources/src/types`), on `@types/node`, and uses the `node` tsconfig profile (node modules are used for crypto / dns / http).
  `pnpm-lock.yaml` was edited by hand for these two (no network install was possible); run `rush update` to confirm it is stable.

**Verified / not verified**

- Verified: jest (tracker 112, tracker-resources 922, view-resources 290, server-tracker-resources 101, tracker-assets 15, model-tracker 4),
  `svelte-check` of tracker-resources and view-resources, `rush validate --to @hcengineering/prod` (also `model-server-tracker` and
  `server-tracker-resources`).
- Not verified: nothing was run against a real server or in a browser (no sanity spec). In particular the trigger registration in a running
  pipeline, the notifications that a System authored issue update may produce, the layout of the three popups, delivery over a real
  network, and the bundling of the server with the deep grammar import. The `archivedAt` / workflow queries were checked only against the
  in-memory test double.

**Not done / limits**

- No rule builder (phase 15) and no per-workflow history or run log.
- Archived items still show in places that do not use the project issues view: the sub-issue list of a parent, the lists of a component or
  a milestone, search, links, notifications, and the hierarchy progress count (it counts every sub-issue, archived or not).
- A parent that is archived does not archive its sub-issues.
- The number of webhooks per project is also checked only by the form and the delivery (no server guard that removes the extra ones).


---

## Phase 11 implementation notes (Project-level features)

**What was built**

- Pure logic in `plugins/tracker/src` with jest tests: `projectStatus` (status enum, `ProjectStatusUpdate`, validation, latest update,
  who may edit), `projectSettings` (limits, `isProjectItemLimitReached`, `itemsOverProjectLimit`, short description / README validation,
  `canMakeProjectPrivate`, `isDeleteConfirmed`, `projectShortDescription`), `projectCopy` (`buildProjectCopyPlan`).
- Resource logic in `plugins/tracker-resources/src/projectDetails` (tests next to it): `copy` (read the source, apply the plan to a batch),
  `lifecycle` (close, reopen, visibility, template, delete with name), `status` (label and colour of a status), `identifier` (free
  identifier for a copy).
- Model: `Project.shortDescription?`, `Project.readme?` (Markup), `Project.isTemplate?` (all hidden props of `TProject`, optional, so no
  migration), new class `tracker.class.ProjectStatusUpdate` (`DOMAIN_TRACKER`, `space` = project; `status`, `startDate?`, `targetDate?`,
  `body`; the author is `createdBy`). Ids declared once (`plugins/tracker` for the class, `tracker-resources/plugin.ts` for strings and the
  `ProjectStatusPresenter` component).
- Server (`server-plugins/tracker-resources`): `OnProjectRemove` also removes the status updates; new sync trigger `OnProjectItemLimit`
  (model-server-tracker registers it). Jest: `project-item-limit.test.ts`, extended `project-field-trigger.test.ts`, `mockControl` supports `total`.
- UI (`plugins/tracker-resources/src/components/projects`): `ProjectSettings` (popup with a left sidebar: General, Custom fields, Workflows,
  Webhooks, Archived items, Danger zone), `ProjectGeneralSettings` + `ReadmeEditor` (Write / Preview), `ProjectDangerZone`,
  `ProjectDetailsPanel` (About panel), `ProjectStatusUpdatePopup`, `ProjectStatusPill`, `ProjectStatusPresenter` (column of the project list
  viewlets), `ProjectSettingsCard`. 60 strings in all 14 locale files by plain text insertion (ru translated, the others English).
- Project header (`IssuesView`): the latest status as a pill (opens the About panel), an About (info) button that toggles the panel, a "..."
  menu (Settings, Add status update, Copy project, Make / Unmake template). The edit-project popup keeps Fields, Workflows, Webhooks and
  Archived items and got a "Project settings" button.

**Behaviour and GitHub mapping**

- Settings sections reuse the existing editors, not copies: `ProjectFieldsPopup`, `WorkflowsPopup`, `WebhooksPopup` and
  `ArchivedItemsPopup` take an `embedded` prop and draw their frame with `ProjectSettingsCard` (the old `Card` when they are popups).
  In the settings the field list is a sidebar: selecting a field shows its editor next to it (key and type stay immutable).
- Short description (<= 256 characters, GitHub) is the new `shortDescription`; the old `Space.description` is not touched and is shown as
  the fallback in the About panel for projects that have no short description. README is stored as Markup (the platform editor takes Markdown
  shortcuts and pasted Markdown; the preview is the platform message viewer), limited to 100,000 characters of markup (our limit).
- Status updates: five statuses with the GitHub names (`INACTIVE`, `ON_TRACK`, `AT_RISK`, `OFF_TRACK`, `COMPLETE`), optional start and target
  date (target before start is refused), Markdown body (<= 65,536 characters, our limit). The newest update is the project status. The author
  or someone who can edit the space may edit and delete an update. Added from the About panel or the "..." menu.
- Close / Reopen maps on `Space.archived` (hidden from the navigator, not offered when creating issues; reopen restores it). Visibility
  maps on `Space.private` (a private project needs an owner among its members). Make / Unmake template is `isTemplate`. Delete asks for the
  project name and removes the project (the existing `OnProjectRemove` cleans up everything that belongs to it). Every action uses
  `canEditSpace`, `canArchiveSpace` and `canDeleteSpace` (workspace roles and space owners, no per-project roles, decision 5).
- Templates and copies: "Copy project" (menu) opens the create form pre-filled from the project, a new project can pick a template in
  "Create from template" (only non archived templates are listed). The plan copies fields (new ids, same keys and option values), iteration
  fields with their iterations, saved views, workflows (enabled state, filter and target as they are) and Insights charts, plus short
  description, README and working days. Iterations are recreated shifted by whole days so the first of each field starts today (durations,
  gaps and breaks stay). Everything the views mention that is a document id (iteration ids in column limits and filters, the project in the
  location) is rewritten. Fields, iterations, views, workflows, charts and the project itself are created in one `client.apply` batch.
  The "Include issues" switch is shown off and disabled: issues are never copied (Huly has no draft items; an issue belongs to exactly one
  project and carries numbering, status and parent links). The copy keeps the project type of the source (the template choice fixes it).
- Item limit: 50,000 items per project (`MAX_PROJECT_ITEMS`). The create-issue form counts the issues of the project and refuses with an
  explicit error; `OnProjectItemLimit` (sync trigger on issue creation) removes the newest created issues that exceed the limit, never
  older ones, like the field limit trigger. The limit counts all issues of the project, archived ones included (GitHub counts them
  separately). Moving an issue into a project is not checked.

**Deviations**

- No new IntlString for the status column label beyond `ProjectStatus`; the pill is the same component everywhere.
- The README and status update body are Markup, not raw Markdown text.
- "Make template" is a flag on the project, there is no separate template list page; the template picker is a dropdown in the create form.
- The settings page is a popup (Modal with a sidebar), not a route.

**Verified / not verified**

- Verified: jest (tracker, tracker-resources, server-tracker-resources, tracker-assets), `svelte-check` of tracker-resources, `rush validate
  --to @hcengineering/prod`.
- Not verified: nothing was run in a browser or against a server. Layout of the settings popup and the About panel, the sidebar of the field
  editor, trigger registration in a running pipeline, the project list column and the apply batch of a copy against a real client are untested.

**Not done / limits**

- Closing a project does not make the server reject writes into it; it relies on the existing archive behaviour of Huly.
- The status pill is not shown in the navigator tree, only in the header and the project list.
- No separate "Use this template" button on a template, the create form is the entry point.


---

## Phase 11b implementation notes (Draft items, Add item row, Export view data, view links)

**What was built**

- Pure logic in `plugins/tracker/src` with jest tests: `draft` (`isIssueDraft`, `draftQuery`, `draftIdentifier`, `convertDraftUpdate`, `parseAddItemInput`,
  link segments `draftLinkSegment` / `parseDraftLinkSegment` / `issueLinkSegment`) and `viewExport` (`buildViewTsv`, `formatTsvCell`, `orderRowsByGroups`,
  `viewExportFileName`, `MAX_EXPORT_ROWS`).
- Resource logic in `plugins/tracker-resources/src/draft` (`create`, `convert`, `target`, `addItem`, `itemCount`, `actions`) and `src/viewExport` (`columns`, `rows`,
  `groups`, `download`), tests next to it. Svelte: `components/draft/AddItemRow` + `AddItemSearch`, `components/issues/DraftBadge`.
- Model: `Issue.isDraft?: boolean` (hidden prop of `TIssue`, optional, so no migration), action `tracker.action.ConvertDraftToIssue` (context menu and board, `query: { isDraft: true }`).
- `view-resources`: grammar `is:draft`, `-is:draft`, `is:issue` / `-is:issue`; `SavedViewBar` got "Copy link to view", the `?view=<id>` deep link and a `tabActions` hook;
  `savedViews.ts` got `viewIdFromQuery`, `viewLinkQuery`, `viewFromLink`.
- 16 new strings in `tracker.string` and 2 in the view plugin, in all 14 locale files by plain text insertion (ru translated, the others English).

**Draft items (GitHub "draft issue")**

- A draft is an issue document with `isDraft: true`, so it takes part in every view, filter, field, board, roadmap, slice, Insights chart and workflow of the project
  unchanged. It is created with `number: 0` (the project sequence starts at 1, so no issue has it), `identifier: "<PROJ>-Draft"` (a placeholder that does not match the
  issue id pattern `PROJ-12`, so nothing resolves it as an issue) and the first creatable task type of the project type. Status is the project default status, else the first
  status of the task type. The project sequence is **not** touched when a draft is created. There is no default assignee on a draft (it would send an assignment notification
  for an idea).
- The identifier column (`IssuePresenter`, also the board card) shows a "Draft" badge, the panel shows it in the title, and a draft has no sub-issue list.
- Convert to issue: context menu / board action and a button in the detail panel. `convertDraftsToIssues` takes the next number of the project the way the create issue form
  does (`$inc` on the project sequence, which has to return the new value), then updates all drafts in **one `client.apply` batch** that is guarded with
  `match(Issue, { _id, isDraft: true })`: when somebody converted the draft in the meantime the batch is refused and nothing is renumbered. The number taken is then unused,
  like after a failed create. At most 500 drafts per conversion.
- Links: a draft is opened by its document id (`.../tracker/draft-<id>`, resolved by `resolveLocation`; panel URIs carry the id). `getTitle`, the server link providers
  (`issueLinkIdProvider`, `issueHTMLPresenter`, the webhook url) use `issueLinkSegment`. Webhook payloads say `content_type: "DraftIssue"` for drafts.
- Drafts can be deleted and archived like any item (the normal actions). They count against the 50,000 item limit.
- Filter: `is:draft` / `-is:draft`, `is:issue` leaves drafts out (`-is:issue` = only drafts). Compiled to `isDraft: true` / `isDraft: { $ne: true }`, evaluated on the client
  (`isDraftDoc`) with the same result. `is:` is completed with `draft`.
- Left out of lists that span projects: the issue lists with no project (My issues and similar, `IssuesView` without a `space`) and the parent / sub-issue pickers.

**Add item row**

- Table: a row below the table (a footer under the list, like the field sum footer, not a row inside the virtual list). Typing a title and pressing Enter creates a draft and keeps
  the focus; Esc clears. Titles are limited to 256 characters (GitHub). Board: "Add item" at the bottom of every column, and of every swimlane cell when the board has swimlanes;
  the draft starts with the value of the column and of the swimlane (`resolveDropUpdate` of the cell, so status, assignee, component, milestone, priority and custom / iteration
  fields). A cell whose value does not exist for the project has no row.
- `#` opens a search of existing issues of every project the user can see (full text, plus an identifier lookup for `PROJ-12`; recent issues for a bare `#`; drafts are not offered).
  Arrow keys and Enter pick, the list sits above the table input and below a board input. What picking does: an issue of this project is "Already in this project" (nothing);
  an **archived** item of this project is restored; an issue of **another project of the same type** opens the existing tracker move dialog (`Move.svelte`, new optional `target`
  prop) with this project preselected, so components and milestones are mapped and the issue is renumbered by the existing `moveIssueToSpace`; anything else is shown as
  "Cannot be moved here" (other project type, closed project, archived issue elsewhere, no permission to change the issue). GitHub ties an issue to many projects; in Huly an issue
  belongs to one, so adding it is a move, and the hint under the list says so.
- Guards: the row is not shown for read-only viewers (`restrictionStore`, `ReadOnlyGuest`, no create permission in the project); at the item limit it is disabled with the
  existing "project holds the most items" message. A shared per-project count query (`sharedItemCountStore`) feeds the limit.

**Export view data**

- "Export view data" in the menu of the active view tab and in the project "..." menu. The file is `.tsv` named `<Project> - <View>.tsv`: header row of the field names, then the
  columns Title, Identifier ("Draft" for a draft) and URL, then the visible fields of the view in the order of the view (priority, status, assignee, labels joined with `, `,
  component, milestone, due date as `YYYY-MM-DD`, estimation as a number, task type, comments, attachments, parent, modified / created as ISO timestamps and every custom or
  iteration field as the same text the table copies). Spacers, the extension area, the sub-issue counter and predecessors are not exported.
- Rows are what the view shows (filter string, chips, search, slice, archived scope, the view options query), loaded again with `findAll` (not read from the list), sorted by the
  sort of the view (server sort, or the client comparator for a custom field) and then put in group order with the same categories the list uses (`getCategories` for built-in keys,
  the client extension for custom fields), several levels deep. A board exports lane after lane, column after column inside it. Rows are flat: a table that nests sub-issues
  exports every issue on its own row (the Parent column has the parent).
- Escaping: a tab or a line break inside a value is replaced by a space (no quoting), lists are joined with `, `, `null` is empty. **Spreadsheet formula injection**: a text cell that
  starts with `=`, `+`, `-` or `@` gets a leading `'`. GitHub does not do this; it is on by default here (`escapeFormulas`), numbers are never prefixed. No BOM is written.
- Limit: 50,000 rows (the item limit of a project); the rest of a bigger view is cut off.

**Links to a view**

- "Copy link to view" in the tab menu and the project "..." menu copies `<front url>/<workbench>/<workspace>/tracker/<project>/issues?view=<saved view id>` (the default view that is not
  stored yet is the plain project link). `SavedViewBar` reads `?view=` on load and whenever the location changes and selects that tab (and remembers it as the active one); a view the
  project does not have (deleted, or the query survived a switch of the project) is ignored. Selecting a tab does not write the id back into the URL.
- Reset view is the existing Discard of the unsaved dot.

**Deviations**

- The "Add item" row of the table is a footer below the list, not the last row of the virtualised list (the shared `List` is untouched).
- A draft has one assignee, not several (Huly's issue has one), and no body field in the add row (the body is edited in the panel, like the description of an issue).
- No `converted` webhook event (GitHub has one); a conversion only changes `number`, `identifier` and `isDraft`, none of which is a watched field.
- The placeholder identifier is stored in English (`PROJ-Draft`); the views always show the localized badge instead.

**Verified / not verified**

- Verified: jest (tracker 174, tracker-resources 981, view-resources 298, server-tracker-resources 111, tracker-assets and view-assets lang tests, model-tracker), `svelte-check` of
  tracker-resources and view-resources, `rush validate --to @hcengineering/prod` (also model-tracker, model-server-tracker, server-tracker-resources).
- Not verified: nothing was run in a browser or against a server. Untested: the layout and keyboard behaviour of the add row and its search list (table and board cells), the `Move`
  dialog opened from the search, the `$search` query of the live query for issues, `$ne: true` on `isDraft` on the real database, the `apply` + `match` batch of a conversion against a
  real client, the download in a browser and in the desktop app, the location query `?view=` surviving the workbench navigation, trigger behaviour for drafts in a running pipeline.

**Not done / limits**

- Drafts are not excluded from notifications (an assignee set on a draft is notified like for an issue) nor from the global full text search and the `#` mention completion; the pipeline
  has no hook for that without touching the notification and indexing services. Sub-issue lists of a component or a milestone show drafts of that component / milestone.
- A draft is created with an empty rank, like a new issue from the create form.
- A draft cannot be the parent of issues (the sub-issue list is hidden in its panel, it is left out of the parent pickers) but nothing on the server refuses a parent link to it.
- The export does not include the hierarchy depth, the predecessors or the sub-issue counter, and it is not streamed: the whole view is built in memory.
