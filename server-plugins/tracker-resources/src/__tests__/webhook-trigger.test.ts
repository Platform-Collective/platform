//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import core, { TxFactory, type Ref, type Tx } from '@hcengineering/core'
import tracker, { MAX_PROJECT_WEBHOOKS, ProjectFieldType, type Project } from '@hcengineering/tracker'

import { verifySignature } from '../webhook/sign'
import type { WebhookRequest } from '../webhook/transport'
import {
  flushWebhookDeliveries,
  MAX_EVENTS_PER_RUN,
  OnProjectItemWebhook,
  OnProjectWebhookRemove,
  setWebhookTransport,
  webhookTuning
} from '../webhook/trigger'
import { makeControl } from './mockControl'

jest.mock('@hcengineering/server-contact', () => ({
  getPerson: async (_control: unknown, id: string) => (id === 'person-1' ? { _id: 'person-doc-1', _class: 'contact:class:Person', name: 'Doe,Alice' } : undefined)
}))

const PROJECT = 'project-1' as Ref<Project>
const user = new TxFactory('person-1' as any)
const system = new TxFactory(core.account.System, true)

const project = { _id: PROJECT, _class: tracker.class.Project, name: 'Platform', identifier: 'PLT' }
const statuses = [
  { _id: 'st-todo', _class: tracker.class.IssueStatus, name: 'Todo' },
  { _id: 'st-done', _class: tracker.class.IssueStatus, name: 'Done' }
]
const statusField = {
  _id: 'f-status',
  _class: tracker.class.ProjectField,
  space: PROJECT,
  key: 'stage',
  label: 'Stage',
  type: ProjectFieldType.SingleSelect,
  position: 0,
  options: [
    { value: 'o-a', label: 'Plan' },
    { value: 'o-b', label: 'Build' }
  ]
}

function hook (props: Record<string, any> = {}): any {
  return {
    _id: 'hook-1',
    _class: tracker.class.ProjectWebhook,
    space: PROJECT,
    url: 'https://hooks.example.com/huly',
    enabled: true,
    events: ['created', 'edited', 'archived', 'restored', 'deleted'],
    hasSecret: false,
    ...props
  }
}

function createTx (): Tx {
  const tx = user.createTxCreateDoc(tracker.class.Issue, PROJECT, { title: 'Fix', status: 'st-todo', identifier: 'PLT-1', customFields: {} } as any, 'i1' as any)
  tx.modifiedOn = 1000
  return tx
}
function updateTx (ops: Record<string, any>, at: number, factory: TxFactory = user): Tx {
  const tx = factory.createTxUpdateDoc(tracker.class.Issue, PROJECT, 'i1' as any, ops as any)
  tx.modifiedOn = at
  return tx
}

interface Setup {
  hooks?: any[]
  secrets?: any[]
  history: Tx[]
  extra?: Record<string, any[]>
}

function control (setup: Setup, txes: Tx[] = []): any {
  return makeControl({
    txes,
    docs: {
      [tracker.class.ProjectWebhook]: setup.hooks ?? [hook()],
      [tracker.class.ProjectWebhookSecret]: setup.secrets ?? [],
      [tracker.class.Project]: [project],
      [tracker.class.IssueStatus]: statuses,
      [tracker.class.ProjectField]: [statusField],
      [core.class.TxCUD]: setup.history,
      ...(setup.extra ?? {})
    }
  })
}

let sent: WebhookRequest[] = []

beforeEach(() => {
  sent = []
  webhookTuning.retryDelayMs = 1
  setWebhookTransport(async (request) => {
    sent.push(request)
    return { status: 200 }
  })
})
afterEach(async () => {
  await flushWebhookDeliveries()
  setWebhookTransport(undefined)
})

const bodies = (): any[] => sent.map((r) => JSON.parse(r.body))

describe('OnProjectItemWebhook', () => {
  it('delivers a created event', async () => {
    const create = createTx()
    expect(await OnProjectItemWebhook([create], control({ history: [create] }))).toEqual([])
    await flushWebhookDeliveries()
    expect(sent).toHaveLength(1)
    const body = bodies()[0]
    expect(body.action).toBe('created')
    expect(body.project_item).toMatchObject({ id: 'i1', project_id: PROJECT, identifier: 'PLT-1', title: 'Fix' })
    expect(body.project).toMatchObject({ name: 'Platform', identifier: 'PLT' })
    expect(body.sender).toEqual({ type: 'User', id: 'person-doc-1', name: 'Alice Doe' })
    expect(sent[0].headers['X-Huly-Event']).toBe('project_item')
  })

  it('delivers an edited event for a status change with the old and new value', async () => {
    const create = createTx()
    const edit = updateTx({ status: 'st-done' }, 2000)
    await OnProjectItemWebhook([edit], control({ history: [create, edit] }))
    await flushWebhookDeliveries()
    expect(sent).toHaveLength(1)
    const body = bodies()[0]
    expect(body.action).toBe('edited')
    expect(body.changes.field_value).toEqual({
      field_node_id: 'status',
      field_name: 'Status',
      field_type: 'status',
      from: { id: 'st-todo', name: 'Todo' },
      to: { id: 'st-done', name: 'Done' }
    })
  })

  it('delivers one event per changed field', async () => {
    const create = createTx()
    const edit = updateTx({ status: 'st-done', title: 'Fixed', customFields: { stage: 'o-b' } }, 2000)
    await OnProjectItemWebhook([edit], control({ history: [create, edit] }))
    await flushWebhookDeliveries()
    const fields = bodies().map((b) => b.changes.field_value.field_node_id).sort()
    expect(fields).toEqual(['customFields.stage', 'status', 'title'])
    const stage = bodies().find((b) => b.changes.field_value.field_node_id === 'customFields.stage')
    expect(stage.changes.field_value).toMatchObject({ field_name: 'Stage', field_type: 'single_select', from: null, to: { id: 'o-b', name: 'Build' } })
  })

  it('does not deliver an update that changes nothing it reports', async () => {
    const create = createTx()
    const same = updateTx({ title: 'Fix', status: 'st-todo' }, 2000)
    const other = updateTx({ description: 'x' }, 3000)
    await OnProjectItemWebhook([same, other], control({ history: [create, same, other] }))
    await flushWebhookDeliveries()
    expect(sent).toEqual([])
  })

  it('delivers archived and restored events, not edited ones', async () => {
    const create = createTx()
    const archive = updateTx({ archivedAt: 5000 }, 2000)
    const restore = updateTx({ archivedAt: null }, 3000)
    await OnProjectItemWebhook([archive, restore], control({ history: [create, archive, restore] }))
    await flushWebhookDeliveries()
    expect(bodies().map((b) => b.action).sort()).toEqual(['archived', 'restored'])
    const archived = bodies().find((b) => b.action === 'archived')
    expect(archived.project_item.archived_at).toBe('1970-01-01T00:00:05.000Z')
    expect(archived.changes).toBeUndefined()
  })

  it('delivers a deleted event with what the issue was', async () => {
    const create = createTx()
    const remove = user.createTxRemoveDoc(tracker.class.Issue, PROJECT, 'i1' as any)
    remove.modifiedOn = 4000
    await OnProjectItemWebhook([remove], control({ history: [create, remove] }))
    await flushWebhookDeliveries()
    expect(bodies()).toHaveLength(1)
    expect(bodies()[0].action).toBe('deleted')
    expect(bodies()[0].project_item).toMatchObject({ id: 'i1', identifier: 'PLT-1', title: 'Fix' })
  })

  it('shows the project automation as the sender of its changes, and delivers them', async () => {
    const create = createTx()
    // A write of a workflow is in the operation as a result of a synchronous trigger
    const own = updateTx({ customFields: { stage: 'o-a' } }, 2000, system)
    await OnProjectItemWebhook([create], control({ history: [create, own] }, [create, own]))
    await flushWebhookDeliveries()
    const edited = bodies().find((b) => b.action === 'edited')
    expect(edited.sender).toEqual({ type: 'Automation', id: null, name: 'Project automation' })
    expect(edited.changes.field_value.field_node_id).toBe('customFields.stage')
  })

  it('delivers a transaction once even when it is in the operation twice', async () => {
    const create = createTx()
    await OnProjectItemWebhook([create], control({ history: [create] }, [create]))
    await flushWebhookDeliveries()
    expect(sent).toHaveLength(1)
  })

  it('delivers only the subscribed events to enabled webhooks', async () => {
    const create = createTx()
    const edit = updateTx({ status: 'st-done' }, 2000)
    const hooks = [
      hook({ _id: 'h-edit', url: 'https://a.example.com/', events: ['edited'] }),
      hook({ _id: 'h-create', url: 'https://b.example.com/', events: ['created'] }),
      hook({ _id: 'h-none', url: 'https://c.example.com/', events: [] }),
      hook({ _id: 'h-off', url: 'https://d.example.com/', enabled: false })
    ]
    await OnProjectItemWebhook([create, edit], control({ hooks: hooks.filter((h) => h.enabled), history: [create, edit] }))
    await flushWebhookDeliveries()
    expect(sent.map((r) => `${r.url.hostname}:${JSON.parse(r.body).action}`).sort()).toEqual(['a.example.com:edited', 'b.example.com:created'])
  })

  it('does nothing for a project without webhooks or for other documents', async () => {
    const create = createTx()
    await OnProjectItemWebhook([create], control({ hooks: [], history: [create] }))
    const milestone = user.createTxCreateDoc(tracker.class.Milestone, PROJECT, { label: 'v1' } as any)
    await OnProjectItemWebhook([milestone], control({ history: [] }))
    await flushWebhookDeliveries()
    expect(sent).toEqual([])
  })

  it('signs with the newest secret and never puts the secret in the payload', async () => {
    const create = createTx()
    const secrets = [
      { _id: 's-old', webhook: 'hook-1', secret: 'old-secret', createdOn: 1 },
      { _id: 's-new', webhook: 'hook-1', secret: 'new-secret', createdOn: 2 },
      { _id: 's-foreign', webhook: 'hook-2', secret: 'foreign', createdOn: 3 }
    ]
    await OnProjectItemWebhook([create], control({ hooks: [hook({ hasSecret: true })], secrets, history: [create] }))
    await flushWebhookDeliveries()
    expect(sent).toHaveLength(1)
    const header = sent[0].headers['X-Huly-Signature-256']
    expect(verifySignature('new-secret', sent[0].body, header)).toBe(true)
    expect(verifySignature('old-secret', sent[0].body, header)).toBe(false)
    expect(sent[0].body).not.toContain('new-secret')
    expect(JSON.stringify(sent[0].headers)).not.toContain('new-secret')
  })

  it('does not sign a webhook without a secret', async () => {
    const create = createTx()
    await OnProjectItemWebhook([create], control({ hooks: [hook({ hasSecret: false })], secrets: [{ _id: 's', webhook: 'hook-1', secret: 'x', createdOn: 1 }], history: [create] }))
    await flushWebhookDeliveries()
    expect('X-Huly-Signature-256' in sent[0].headers).toBe(false)
  })

  it('does not block: it returns before the receiver answers', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    let answered = false
    setWebhookTransport(async (request) => {
      sent.push(request)
      await gate
      answered = true
      return { status: 200 }
    })
    const create = createTx()
    const res = await OnProjectItemWebhook([create], control({ history: [create] }))
    expect(res).toEqual([])
    expect(answered).toBe(false)
    release()
    await flushWebhookDeliveries()
    expect(answered).toBe(true)
  })

  it('survives a receiver that fails and retries once', async () => {
    let calls = 0
    setWebhookTransport(async () => {
      calls++
      throw new Error('ECONNREFUSED')
    })
    const create = createTx()
    await expect(OnProjectItemWebhook([create], control({ history: [create] }))).resolves.toEqual([])
    await flushWebhookDeliveries()
    expect(calls).toBe(2)
  })

  it('never calls a private target', async () => {
    const create = createTx()
    const hooks = [
      hook({ _id: 'h1', url: 'https://127.0.0.1/x' }),
      hook({ _id: 'h2', url: 'http://hooks.example.com/x' }),
      hook({ _id: 'h3', url: 'https://169.254.169.254/latest' })
    ]
    await OnProjectItemWebhook([create], control({ hooks: hooks, history: [create] }))
    await flushWebhookDeliveries()
    expect(sent).toEqual([])
  })

  it('caps the events of one run', async () => {
    const create = createTx()
    const txes = Array.from({ length: MAX_EVENTS_PER_RUN + 30 }, (_, i) => {
      const tx = user.createTxCreateDoc(tracker.class.Issue, PROJECT, { title: `T${i}`, status: 'st-todo' } as any, `n${i}` as any)
      tx.modifiedOn = 1000 + i
      return tx
    })
    await OnProjectItemWebhook(txes, control({ history: [create] }))
    await flushWebhookDeliveries()
    expect(sent).toHaveLength(MAX_EVENTS_PER_RUN)
  })

  it('uses at most the allowed number of webhooks per project, the oldest first', async () => {
    const create = createTx()
    const hooks = Array.from({ length: MAX_PROJECT_WEBHOOKS + 5 }, (_, i) =>
      hook({ _id: `h${i}`, url: `https://h${i}.example.com/`, createdOn: i })
    )
    await OnProjectItemWebhook([create], control({ hooks: [...hooks].reverse(), history: [create] }))
    await flushWebhookDeliveries()
    expect(sent).toHaveLength(MAX_PROJECT_WEBHOOKS)
    expect(sent.some((r) => r.url.hostname === `h${MAX_PROJECT_WEBHOOKS}.example.com`)).toBe(false)
  })

  it('bounds the payload', async () => {
    const create = createTx()
    const huge = updateTx({ title: 'x'.repeat(200_000) }, 2000)
    await OnProjectItemWebhook([huge], control({ history: [create, huge] }))
    await flushWebhookDeliveries()
    expect(sent).toHaveLength(1)
    expect(Buffer.byteLength(sent[0].body, 'utf8')).toBeLessThanOrEqual(64 * 1024)
  })
})

describe('OnProjectWebhookRemove', () => {
  it('removes the secrets of the removed webhook, only theirs', async () => {
    const secrets = [
      { _id: 's1', _class: tracker.class.ProjectWebhookSecret, space: 'person-space-1', webhook: 'hook-1' },
      { _id: 's2', _class: tracker.class.ProjectWebhookSecret, space: 'person-space-2', webhook: 'hook-1' },
      { _id: 's3', _class: tracker.class.ProjectWebhookSecret, space: 'person-space-1', webhook: 'hook-2' }
    ]
    const remove = user.createTxRemoveDoc(tracker.class.ProjectWebhook, PROJECT, 'hook-1' as any)
    const res: any[] = await OnProjectWebhookRemove([remove], control({ history: [], secrets }))
    expect(res.map((r) => r.objectId).sort()).toEqual(['s1', 's2'])
    expect(res.map((r) => r.objectSpace).sort()).toEqual(['person-space-1', 'person-space-2'])
  })
})
