//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import contact, { getName } from '@hcengineering/contact'
import core, {
  concatLink,
  generateId,
  TxProcessor,
  type Doc,
  type Ref,
  type Tx,
  type TxCUD,
  type TxUpdateDoc
} from '@hcengineering/core'
import { getMetadata } from '@hcengineering/platform'
import { getPerson } from '@hcengineering/server-contact'
import serverCore, { type TriggerControl } from '@hcengineering/server-core'
import tracker, {
  isAutomationAuthor,
  MAX_PROJECT_WEBHOOKS,
  trackerId,
  type Issue,
  type Project,
  type ProjectWebhook,
  type WebhookEvent
} from '@hcengineering/tracker'
import { workbenchId } from '@hcengineering/workbench'

import { replayAround } from '../history'
import { logTrigger } from '../log'
import {
  DEFAULT_RETRY_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
  runDeliveries,
  type DeliveryJob,
  type DeliveryOptions
} from './delivery'
import {
  buildPayload,
  describeChange,
  diffIssue,
  serializePayload,
  WATCHED_ATTRIBUTES,
  type ChangeLookups,
  type FieldValueChange,
  type PayloadSender,
  type RawFieldChange
} from './payload'
import { allowPrivateTargets, createNodeTransport } from './transport'

// Delivery of project webhooks. The trigger is asynchronous (it runs after the transaction is done and never delays it),
// and the deliveries themselves are not even awaited by it: they run in the background with a timeout and one retry.
// There is no persistent queue, so a delivery that is in flight when the server stops is lost (at most once, with a
// single retry). Security: see the notes of Phase 10 in the plan (SSRF guard in `transport.ts`, signature in `sign.ts`,
// secrets in the personal space of their author).

/** Events one run of the trigger delivers at most; the rest is dropped. */
export const MAX_EVENTS_PER_RUN = 100

/** Timeouts of a delivery; a test shortens them. */
export const webhookTuning = { timeoutMs: DEFAULT_TIMEOUT_MS, retryDelayMs: DEFAULT_RETRY_DELAY_MS }

let transportOverride: DeliveryOptions['transport'] | undefined
const inFlight = new Set<Promise<unknown>>()

/**
 * Replaces the network transport; for tests.
 */
export function setWebhookTransport (transport: DeliveryOptions['transport'] | undefined): void {
  transportOverride = transport
}

/**
 * Waits for the deliveries that are in flight; for tests and for a clean shutdown.
 */
export async function flushWebhookDeliveries (): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight])
}

interface ItemEvent {
  tx: TxCUD<Issue>
  action: WebhookEvent
  change?: FieldValueChange
  issue: Partial<Issue> & { _id: Ref<Issue> }
}

function issueUrl (control: TriggerControl, identifier: string | undefined): string | undefined {
  if (identifier === undefined) return undefined
  const front = control.branding?.front ?? getMetadata(serverCore.metadata.FrontUrl) ?? ''
  if (front === '') return undefined
  return concatLink(front, `${workbenchId}/${control.workspace.url}/${trackerId}/${identifier}`)
}

const WATCHED = new Set(Object.keys(WATCHED_ATTRIBUTES))

function touchesWatched (tx: TxUpdateDoc<Issue>): boolean {
  return Object.keys(tx.operations).some((k) => WATCHED.has(k) || k === 'customFields')
}

async function loadLookups (control: TriggerControl, project: Ref<Project>, changes: RawFieldChange[]): Promise<ChangeLookups> {
  const ids = (key: string): string[] => [
    ...new Set(changes.filter((c) => c.fieldId === key).flatMap((c) => [c.from, c.to]).filter((v): v is string => typeof v === 'string'))
  ]
  const statuses = new Map<string, string>()
  const people = new Map<string, string>()
  const components = new Map<string, string>()
  const milestones = new Map<string, string>()
  const iterations = new Map<string, string>()
  const fieldMap = new Map<string, any>()

  const statusIds = ids('status')
  if (statusIds.length > 0) {
    for (const s of await control.findAll(control.ctx, tracker.class.IssueStatus, { _id: { $in: statusIds as any } })) statuses.set(s._id, s.name)
  }
  const assigneeIds = ids('assignee')
  if (assigneeIds.length > 0) {
    for (const p of await control.findAll(control.ctx, contact.class.Person, { _id: { $in: assigneeIds as any } })) {
      people.set(p._id, getName(control.hierarchy, p))
    }
  }
  const componentIds = ids('component')
  if (componentIds.length > 0) {
    for (const c of await control.findAll(control.ctx, tracker.class.Component, { _id: { $in: componentIds as any } })) components.set(c._id, c.label)
  }
  const milestoneIds = ids('milestone')
  if (milestoneIds.length > 0) {
    for (const m of await control.findAll(control.ctx, tracker.class.Milestone, { _id: { $in: milestoneIds as any } })) milestones.set(m._id, m.label)
  }
  if (changes.some((c) => c.fieldId.startsWith('customFields.'))) {
    for (const f of await control.findAll(control.ctx, tracker.class.ProjectField, { space: project })) fieldMap.set(f.key, f)
    for (const it of await control.findAll(control.ctx, tracker.class.Iteration, { space: project })) iterations.set(it._id, it.label)
  }
  return { statuses, people, components, milestones, iterations, fields: fieldMap }
}

async function resolveSender (control: TriggerControl, tx: Tx): Promise<PayloadSender> {
  if (isAutomationAuthor(tx.modifiedBy, core.account.System)) return { type: 'Automation', name: 'Project automation' }
  try {
    const person = await getPerson(control, tx.modifiedBy)
    if (person !== undefined) return { type: 'User', id: person._id, name: getName(control.hierarchy, person) }
  } catch (err: any) {
    logTrigger(control, 'warn', 'tracker webhook could not resolve the sender', { err })
  }
  return { type: 'User' }
}

// The events one transaction stands for
async function eventsOf (control: TriggerControl, tx: TxCUD<Issue>, wanted: ReadonlySet<WebhookEvent>): Promise<ItemEvent[]> {
  if (tx._class === core.class.TxCreateDoc) {
    if (!wanted.has('created')) return []
    return [{ tx, action: 'created', issue: TxProcessor.createDoc2Doc(tx as any) as Issue }]
  }
  if (tx._class === core.class.TxRemoveDoc) {
    if (!wanted.has('deleted')) return []
    const { after } = await replayAround<Issue>(control, tx)
    return [{ tx, action: 'deleted', issue: { ...(after ?? {}), _id: tx.objectId } }]
  }
  if (tx._class !== core.class.TxUpdateDoc) return []
  const update = tx as TxUpdateDoc<Issue>
  const ops = update.operations as Record<string, any>
  const archives = 'archivedAt' in ops
  const edits = touchesWatched(update)
  if (!archives && !edits) return []
  const { before, after } = await replayAround<Issue>(control, update)
  if (after === undefined) return []
  const events: ItemEvent[] = []
  if (archives) {
    const was = before?.archivedAt !== undefined && before?.archivedAt !== null
    const is = after.archivedAt !== undefined && after.archivedAt !== null
    if (is && !was && wanted.has('archived')) events.push({ tx, action: 'archived', issue: after })
    if (!is && was && wanted.has('restored')) events.push({ tx, action: 'restored', issue: after })
  }
  if (edits && wanted.has('edited')) {
    const changes = diffIssue(before, after)
    const lookups = changes.length > 0 ? await loadLookups(control, update.objectSpace as Ref<Project>, changes) : undefined
    for (const change of changes) {
      if (lookups === undefined) break
      events.push({ tx, action: 'edited', issue: after, change: describeChange(change, lookups) })
    }
  }
  return events
}

async function newestSecret (control: TriggerControl, webhook: ProjectWebhook): Promise<string | undefined> {
  if (!webhook.hasSecret) return undefined
  const secrets = await control.findAll(control.ctx, tracker.class.ProjectWebhookSecret, { webhook: webhook._id })
  const newest = [...secrets].sort((a, b) => (b.createdOn ?? 0) - (a.createdOn ?? 0))[0]
  return newest?.secret
}

/**
 * Calls the webhooks of a project when one of its items is created, edited (one delivery per changed field, with the
 * old and new value), archived, restored or deleted. Changes made by the project automation are delivered as well,
 * with the sender `Automation`.
 * @public
 */
export async function OnProjectItemWebhook (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  // The transactions of the operation: the original ones and what the synchronous triggers added to them
  const seen = new Set<string>()
  const issueTxes: Array<TxCUD<Issue>> = []
  for (const tx of [...txes, ...(control.txes ?? [])]) {
    if (seen.has(tx._id)) continue
    seen.add(tx._id)
    if (!TxProcessor.isExtendsCUD(tx._class) || tx._class === core.class.TxMixin) continue
    if (!control.hierarchy.isDerived((tx as TxCUD<Doc>).objectClass, tracker.class.Issue)) continue
    issueTxes.push(tx as TxCUD<Issue>)
  }
  if (issueTxes.length === 0) return []

  const webhooksOf = new Map<Ref<Project>, ProjectWebhook[]>()
  const jobs: DeliveryJob[] = []
  const allowInsecure = allowPrivateTargets()
  const secretCache = new Map<string, string | undefined>()
  let dropped = 0

  for (const tx of issueTxes) {
    const project = tx.objectSpace as Ref<Project>
    let hooks = webhooksOf.get(project)
    if (hooks === undefined) {
      // At most the number a project may have (the oldest), whatever clients wrote
      hooks = [...(await control.findAll(control.ctx, tracker.class.ProjectWebhook, { space: project, enabled: true }))]
        .sort((a, b) => (a.createdOn ?? 0) - (b.createdOn ?? 0))
        .slice(0, MAX_PROJECT_WEBHOOKS)
      webhooksOf.set(project, hooks)
    }
    if (hooks.length === 0) continue

    const wanted = new Set<WebhookEvent>(hooks.flatMap((h) => h.events ?? []))
    if (wanted.size === 0) continue
    const events = await eventsOf(control, tx, wanted)
    if (events.length === 0) continue

    const sender = await resolveSender(control, tx)
    const projectDoc = (await control.findAll(control.ctx, tracker.class.Project, { _id: project }, { limit: 1 }))[0]
    for (const event of events) {
      for (const hook of hooks) {
        if (!(hook.events ?? []).includes(event.action)) continue
        if (jobs.length >= MAX_EVENTS_PER_RUN) {
          dropped++
          continue
        }
        if (!secretCache.has(hook._id)) secretCache.set(hook._id, await newestSecret(control, hook))
        const deliveryId = generateId()
        const payload = buildPayload({
          action: event.action,
          deliveryId,
          timestamp: Date.now(),
          workspace: control.workspace.url,
          project: { id: project, name: projectDoc?.name, identifier: projectDoc?.identifier },
          issue: {
            id: event.issue._id,
            identifier: event.issue.identifier,
            title: event.issue.title,
            url: issueUrl(control, event.issue.identifier),
            createdOn: event.issue.createdOn,
            modifiedOn: event.tx.modifiedOn,
            archivedAt: event.issue.archivedAt
          },
          change: event.change,
          sender
        })
        jobs.push({
          webhookId: hook._id,
          url: hook.url,
          secret: secretCache.get(hook._id),
          deliveryId,
          body: serializePayload(payload)
        })
      }
    }
  }
  if (dropped > 0) logTrigger(control, 'warn', 'tracker webhook events dropped (per run limit)', { dropped })
  if (jobs.length === 0) return []

  // Not awaited: the trigger returns at once, the deliveries run on their own
  const options: DeliveryOptions = {
    transport: transportOverride ?? createNodeTransport(allowInsecure),
    allowInsecure,
    timeoutMs: webhookTuning.timeoutMs,
    retryDelayMs: webhookTuning.retryDelayMs
  }
  const running = runDeliveries(jobs, options)
    .then((results) => {
      const failed = results.filter((r) => !r.ok).length
      if (failed > 0) logTrigger(control, 'warn', 'tracker webhook deliveries failed', { failed, total: results.length })
    })
    .catch((err) => {
      logTrigger(control, 'error', 'tracker webhook deliveries crashed', { err })
    })
    .finally(() => {
      inFlight.delete(running)
    })
  inFlight.add(running)
  return []
}

/**
 * The secrets of a removed webhook (they live in the personal spaces of their authors) are removed with it.
 * @public
 */
export async function OnProjectWebhookRemove (txes: Tx[], control: TriggerControl): Promise<Tx[]> {
  const result: Tx[] = []
  for (const tx of txes) {
    const removed = (tx as TxCUD<ProjectWebhook>).objectId
    if (removed === undefined) continue
    const secrets = await control.findAll(control.ctx, tracker.class.ProjectWebhookSecret, { webhook: removed })
    for (const secret of secrets) {
      result.push(control.txFactory.createTxRemoveDoc(secret._class, secret.space, secret._id))
    }
  }
  return result
}
