/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import contact from '@hcengineering/contact'
import core, { type Class, type Doc, type Ref, type TxOperations } from '@hcengineering/core'
import task, { type Project as TaskProject } from '@hcengineering/task'
import tracker, { MilestoneStatus } from '@hcengineering/tracker'

/** Names of the milestone statuses, indexed by their enum value. */
export const MILESTONE_STATUS_NAMES = Object.keys(MilestoneStatus).filter((key) => Number.isNaN(Number(key)))

/** Hard ceiling on rows any list tool may return, regardless of what is asked. */
export const MAX_PAGE_SIZE = 200
export const DEFAULT_PAGE_SIZE = 50

/**
 * Clamps a caller-supplied page size.
 *
 * The bound is a correctness guard, not a preference: an unbounded `findAll`
 * against a large project would try to serialise thousands of documents into a
 * model response and blow up both latency and the model's context window.
 */
export function clampLimit (value: unknown, fallback: number = DEFAULT_PAGE_SIZE): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(Math.max(1, Math.floor(value)), MAX_PAGE_SIZE)
}

export function toIso (timestamp: number | null | undefined): string | null {
  if (timestamp === null || timestamp === undefined || timestamp === 0) return null
  return new Date(timestamp).toISOString()
}

/**
 * The id types crossing the tool boundary are plain strings.
 *
 * Tool arguments arrive as JSON, so a `Ref<T>` in a tool signature is fiction
 * that only the compiler believes. Accepting `string` here and casting once
 * inside the query keeps the branded types where they are useful and stops
 * every call site from needing a cast.
 */
export type MaybeId = string | null | undefined

export function uniqueIds (values: MaybeId[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
}

export async function findByIds<T extends Doc> (
  client: TxOperations,
  _class: Ref<Class<T>>,
  ids: MaybeId[]
): Promise<T[]> {
  const wanted = uniqueIds(ids)
  if (wanted.length === 0) return []
  const query: Record<string, unknown> = { _id: { $in: wanted } }
  return await client.findAll(_class, query as never, { limit: wanted.length })
}

/**
 * Resolves social ids to display names in one round trip.
 *
 * Person docs are workspace-local; the `AccountUuid` behind them is global.
 * Tools only ever need the name, so the global id is never surfaced.
 */
export async function personNames (client: TxOperations, socialIds: MaybeId[]): Promise<Map<string, string>> {
  const persons = await findByIds(client, contact.class.Person, socialIds)
  return new Map(persons.map((person) => [person._id, person.name]))
}

export interface StatusInfo {
  name: string
  category: string | null
}

/**
 * Resolves status ids to their human labels.
 *
 * `Status.name` is a plain string (it is what case-insensitive status matching
 * keys off), so no i18n loader is needed on the server. The category *label* is
 * an IntlString, so `defaultStatusName` is used as the readable stand-in.
 */
export async function statusNames (client: TxOperations, refs: MaybeId[]): Promise<Map<string, StatusInfo>> {
  const statuses = await findByIds(client, tracker.class.IssueStatus, refs)
  const categories = await findByIds(client, core.class.StatusCategory, uniqueIds(statuses.map((s) => s.category)))

  const categoryByRef = new Map(categories.map((category) => [category._id, category.defaultStatusName]))

  return new Map(
    statuses.map((status) => [
      status._id,
      {
        name: status.name,
        category: status.category === undefined ? null : (categoryByRef.get(status.category) ?? null)
      }
    ])
  )
}

export interface ProjectInfo {
  name: string
  identifier: string | null
}

interface ProjectRow {
  _id: string
  name: string
  identifier?: string
}

/**
 * Resolves space ids to names for both tracker projects and task projects.
 *
 * They are separate classes in Huly but behave identically from a caller's
 * point of view, so tools accept either kind of id.
 */
export async function projectNames (client: TxOperations, refs: MaybeId[]): Promise<Map<string, ProjectInfo>> {
  const wanted = uniqueIds(refs)
  if (wanted.length === 0) return new Map()

  // `findAll` widens these classes to their `Space` base, so the row shape is
  // restated locally instead of borrowed from the plugin package.
  const query: Record<string, unknown> = { _id: { $in: wanted } }
  const [projects, taskProjects] = await Promise.all([
    client.findAll(tracker.class.Project, query as never, { limit: wanted.length }),
    client.findAll(task.class.Project, query as never, { limit: wanted.length })
  ])

  const result = new Map<string, ProjectInfo>()
  for (const project of projects as unknown as ProjectRow[]) {
    result.set(project._id, { name: project.name, identifier: project.identifier ?? null })
  }
  // `task.class.Project` is the base class of `tracker.class.Project`, so this
  // query returns the tracker projects again. Only fill in ids not seen yet, or
  // the identifier gathered above would be overwritten with null.
  for (const project of taskProjects as unknown as Array<{ _id: string, name: string }>) {
    if (!result.has(project._id)) result.set(project._id, { name: project.name, identifier: null })
  }
  return result
}

/** Names a task project without the tracker lookup, for task-only listings. */
export async function taskProjectNames (client: TxOperations, refs: MaybeId[]): Promise<Map<string, ProjectInfo>> {
  const wanted = uniqueIds(refs)
  if (wanted.length === 0) return new Map()

  const query: Record<string, unknown> = { _id: { $in: wanted } }
  const projects = await client.findAll(task.class.Project, query as never, { limit: wanted.length })
  return new Map(
    (projects as unknown as Array<{ _id: string, name: string }>).map((project) => [
      project._id,
      { name: project.name, identifier: null }
    ])
  )
}

/** Casts a JSON-supplied id to a `Ref<T>` for use in a typed query. */
export const asRef = <T extends Doc>(id: string): Ref<T> => id as Ref<T>
export const asTaskProjectRef = asRef<TaskProject>

/** Builds a case-insensitive "contains" pattern with LIKE wildcards in the input escaped. */
export function likePattern (needle: string): string {
  return `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
}
