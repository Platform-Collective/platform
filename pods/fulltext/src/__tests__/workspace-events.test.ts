/* eslint-disable @typescript-eslint/unbound-method */
import core, {
  MeasureMetricsContext,
  TxFactory,
  type Class,
  type Doc,
  type Domain,
  type Ref,
  type Tx,
  type WorkspaceUuid
} from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import {
  workspaceEvents,
  type ConsumerControl,
  type ConsumerMessage,
  type PlatformQueue,
  type QueueWorkspaceMessage
} from '@hcengineering/server-core'
import serverToken from '@hcengineering/server-token'
import { randomUUID } from 'crypto'

import { WorkspaceManager } from '../manager'

// Migrations call `client.reindex(domain, classes)`, which puts a `fulltext-reindex` event on the
// workspace topic. The workspace consumer must hand it on to the fulltext topic, where the reindex is
// actually done; previously it was dropped silently.

const ctx = new MeasureMetricsContext('test', {})

function minimalModel (): Tx[] {
  const factory = new TxFactory(core.account.System)
  return [factory.createTxCreateDoc(core.class.Version, core.space.Model, { major: 0, minor: 7, patch: 0 })]
}

function createManager (): { manager: WorkspaceManager, sent: Array<{ workspace: string, msgs: any[] }> } {
  const sent: Array<{ workspace: string, msgs: any[] }> = []
  const producer = {
    send: jest.fn(async (_ctx: any, workspace: string, msgs: any[]) => {
      sent.push({ workspace, msgs })
    }),
    close: jest.fn(async () => {}),
    getQueue: jest.fn()
  }
  const queue = {
    getProducer: jest.fn(() => producer),
    getClientId: () => 'test',
    createConsumer: jest.fn(),
    createTopics: jest.fn(),
    deleteTopics: jest.fn(),
    shutdown: jest.fn()
  } as unknown as PlatformQueue
  const manager = new WorkspaceManager(ctx, minimalModel(), {
    queue,
    dbURL: '',
    hulylakeUrl: '',
    config: {} as any,
    externalStorage: {} as any,
    elasticIndexName: 'test',
    serverSecret: 'secret',
    accountsUrl: ''
  })
  return { manager, sent }
}

const control: ConsumerControl = {
  heartbeat: async () => {},
  pause: () => {}
}

async function workspaceEvent (
  manager: WorkspaceManager,
  workspace: WorkspaceUuid,
  value: QueueWorkspaceMessage
): Promise<void> {
  const msg: ConsumerMessage<QueueWorkspaceMessage> = {
    workspace,
    value
  }
  await (manager as any).processWorkspaceEvent(ctx, msg, control)
}

describe('workspace topic: fulltext-reindex from migrations', () => {
  beforeAll(() => {
    setMetadata(serverToken.metadata.Secret, 'secret')
  })

  const domain = 'space' as Domain
  const classes = ['tracker:class:Project' as Ref<Class<Doc>>]

  it('hands a reindex event on to the fulltext topic with domain and classes', async () => {
    const { manager, sent } = createManager()
    const ws = randomUUID() as WorkspaceUuid

    await workspaceEvent(manager, ws, workspaceEvents.reindex(domain, classes))

    expect(sent).toEqual([{ workspace: ws, msgs: [workspaceEvents.reindex(domain, classes)] }])
  })

  it('does not hand a reindex event on while the workspace is being restored', async () => {
    const { manager, sent } = createManager()
    const ws = randomUUID() as WorkspaceUuid

    await workspaceEvent(manager, ws, workspaceEvents.restoring())
    await workspaceEvent(manager, ws, workspaceEvents.reindex(domain, classes))

    expect(sent).toEqual([])
  })

  it('hands reindex events on again once the restore is finished', async () => {
    const { manager, sent } = createManager()
    const ws = randomUUID() as WorkspaceUuid

    await workspaceEvent(manager, ws, workspaceEvents.restoring())
    await workspaceEvent(manager, ws, workspaceEvents.restored())
    sent.length = 0 // `restored` itself requests a full reindex
    await workspaceEvent(manager, ws, workspaceEvents.reindex(domain, classes))

    expect(sent).toEqual([{ workspace: ws, msgs: [workspaceEvents.reindex(domain, classes)] }])
  })
})
