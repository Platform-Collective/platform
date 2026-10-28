# Cross-project workflow rules

## Status: Design

This document is the design proposal for the feature discussed in
Platform-Collective/platform discussion #235. It is live on
`feature/cross-project-workflow-rules` and will be the companion doc of the
eventual PR.

The feature lets a workspace admin declare, in Project Settings, that a status
change on an Issue in project A should mirror onto a linked counterpart Issue
in project B. The mirror is executed server-side so neither client needs to
poll, there is no outbound dependency on an external worker, and the rule is
visible to anyone who can read the project.

## Why not do it client-side

A client-side listener would need a browser tab open to react. It would also
run as whichever user happened to be looking at the issue, which is wrong for
cross-space writes - the mirror must land as a privileged action, not as the
drag-drop author pretending to touch a space they may not even read. The
existing server trigger pipeline is the right surface: `TxUpdateDoc(Issue,
{status})` already fans out to one trigger (`OnIssueUpdate`) that today does
estimation and parent-chain work. A workflow-rule trigger is the same shape.

## Why not n8n or an outbound webhook

An outbound webhook plus a Postiz/n8n worker is what Pixelique runs today
against our own self-hosted Platform-Collective instance (daemon at
`/opt/huly-sync/`, systemd `huly-sync.service`, 10-second poll loop). It works,
but every operator who wants cross-project rules has to run and secure an
extra process, mint a long-lived API token, and keep its status map in sync
with the project's actual status set. Hoisting the behaviour into the platform
removes the external component, keeps the rule set in the same backup as the
project, and lets a non-engineer admin maintain it from Project Settings
without touching a workflow editor.

Discussion #236 (outbound webhooks) remains independently useful for cases
that leave the workspace entirely (e.g. post to Slack). The two features are
orthogonal and both should ship.

## Shape of a rule

```ts
interface WorkflowRule extends Doc {
  // The project the rule is attached to. Rule applies when an issue in this
  // project changes status.
  space: Ref<Project>

  // The project the mirror targets. For the typical "Content Calendar" ↔
  // "Design Requests" case these are the two sides of the link.
  linkedProject: Ref<Project>

  // How to find the counterpart issue given an issue in `space`. The MVP ships
  // "sub-issue parent/child via `attachedTo`" because that is what the ecosystem
  // already uses for cross-project parenting (see `attachedToClass =
  // tracker.class.Issue, collection = 'subIssues'`). Additional link kinds -
  // ByCustomField, ByRelation - are stubbed in the interface but not wired
  // yet; the resolver dispatches on `linkKind` so adding them later is a pure
  // extension.
  linkKind: 'subIssue' | 'parentIssue'

  // Status mirror map. Keys and values are `Ref<IssueStatus>` so that renames
  // in the IssueStatus doc don't break the rule, and so that two statuses with
  // the same display name in different TaskTypes stay distinguishable.
  // One direction only - a reverse rule in the other project supplies the
  // other direction. This keeps the model symmetric and lets the two sides be
  // edited independently by their respective admins.
  forwardMap: Record<Ref<IssueStatus>, Ref<IssueStatus>>

  // Allowed "backwards" transitions. By default the trigger refuses to move
  // a linked issue to a status with a lower rank than its current one (so a
  // 'Posted' CAL item cannot be dragged back to 'Design' by a stray mirror).
  // allowedLoops names the (from, to) pairs - in the TARGET project's
  // statuses - that are legal regressions. Mirrors a workflow's own
  // "re-open after revisions" transitions.
  allowedLoops: Array<{
    from: Ref<IssueStatus>
    to: Ref<IssueStatus>
  }>

  // Auto-create section: when an issue in `space` enters one of these statuses
  // AND no counterpart exists yet via `linkKind`, create one in `linkedProject`.
  // Empty = disabled.
  autoCreate?: {
    triggerStatuses: Array<Ref<IssueStatus>>
    // Component mapping in `linkedProject` keyed by the SOURCE component's
    // `_id`. Null value means "do not auto-create for issues with this
    // component". Omitted keys fall back to `defaultComponent`.
    componentMap: Record<Ref<Component>, Ref<Component> | null>
    defaultComponent?: Ref<Component>
    // Fields to copy forward from source to the newly created counterpart.
    // Enumeration not freeform so clients cannot ask the server to copy
    // arbitrary nested paths.
    inherit: Array<'title' | 'description' | 'priority' | 'dueDate' | 'milestone' | 'assignee'>
  }

  // Soft-off switch. The row stays in the project for audit/history even when
  // the rule is paused.
  enabled: boolean
}
```

The ranks that enforce "no backwards move except via allowedLoops" come from
the TARGET project's `TaskType.statuses` ordering - the array index inside
that list is the rank. The rule does not store a separate rank table; the
TaskType is the authority. Adding or reordering statuses in the UI
re-ranks automatically.

## Server trigger

A new resource `OnWorkflowRuleMirror` is registered against:

```ts
builder.createDoc(serverCore.class.Trigger, core.space.Model, {
  trigger: serverWorkflowRules.trigger.OnWorkflowRuleMirror,
  txMatch: {
    _class: core.class.TxUpdateDoc,
    objectClass: tracker.class.Issue
  }
})
```

The trigger body:

1. Short-circuit on `tx.operations.status === undefined`. The vast majority of
   issue updates have no status change - bailing early keeps the trigger cheap
   on the hot path.
2. Short-circuit on any update whose own `tx.space` is `core.space.DerivedTx`.
   The trigger's own outputs are emitted via `control.txFactory` which marks
   derived updates with that space, so a mirror update cannot start another
   mirror. For v1 this is the deliberate one-hop semantics; it also means
   status writes emitted by other server triggers are not mirrored. Multi-hop
   would want a cascade-scoped visited set and a hard depth bound instead.
3. Load any `WorkflowRule` doc with `space = tx.objectSpace` AND `enabled =
   true`. For a workspace with a handful of rules this is a single bounded
   read; if a workspace scales up we add an index on `(space, enabled)` to
   match the existing index pattern on other `space`-scoped docs.
4. For each matching rule, resolve the counterpart Issue via `linkKind`:
   - `subIssue`: the counterpart is the one Issue whose `attachedTo` equals
     this issue's `_id`, `attachedToClass = tracker.class.Issue`, `collection
     = 'subIssues'`, and `space = rule.linkedProject`.
   - `parentIssue`: this issue's own `attachedTo`, scoped to
     `rule.linkedProject`.
5. If no counterpart exists AND the new status is in `autoCreate.triggerStatuses`,
   the v1 trigger logs an info line and does nothing. Emitting a
   `TxCreateDoc<Issue>` here (sequence allocation, rank, parent/sub-issue
   count backfill) is deferred to a dedicated follow-up PR so its creation
   path gets its own review surface. The design still carries the auto-create
   shape (`triggerStatuses`, `componentMap`, `defaultComponent`, `inherit`)
   so no schema change is needed when that PR lands.
6. If a counterpart exists, compute the target status via `forwardMap[new
   status]`. If the map has no entry, do nothing (not a failure - it is how
   you say "this status does not move the mirror").
7. Enforce the regression guard: if `targetStatusRank <
   counterpart.statusRank` AND `(counterpart.status, targetStatus)` is not in
   `allowedLoops`, do nothing. Log via the trigger's standard
   `control.ctx.contextData` channel so operators can see suppressed moves
   in the trace UI.
8. Enforce target-side authorization before emitting a write. The derived
   mirror update bypasses the ordinary space permission middleware, so
   the trigger stands in for it. **Target-level checks run first and
   apply to every caller including the system account and workspace
   admins**: a missing target, an archived target, or a `restricted`
   `TypedSpace` is refused unconditionally. After those pass, actor-level
   allowance is checked:
   - `tx.modifiedBy === core.account.System` is allowed (server-authored
     writes, integrations). The session-level `socialStringsToUsers` map
     omits system sessions, so this explicit check is needed.
   - Otherwise the acting account resolved from `socialStringsToUsers`
     must hold `AccountRole.Admin` or higher, OR be present in the target
     project's `members` or `owners`. Source-project membership alone is
     not sufficient.
   - The member/owner check is a strict first step. It is not identical
     to the platform's full write rule (public spaces where non-members
     can write, role grants, role forbids). Tightening to the full
     permission pipeline is a follow-up; the current rule refuses to
     emit a cross-project write unless the actor is in the target's
     membership list.
   - Rule management (who may create a rule on A that writes to B) has
     no dedicated permission yet; the plugin ships disabled by default
     so an Owner has to opt in via Settings > Configure before any rule
     fires.
9. Emit `TxUpdateDoc<Issue>` via
   `control.txFactory.createTxUpdateDoc(..., tx.modifiedOn)`. Passing the
   source tx's `modifiedOn` lines up with how `OnIssueUpdate` already builds
   its chained updates (see `doTimeReportUpdate` in `server-plugins/tracker-resources/src/index.ts`),
   so the mirror does not look like it happened in the future.
10. Transactions in a single invocation are evaluated in `modifiedOn` order.
    A pending-status map keyed by counterpart holds `{status, modifiedOn}`
    entries so that:
    (a) equality and regression checks run against the queued target
        status rather than the stale persisted one, and
    (b) a source whose `modifiedOn` is less than or equal to the queued
        entry's `modifiedOn` is refused outright. Final application sorts
        derived writes by `modifiedOn` in
        `foundations/server/packages/middleware/src/triggers.ts`, so
        refusing an older source after a newer mirror is queued is what
        stops the sort from reversing the applied order into a forbidden
        regression.
    The map lives in `control.contextCache`, which the server pipeline
    normally scopes to one root transaction (one request). Workspace
    paths (notably `wrapPipeline()`) can share one `SessionData` across
    successive `pipeline.tx()` calls, so the trigger stamps a sentinel
    with the current `control.txes` reference on entry and clears the
    per-request maps when that identity has changed.
11. The whole trigger is a no-op unless the plugin's `PluginConfiguration`
    row has `enabled: true`. Missing, malformed, or unreadable config
    fails closed. The feature ships disabled in `models/all`; an Owner
    opts in via Settings > Configure, and the toggle takes effect without
    a server restart because this check runs on every invocation.

The server has no notion of "which side moved last" - arbitration-by-mtime,
which the daemon does today, is a workaround for polling. The trigger reacts
to the actual Tx, so the ordering is whatever the Transactor applied, which
is already the correct answer.

## UI

The admin surface is intentionally not in this PR; the data model is
editable via the standard `TxOperations` surface, which is enough to prove
the mechanism end-to-end. The follow-up PR adds a "Workflow rules" tab on
every tracker project with a pairing wizard (pick a linked project, name
the pair, toggle bidirectional, review the status map) and an "Advanced"
per-rule matrix editor. Writes still go through `TxOperations.createDoc` /
`updateDoc`, so the usual space permission applies to the rule document
itself. Rule management (who may create a rule on A whose counterpart
lands in B) does not have a dedicated permission yet, which is why the
plugin ships disabled by default.

## What is NOT in v1

- Rules that fan out to more than one target project (one source → N targets).
  The data model is one `linkedProject` per rule; a user who wants fan-out
  writes multiple rules.
- Field mirroring beyond `status` on the update path (title/description/etc.
  only propagate on auto-create). Status is the shared vocabulary of a
  workflow; everything else is up to the counterpart project.
- Delete propagation. Removing a source issue does NOT remove its mirror -
  the mirror is an independent doc owned by its own project, and the user
  decides when to close it.
- Rule imports/exports to JSON. Nice-to-have; `rush test` ships one.

Each of those is deferred because adding them later is strictly additive and
would otherwise widen the surface area reviewers have to assess.

## Open questions for the PR review

1. Should `WorkflowRule` live in `plugins/tracker` or get its own
   `plugins/workflow-rules`? Draft starts as a sibling plugin so it does not
   bloat tracker's bundle, but reviewers may prefer tracker if they do not
   want a new plugin descriptor.
2. Permission model: for v1 the rule is editable by anyone who can edit the
   source project. Should the linked project's admin ALSO consent (requires
   a two-sided handshake row)? The daemon-era users will say "no, that is
   too much ceremony"; a stricter workspace will say "yes, otherwise one PM
   can mutate another PM's board".
3. Does the `linkKind: 'subIssue'` resolution want to match on parent/child
   both ways (either side can trigger the mirror), or should the direction
   be explicit per-rule? Current draft is one-way-per-rule for symmetry with
   `forwardMap`.

## Related

- Discussion #235 (this feature).
- Discussion #236 (outbound webhooks). Independent.
- Current workaround at Pixelique: `/opt/huly-sync/sync-daemon.ts` - the
  polling bidirectional sync daemon this feature retires once accepted
  upstream. The daemon's `CAL_TO_DES` / `DES_TO_CAL` / `allowedLoops` are a
  working reference for what the matrix editor must express.
