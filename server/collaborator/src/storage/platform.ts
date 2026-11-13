//
// Copyright © 2023, 2024 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import activity, { DocUpdateMessage } from '@hcengineering/activity'
import { Analytics } from '@hcengineering/analytics'
import { loadCollabJson, loadCollabYdoc, saveCollabJson, saveCollabYdoc } from '@hcengineering/collaboration'
import { decodeDocumentId } from '@hcengineering/collaborator-client'
import { generateMessageId } from '@hcengineering/communication-shared'
import { CreateMessageEvent, MessageEventType } from '@hcengineering/communication-sdk-types'
import { ActivityCollaborativeChange, ActivityUpdateType, MessageType } from '@hcengineering/communication-types'
import core, {
  AttachedData,
  Class,
  Doc,
  generateId,
  MeasureContext,
  OperationDomain,
  Ref,
  Space,
  TxOperations
} from '@hcengineering/core'
import { StorageAdapter } from '@hcengineering/server-core'
import { areEqualMarkups } from '@hcengineering/text'
import { markupToYDoc } from '@hcengineering/text-ydoc'
import { Doc as YDoc, applyUpdate, encodeStateAsUpdate } from 'yjs'

import { Context } from '../context'
import { CollabStorageAdapter, type AuthorSegment, type DocumentSaveBatch } from './adapter'

const activityMarkupLimit = 100 * 1024 // 100kb

export interface PlatformStorageAdapterOptions {
  retryCount?: number
  retryInterval?: number
}
export class PlatformStorageAdapter implements CollabStorageAdapter {
  private readonly retryCount: number
  private readonly retryInterval: number

  constructor (
    private readonly storage: StorageAdapter,
    options: PlatformStorageAdapterOptions = {}
  ) {
    this.retryCount = options.retryCount ?? 5
    this.retryInterval = options.retryInterval ?? 50
  }

  async loadDocument (ctx: MeasureContext, documentName: string, context: Context): Promise<YDoc | undefined> {
    const { content, wsIds } = context
    const { documentId } = decodeDocumentId(documentName)

    // try to load document content
    try {
      ctx.info('load document content', { documentName })

      const ydoc = await ctx.with(
        'loadCollabYdoc',
        {},
        (ctx) => {
          return withRetry(
            ctx,
            this.retryCount,
            () => {
              return loadCollabYdoc(ctx, this.storage, wsIds, documentId)
            },
            this.retryInterval
          )
        },
        {
          workspace: context.wsIds.uuid,
          documentName
        }
      )

      if (ydoc !== undefined) {
        ctx.info('loaded from storage', { documentName })
        return ydoc
      }
    } catch (err: any) {
      Analytics.handleError(err)
      ctx.error('failed to load document content', { documentName, error: err })
      throw err
    }

    // then try to load from inital content
    if (content !== undefined) {
      try {
        ctx.info('load document initial content', { documentName, content })

        const markup = await ctx.with(
          'loadCollabJson',
          {},
          (ctx) => {
            return withRetry(ctx, 5, () => {
              return loadCollabJson(ctx, this.storage, wsIds, content)
            })
          },
          {
            workspace: context.wsIds.uuid,
            documentName
          }
        )
        if (markup !== undefined) {
          const ydoc = markupToYDoc(markup, documentId.objectAttr)

          // if document was loaded from the initial content or storage we need to save
          // it to ensure the next time we load it from the ydoc document
          await saveCollabYdoc(ctx, this.storage, wsIds, documentId, ydoc)

          ctx.info('loaded from initial content', { documentName, content })
          return ydoc
        }
      } catch (err: any) {
        Analytics.handleError(err)
        ctx.error('failed to load initial document content', { documentName, content, error: err })
        throw err
      }
    }

    // nothing found
    return undefined
  }

  async saveDocument (
    ctx: MeasureContext,
    documentName: string,
    document: YDoc,
    context: Context,
    getMarkup: {
      prev: () => Record<string, string>
      curr: () => Record<string, string>
    },
    batch?: DocumentSaveBatch
  ): Promise<Record<string, string> | undefined> {
    const { wsIds } = context
    const { documentId } = decodeDocumentId(documentName)
    // Keep the old adapter call path, with the same synchronous cutoff as segmented saves.
    const legacyDocument = batch === undefined ? new YDoc({ gc: false }) : undefined
    if (legacyDocument !== undefined) applyUpdate(legacyDocument, encodeStateAsUpdate(document))
    batch ??= {
      segments: [{ context, prev: getMarkup.prev(), curr: getMarkup.curr(), id: generateId(), timestamp: Date.now() }]
    }
    const clients = new Map<Context['account'], TxOperations>()
    const getClient = async (author: Context): Promise<TxOperations> => {
      let client = clients.get(author.account)
      if (client === undefined) {
        try {
          client = await ctx.with('connect', {}, () => author.clientFactory())
        } catch (error) {
          ctx.error('failed to connect author to platform', { documentName, account: author.account, error })
          throw error
        }
        clients.set(author.account, client)
      }
      return client
    }

    try {
      if (batch.ydocSaved !== true) {
        await ctx.with(
          'saveCollabYdoc',
          {},
          (ctx) =>
            withRetry(
              ctx,
              this.retryCount,
              () => saveCollabYdoc(ctx, this.storage, wsIds, documentId, legacyDocument ?? document),
              this.retryInterval
            ),
          {
            workspace: context.wsIds.uuid,
            documentName
          }
        )
        batch.ydocSaved = true
      }
      const last = batch.segments[batch.segments.length - 1]
      const client = await getClient(last.context)
      return await ctx.with(
        'save-to-platform',
        {},
        (ctx) => this.saveDocumentToPlatform(ctx, client, context, documentName, getMarkup, batch, getClient),
        {
          workspace: context.wsIds.uuid,
          documentName
        }
      )
    } finally {
      legacyDocument?.destroy()
      for (const client of clients.values()) {
        try {
          await client.close()
        } catch (error) {
          // Cleanup must not replay already acknowledged activity writes.
          ctx.warn('failed to close platform client', { documentName, error })
        }
      }
    }
  }

  async saveDocumentToPlatform (
    ctx: MeasureContext,
    client: Omit<TxOperations, 'close'>,
    context: Context,
    documentName: string,
    getMarkup: {
      prev: () => Record<string, string>
      curr: () => Record<string, string>
    },
    batch: DocumentSaveBatch = {
      segments: [{ context, prev: getMarkup.prev(), curr: getMarkup.curr(), id: generateId(), timestamp: Date.now() }]
    },
    getClient: (context: Context) => Promise<Omit<TxOperations, 'close'>> = async () => client
  ): Promise<Record<string, string>> {
    const { documentId } = decodeDocumentId(documentName)
    const { objectAttr, objectClass, objectId } = documentId
    const segments = batch.segments
    const curr = segments[segments.length - 1].curr
    const hierarchy = client.getHierarchy()
    const attribute = hierarchy.findAttribute(objectClass, objectAttr)
    if (attribute === undefined) {
      ctx.warn('attribute not found', { documentName, objectClass, objectAttr })
      return curr
    }

    const changed = segments.filter(
      (segment) => !areEqualMarkups(segment.prev[objectAttr] ?? '', segment.curr[objectAttr] ?? '')
    )
    // A net-zero batch may still contain real changes by several authors.
    if (changed.length === 0) return curr

    const current = await ctx.with('query', {}, () => client.findOne(objectClass, { _id: objectId }))
    if (current === undefined) {
      ctx.warn('document not found', { documentName, objectClass, objectId })
      return curr
    }
    if (!hierarchy.isDerived(attribute.type._class, core.class.TypeCollaborativeDoc)) {
      ctx.warn('unsupported attribute type', { documentName, objectClass, objectAttr })
      return curr
    }

    if (batch.platformSaved !== true) {
      const blobId = await ctx.with(
        'saveCollabJson',
        {},
        (ctx) =>
          withRetry(
            ctx,
            this.retryCount,
            () => saveCollabJson(ctx, this.storage, context.wsIds, documentId, curr[objectAttr]),
            this.retryInterval
          ),
        {
          workspace: context.wsIds.uuid,
          documentName
        }
      )
      // Use the last actual editor for modifiedBy, including net-zero batches.
      await ctx.with('update', {}, () => client.diffUpdate(current, { [objectAttr]: blobId }))
      batch.platformSaved = true
    }

    for (const segment of changed) {
      if (segment.eventSent === true && segment.activitySaved === true) continue
      const authorClient = await getClient(segment.context)
      await ctx.with(
        'activity',
        {},
        (ctx) => this.emitActivity(ctx, authorClient, current, objectClass, objectAttr, segment),
        {
          workspace: context.wsIds.uuid,
          documentName
        }
      )
    }
    return curr
  }

  private async emitActivity (
    ctx: MeasureContext,
    client: Omit<TxOperations, 'close'>,
    current: Doc,
    objectClass: Ref<Class<Doc>>,
    objectAttr: string,
    segment: AuthorSegment
  ): Promise<void> {
    segment.emittedAt ??= Date.now()
    const hierarchy = client.getHierarchy()
    const prevMarkup = segment.prev[objectAttr] ?? ''
    const currMarkup = segment.curr[objectAttr] ?? ''
    const prevValue = prevMarkup.length > activityMarkupLimit ? activity.string.ValueTooLarge : prevMarkup
    const currValue = currMarkup.length > activityMarkupLimit ? activity.string.ValueTooLarge : currMarkup
    if (segment.eventSent !== true) {
      // Communication deduplicates CreateMessage by cardId/messageId, including lost acknowledgements.
      await sendEvent(client, objectAttr, prevValue, currValue, current, segment)
      segment.eventSent = true
    }
    if (segment.activitySaved !== true) {
      const id = segment.id as Ref<DocUpdateMessage>
      // Reconcile an ambiguous addCollection acknowledgement before retrying its stable identity.
      const existing = await client.findOne(activity.class.DocUpdateMessage, { _id: id })
      if (existing === undefined) {
        const space = hierarchy.isDerived(current._class, core.class.Space)
          ? (current._id as Ref<Space>)
          : current.space
        const data: AttachedData<DocUpdateMessage> = {
          objectId: current._id,
          objectClass,
          action: 'update',
          attributeUpdates: {
            attrKey: objectAttr,
            attrClass: core.class.TypeMarkup,
            prevValue,
            set: [currValue],
            added: [],
            removed: [],
            isMixin: hierarchy.isMixin(objectClass)
          }
        }
        await client.addCollection(
          activity.class.DocUpdateMessage,
          space,
          current._id,
          current._class,
          'docUpdateMessages',
          data,
          id,
          segment.emittedAt
        )
      } else {
        ctx.info('activity already saved', { id })
      }
      segment.activitySaved = true
    }
  }
}

async function sendEvent (
  client: Omit<TxOperations, 'close'>,
  attrKey: string,
  prevValue: string,
  value: string,
  doc: Doc,
  segment: AuthorSegment
): Promise<void> {
  const eventData: ActivityCollaborativeChange = {
    type: ActivityUpdateType.CollaborativeChange,
    attrKey,
    value,
    prevValue
  }
  const event: CreateMessageEvent = {
    type: MessageEventType.CreateMessage,
    messageType: MessageType.Activity,
    messageId: (segment.messageId ??= generateMessageId()),
    cardId: doc._id,
    cardType: doc._class,
    extra: {
      action: 'update',
      update: eventData
    },
    content: '',
    socialId: client.txFactory.account,
    date: new Date(segment.emittedAt ?? segment.timestamp)
  }

  await client.domainRequest('communication' as OperationDomain, { event })
}

async function withRetry<T> (
  ctx: MeasureContext,
  retries: number,
  op: () => Promise<T>,
  delay: number = 100
): Promise<T> {
  let error: any
  while (retries > 0) {
    retries--
    try {
      return await op()
    } catch (err: any) {
      error = err
      ctx.info('error', { err, retries })
      if (retries !== 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }
  throw error
}
