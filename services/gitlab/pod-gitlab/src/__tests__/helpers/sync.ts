// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */

import type { Class, Doc, Ref } from '@hcengineering/core'
import gitlab from '@hcengineering/gitlab'
import type { DocSyncManager } from '../../sync/types'
import type { MemoryClient } from './memory'
import { ctx } from './provider'

// A Huly doc and its DocSyncInfo share the same _id; these pick one by class
export function docOf (memory: MemoryClient, id: string, _class: Ref<Class<Doc>>): any {
  return memory.docs.find((d) => d._id === id && d._class === _class)
}

export function syncDocOf (memory: MemoryClient, id: string): any {
  return docOf(memory, id, gitlab.class.DocSyncInfo)
}

export function syncDocsOf (memory: MemoryClient): any[] {
  return memory.docs.filter((d) => d._class === gitlab.class.DocSyncInfo)
}

/** Lets pending callbacks run until `ready` holds; fails the test when it never does. */
export async function waitUntil (ready: () => boolean, turns = 50): Promise<void> {
  for (let i = 0; i < turns && !ready(); i++) await new Promise<void>((resolve) => setImmediate(resolve))
  if (!ready()) throw new Error('waitUntil: condition not reached')
}

/**
 * Lets already-started callbacks run for a bounded number of macrotask turns. Use it where a test asserts that
 * something has NOT happened yet; waiting on a condition there would make the assertion vacuous.
 */
export async function flushPending (turns = 1): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

/** What the worker does for one pending doc: sync it with its Huly doc and store the result. */
export async function runSync (
  manager: Pick<DocSyncManager, 'sync'>,
  memory: MemoryClient,
  id: string,
  hulyClass: Ref<Class<Doc>>
): Promise<any> {
  const info = syncDocOf(memory, id)
  const existing = docOf(memory, id, hulyClass)
  const update = await manager.sync(ctx, existing === undefined ? undefined : { ...existing }, { ...info }, undefined)
  await memory.update(info, update)
  return update
}
