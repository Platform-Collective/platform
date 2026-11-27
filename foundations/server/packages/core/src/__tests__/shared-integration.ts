//
// Copyright © 2024 Hardcore Engineering Inc.
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

/**
 * Shared integration test suite for database adapters (MongoDB and PostgreSQL)
 * These tests verify that both adapters work correctly against real database instances
 *
 * Usage in your adapter test file:
 * ```typescript
 * import { runSharedIntegrationTests } from '@hcengineering/server-core/src/__tests__/shared-integration.test'
 *
 * describe('My Adapter Tests', () => {
 *   // ... setup code ...
 *
 *   runSharedIntegrationTests('PostgreSQL', () => ({
 *     client,
 *     operations,
 *     taskPlugin
 *   }))
 * })
 * ```
 */

import core, {
  type Class,
  type Client,
  type Doc,
  type DocumentQuery,
  matchQuery,
  type Ref,
  SortingOrder,
  type Space,
  type TxOperations
} from '@hcengineering/core'

/**
 * Test context provided to the shared test suite
 */
export interface TestContext {
  client: Client
  operations: TxOperations
  taskPlugin: any
}

/**
 * Run shared integration tests for a database adapter
 * @param adapterName - Name of the adapter being tested (e.g., 'PostgreSQL', 'MongoDB')
 * @param getContext - Function that returns the current test context
 */
export function runSharedIntegrationTests (adapterName: string, getContext: () => TestContext): void {
  describe(`${adapterName} - Shared Integration Tests`, () => {
    describe('Basic CRUD Operations', () => {
      it('should create a document', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Integration Test Task',
          description: 'Testing real database',
          rate: 42
        })

        expect(taskId).toBeDefined()

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, {})
        expect(tasks).toHaveLength(1)
        expect(tasks[0].name).toBe('Integration Test Task')
        expect(tasks[0].rate).toBe(42)
      })

      it('should update a document', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Initial Name',
          description: 'Initial Description',
          rate: 10
        })

        await operations.updateDoc(taskPlugin.class.Task, '' as Ref<Space>, taskId, {
          name: 'Updated Name',
          rate: 20
        } as any)

        const task: any = await client.findOne(taskPlugin.class.Task, { _id: taskId })
        expect(task?.name).toBe('Updated Name')
        expect(task?.rate).toBe(20)
      })

      it('should delete a document', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'To Be Deleted',
          description: 'This will be removed',
          rate: 5
        })

        let tasks: any[] = await client.findAll(taskPlugin.class.Task, {})
        expect(tasks).toHaveLength(1)

        await operations.removeDoc(taskPlugin.class.Task, '' as Ref<Space>, taskId)

        tasks = await client.findAll(taskPlugin.class.Task, {})
        expect(tasks).toHaveLength(0)
      })

      it('should create multiple documents', async () => {
        const { operations, client, taskPlugin } = getContext()

        for (let i = 0; i < 50; i++) {
          await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
            name: `my-task-${i}`,
            description: `${i * i}`,
            rate: 20 + i
          })
        }

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, {})
        expect(tasks.length).toEqual(50)
      })
    })

    describe('Array Operations', () => {
      it('should handle $push operation on arrays', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Array Test',
          description: 'Testing arrays',
          rate: 1,
          arr: []
        })

        await operations.updateDoc(taskPlugin.class.Task, '' as Ref<Space>, taskId, {
          $push: { arr: 10 }
        })

        let task: any = await client.findOne(taskPlugin.class.Task, { _id: taskId })
        expect(task?.arr).toEqual([10])

        await operations.updateDoc(taskPlugin.class.Task, '' as Ref<Space>, taskId, {
          $push: { arr: 20 }
        })

        task = await client.findOne(taskPlugin.class.Task, { _id: taskId })
        expect(task?.arr).toEqual([10, 20])
      })

      it('should handle $pull operation on arrays', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Array Pull Test',
          description: 'Testing array removal',
          rate: 1,
          arr: [1, 2, 3, 4, 5]
        })

        await operations.updateDoc(taskPlugin.class.Task, '' as Ref<Space>, taskId, {
          $pull: { arr: 3 }
        })

        const task: any = await client.findOne(taskPlugin.class.Task, { _id: taskId })
        expect(task?.arr).toEqual([1, 2, 4, 5])
      })

      it('should handle arrays with various data types', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Mixed Array Test',
          description: 'Testing mixed types',
          rate: 1,
          arr: [1, 2, 3]
        })

        const task: any = await client.findOne(taskPlugin.class.Task, { _id: taskId })
        expect(task?.arr).toEqual([1, 2, 3])
      })
    })

    describe('Numeric Operations', () => {
      it('should handle $inc operation', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Increment Test',
          description: 'Testing increment',
          rate: 100
        })

        await operations.updateDoc(taskPlugin.class.Task, '' as Ref<Space>, taskId, {
          $inc: { rate: 50 }
        } as any)

        let task: any = await client.findOne(taskPlugin.class.Task, { _id: taskId })
        expect(task?.rate).toBe(150)

        await operations.updateDoc(taskPlugin.class.Task, '' as Ref<Space>, taskId, {
          $inc: { rate: -30 }
        } as any)

        task = await client.findOne(taskPlugin.class.Task, { _id: taskId })
        expect(task?.rate).toBe(120)
      })

      it('should handle null values', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Null Test',
          description: 'Testing null',
          rate: 50
        })

        await operations.updateDoc(taskPlugin.class.Task, '' as Ref<Space>, taskId, {
          rate: null
        } as any)

        const task: any = await client.findOne(taskPlugin.class.Task, { _id: taskId })
        expect(task?.rate).toBeNull()
      })
    })

    describe('Query Operations', () => {
      beforeEach(async () => {
        const { operations, taskPlugin } = getContext()
        // Create test data (0, 10, 20, ..., 90)
        for (let i = 0; i < 10; i++) {
          await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
            name: `Task ${i}`,
            description: `Description ${i}`,
            rate: i * 10,
            arr: new Array(i).fill(i)
          })
        }
      })

      it('should filter by exact match', async () => {
        const { client, taskPlugin } = getContext()

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, { name: 'Task 5' })
        expect(tasks).toHaveLength(1)
        expect(tasks[0].name).toBe('Task 5')
      })

      it('should filter using $like operator', async () => {
        const { client, taskPlugin } = getContext()

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, {
          name: { $like: '%0' }
        })
        expect(tasks.length).toBeGreaterThanOrEqual(1)
        expect(tasks.every((t: any) => t.name.endsWith('0'))).toBe(true)
      })

      it('should filter using $in operator', async () => {
        const { client, taskPlugin } = getContext()

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, {
          rate: { $in: [10, 20, 30] }
        })
        expect(tasks).toHaveLength(3)
        const rates = tasks.map((t: any) => t.rate).sort((a: number, b: number) => a - b)
        expect(rates).toEqual([10, 20, 30])
      })

      it('should filter using $gt and $lt operators', async () => {
        const { client, taskPlugin } = getContext()

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, {
          rate: { $gt: 20, $lt: 70 }
        })
        expect(tasks.length).toBeGreaterThan(0)
        expect(tasks.every((t: any) => t.rate != null && t.rate > 20 && t.rate < 70)).toBe(true)
      })

      it('should filter using $size operator on arrays', async () => {
        const { client, taskPlugin } = getContext()

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, {
          arr: { $size: 5 }
        })
        expect(tasks).toHaveLength(1)
        expect(tasks[0].arr).toHaveLength(5)
      })

      it('should handle sorting ascending', async () => {
        const { client, taskPlugin } = getContext()

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, {}, { sort: { rate: SortingOrder.Ascending } })
        expect(tasks).toHaveLength(10)
        expect(tasks[0].rate).toBe(0)
        expect(tasks[9].rate).toBe(90)
      })

      it('should handle sorting descending', async () => {
        const { client, taskPlugin } = getContext()

        const tasks: any[] = await client.findAll(
          taskPlugin.class.Task,
          {},
          { sort: { rate: SortingOrder.Descending } }
        )
        expect(tasks).toHaveLength(10)
        expect(tasks[0].rate).toBe(90)
        expect(tasks[9].rate).toBe(0)
      })

      it('should handle limit', async () => {
        const { client, taskPlugin } = getContext()

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, {}, { limit: 5 })
        expect(tasks).toHaveLength(5)
      })

      it('should handle combined limit and sort', async () => {
        const { client, taskPlugin } = getContext()

        const tasks: any[] = await client.findAll(
          taskPlugin.class.Task,
          {},
          {
            limit: 3,
            sort: { rate: SortingOrder.Descending }
          }
        )
        expect(tasks).toHaveLength(3)
        expect(tasks[0].rate).toBe(90)
        expect(tasks[1].rate).toBe(80)
        expect(tasks[2].rate).toBe(70)
      })
    })

    describe('Attachments and Collections', () => {
      it('should create and query attached documents', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Parent Task',
          description: 'Has comments',
          rate: 10
        })

        await operations.addCollection(
          taskPlugin.class.TaskComment,
          '' as Ref<Space>,
          taskId,
          taskPlugin.class.Task,
          'tasks',
          {
            message: 'First comment',
            date: new Date()
          }
        )

        await operations.addCollection(
          taskPlugin.class.TaskComment,
          '' as Ref<Space>,
          taskId,
          taskPlugin.class.Task,
          'tasks',
          {
            message: 'Second comment',
            date: new Date()
          }
        )

        const comments: any[] = await client.findAll(taskPlugin.class.TaskComment, {
          attachedTo: taskId
        })

        expect(comments).toHaveLength(2)
        expect(comments[0].message).toBe('First comment')
        expect(comments[1].message).toBe('Second comment')
      })

      it('should handle lookups on attached documents', async () => {
        const { operations, client, taskPlugin } = getContext()

        const taskId = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Task with Lookup',
          description: 'Testing lookup',
          rate: 25
        })

        const commentId = await operations.addCollection(
          taskPlugin.class.TaskComment,
          '' as Ref<Space>,
          taskId,
          taskPlugin.class.Task,
          'tasks',
          {
            message: 'Comment with lookup',
            date: new Date()
          }
        )

        const comments: any[] = await client.findAll(
          taskPlugin.class.TaskComment,
          { _id: commentId },
          {
            lookup: { attachedTo: taskPlugin.class.Task } as any
          }
        )

        expect(comments).toHaveLength(1)
        expect(comments[0].$lookup?.attachedTo).toBeDefined()
        expect(comments[0].$lookup?.attachedTo._id).toEqual(taskId)
      })
    })

    describe('Associations', () => {
      it('should handle document associations', async () => {
        const { operations, client, taskPlugin } = getContext()

        const association = await operations.findOne(core.class.Association, {})
        if (association == null) {
          // Skip if no associations defined in model
          return
        }

        const firstTask = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'my-task',
          description: 'Descr',
          rate: 20
        })

        const secondTask = await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'my-task2',
          description: 'Descr',
          rate: 20
        })

        await operations.createDoc(core.class.Relation, '' as Ref<Space>, {
          docA: firstTask,
          docB: secondTask,
          association: association._id
        })

        const r: any[] = await client.findAll(
          taskPlugin.class.Task,
          { _id: firstTask },
          {
            associations: [[association._id, 1]]
          }
        )
        expect(r.length).toEqual(1)
        expect(r[0].$associations?.[`${association._id}_b`][0]?._id).toEqual(secondTask)
      })
    })

    describe('Lists of links', () => {
      // A list of { _id, _class } objects, like an issue's "blocked by" or "related to".
      // Filters over such a list send its objects inside $in / $all.
      const linkA = { _id: 'link-a' as Ref<Doc>, _class: 'class:Linked' as Ref<Class<Doc>> }
      const linkB = { _id: 'link-b' as Ref<Doc>, _class: 'class:Linked' as Ref<Class<Doc>> }
      const linkC = { _id: 'link-c' as Ref<Doc>, _class: 'class:Linked' as Ref<Class<Doc>> }
      const unknownLink = { _id: 'link-unknown' as Ref<Doc>, _class: 'class:Linked' as Ref<Class<Doc>> }

      async function findNames (linksQuery: any): Promise<string[]> {
        const { client, taskPlugin } = getContext()
        const query: DocumentQuery<Doc> = { links: linksQuery }
        const found: any[] = await client.findAll(taskPlugin.class.Task, query)
        const names = found.map((it) => it.name).sort((a, b) => a.localeCompare(b))

        // The client's live queries decide with matchQuery whether a changed document enters or leaves
        // a result, so it has to agree with the database.
        const all = await client.findAll<Doc>(taskPlugin.class.Task, {})
        const matched: any[] = matchQuery(all, query, taskPlugin.class.Task, client.getHierarchy())
        expect(matched.map((it) => it.name).sort((a, b) => a.localeCompare(b))).toEqual(names)
        return names
      }

      it('should match $in and $all over a list of link objects, also after links change', async () => {
        const { operations, taskPlugin } = getContext()
        const space = '' as Ref<Space>
        const create = async (name: string, links?: any[]): Promise<Ref<Doc>> =>
          await operations.createDoc(taskPlugin.class.Task, space, {
            name,
            description: '',
            rate: 0,
            ...(links !== undefined ? { links } : {})
          })

        const t1 = await create('t1', [linkA, linkB])
        const t2 = await create('t2', [linkA])
        // Same link as linkB, with its keys in another order.
        await create('t3', [{ _class: linkB._class, _id: linkB._id }, linkC])
        await create('t4', [])
        await create('t5')

        expect(await findNames({ $in: [linkA, linkB] })).toEqual(['t1', 't2', 't3'])
        expect(await findNames({ $in: [linkC] })).toEqual(['t3'])
        expect(await findNames({ $in: [unknownLink] })).toEqual([])
        expect(await findNames({ $all: [linkA, linkB] })).toEqual(['t1'])
        expect(await findNames({ $all: [linkA] })).toEqual(['t1', 't2'])
        expect(await findNames({ $all: [linkB] })).toEqual(['t1', 't3'])
        expect(await findNames({ $all: [linkA, unknownLink] })).toEqual([])

        // Links change after the filter is applied, the way the tracker adds and removes them.
        await operations.updateDoc(taskPlugin.class.Task, space, t2, {
          $push: { links: { _id: linkB._id, _class: linkB._class } }
        })
        expect(await findNames({ $all: [linkA, linkB] })).toEqual(['t1', 't2'])

        await operations.updateDoc(taskPlugin.class.Task, space, t1, { $pull: { links: { _id: linkA._id } } })
        expect(await findNames({ $all: [linkA, linkB] })).toEqual(['t2'])
        expect(await findNames({ $in: [linkA] })).toEqual(['t2'])
        expect(await findNames({ $in: [linkA, linkB] })).toEqual(['t1', 't2', 't3'])
      })

      it('should match links by _id and _class, with $nin, null and empty operands', async () => {
        const { operations, taskPlugin } = getContext()
        const space = '' as Ref<Space>
        const create = async (name: string, links?: any[] | null): Promise<void> => {
          await operations.createDoc(taskPlugin.class.Task, space, {
            name,
            description: '',
            rate: 0,
            ...(links !== undefined ? { links } : {})
          })
        }

        await create('t1', [linkA, linkB])
        await create('t2', [linkA])
        // Same link as linkB, with its keys in another order.
        await create('t3', [{ _class: linkB._class, _id: linkB._id }, linkC])
        await create('t4', [])
        await create('t5')
        // Same link as linkA, stored with an extra field.
        await create('t6', [{ ...linkA, title: 'extra' }])
        await create('t7', null)
        await create('t8', [null, linkC])
        // An object that is not a link.
        await create('t9', [{ kind: 'note', title: 'x' }])

        // A link is identified by _id and _class only, in the query too.
        expect(await findNames(linkA)).toEqual(['t1', 't2', 't6'])
        expect(await findNames({ $in: [linkA] })).toEqual(['t1', 't2', 't6'])
        expect(await findNames({ $in: [{ ...linkA, title: 'other' }] })).toEqual(['t1', 't2', 't6'])
        expect(await findNames({ $all: [linkA] })).toEqual(['t1', 't2', 't6'])
        expect(await findNames({ $all: [linkB, linkC] })).toEqual(['t3'])
        expect(await findNames({ $in: [{ ...linkA, _class: 'class:Other' }] })).toEqual([])

        // $nin is the complement of $in: documents without the field or with a null field are kept.
        expect(await findNames({ $nin: [linkA] })).toEqual(['t3', 't4', 't5', 't7', 't8', 't9'])
        expect(await findNames({ $nin: [linkA, linkC] })).toEqual(['t4', 't5', 't7', 't9'])

        // null matches a missing field, a null field and a null item.
        expect(await findNames({ $in: [linkA, null] })).toEqual(['t1', 't2', 't5', 't6', 't7', 't8'])
        expect(await findNames({ $in: [linkB, null] })).toEqual(['t1', 't3', 't5', 't7', 't8'])
        expect(await findNames({ $nin: [linkA, null] })).toEqual(['t3', 't4', 't9'])

        // Empty operands: $in matches nothing, $all every list.
        expect(await findNames({ $in: [] })).toEqual([])
        expect(await findNames({ $all: [] })).toEqual(['t1', 't2', 't3', 't4', 't6', 't8', 't9'])

        // $all needs a list: a null operand matches a null item, not a missing or null field.
        expect(await findNames({ $all: [null] })).toEqual(['t8'])
        expect(await findNames({ $all: [null, linkC] })).toEqual(['t8'])

        // Literal values stay literal: an empty list matches only the empty list.
        expect(await findNames([])).toEqual(['t4'])
        expect(await findNames({})).toEqual([])

        // Key order does not matter in literal lists and objects; t3 stores linkB with its keys reversed.
        expect(await findNames([linkB, linkC])).toEqual(['t3'])
        expect(await findNames([{ _class: linkB._class, _id: linkB._id }, linkC])).toEqual(['t3'])
        expect(await findNames([linkC, linkB])).toEqual([])
        // An object that is not a link matches an equal item, whatever the order of its keys.
        expect(await findNames({ kind: 'note', title: 'x' })).toEqual(['t9'])
        expect(await findNames({ title: 'x', kind: 'note' })).toEqual(['t9'])
        expect(await findNames({ kind: 'note' })).toEqual([])
        expect(await findNames({ $in: [{ title: 'x', kind: 'note' }] })).toEqual(['t9'])
        expect(await findNames({ $all: [{ title: 'x', kind: 'note' }] })).toEqual(['t9'])
        expect(await findNames({ $nin: [{ title: 'x', kind: 'note' }] })).toEqual([
          't1',
          't2',
          't3',
          't4',
          't5',
          't6',
          't7',
          't8'
        ])
      })

      it('should match links of a looked-up document', async () => {
        const { operations, client, taskPlugin } = getContext()
        const space = '' as Ref<Space>
        const createTask = async (name: string, links: any[]): Promise<Ref<Doc>> =>
          await operations.createDoc(taskPlugin.class.Task, space, { name, description: '', rate: 0, links })
        const createComment = async (message: string, attachedTo: Ref<Doc>): Promise<void> => {
          await operations.addCollection(
            taskPlugin.class.TaskComment,
            space,
            attachedTo,
            taskPlugin.class.Task,
            'tasks',
            {
              message,
              date: new Date()
            }
          )
        }

        // The parent's link to linkA is stored with an extra field.
        await createComment('on-parent', await createTask('parent', [{ ...linkA, title: 'extra' }, linkB]))
        await createComment('on-other', await createTask('other', [linkB]))

        async function findMessages (linksQuery: any): Promise<string[]> {
          const query: DocumentQuery<Doc> = { '$lookup.attachedTo.links': linksQuery }
          const options = { lookup: { attachedTo: taskPlugin.class.Task } as any }
          const found: any[] = await client.findAll(taskPlugin.class.TaskComment, query, options)
          const messages = found.map((it) => it.message).sort((a, b) => a.localeCompare(b))

          // The live query matches the comments with the parent they carry in $lookup.
          const all = await client.findAll<Doc>(taskPlugin.class.TaskComment, {}, options)
          const matched: any[] = matchQuery(all, query, taskPlugin.class.TaskComment, client.getHierarchy())
          expect(matched.map((it) => it.message).sort((a, b) => a.localeCompare(b))).toEqual(messages)
          return messages
        }

        expect(await findMessages({ $in: [linkA] })).toEqual(['on-parent'])
        expect(await findMessages({ $in: [linkA, linkB] })).toEqual(['on-other', 'on-parent'])
        expect(await findMessages({ $all: [linkA, linkB] })).toEqual(['on-parent'])
        expect(await findMessages({ $all: [linkB] })).toEqual(['on-other', 'on-parent'])
        expect(await findMessages({ $nin: [linkA] })).toEqual(['on-other'])
      })

      it('should match links that only a subclass of the looked-up class declares', async () => {
        const { operations, client, taskPlugin } = getContext()
        const space = '' as Ref<Space>
        const createComment = async (message: string, attachedTo: Ref<Doc>): Promise<void> => {
          await operations.addCollection(
            taskPlugin.class.TaskComment,
            space,
            attachedTo,
            taskPlugin.class.Task,
            'tasks',
            {
              message,
              date: new Date()
            }
          )
        }
        // Only LinkedTask declares "related"; the lookup names its base class Task.
        const linked = await operations.createDoc(taskPlugin.class.LinkedTask, space, {
          name: 'linked',
          description: '',
          rate: 0,
          related: [{ ...linkA, title: 'extra' }]
        })
        const plain = await operations.createDoc(taskPlugin.class.Task, space, {
          name: 'plain',
          description: '',
          rate: 0
        })
        await createComment('on-linked', linked)
        await createComment('on-plain', plain)

        async function findMessages (linksQuery: any): Promise<string[]> {
          const query: DocumentQuery<Doc> = { '$lookup.attachedTo.related': linksQuery }
          const lookup = { attachedTo: taskPlugin.class.Task } as any
          const found: any[] = await client.findAll(taskPlugin.class.TaskComment, query, { lookup })
          const messages = found.map((it) => it.message).sort((a, b) => a.localeCompare(b))

          // The live query passes the lookup, so it resolves the attribute the same way.
          const all = await client.findAll<Doc>(taskPlugin.class.TaskComment, {}, { lookup })
          const hierarchy = client.getHierarchy()
          const matched: any[] = matchQuery(all, query, taskPlugin.class.TaskComment, hierarchy, false, lookup)
          expect(matched.map((it) => it.message).sort((a, b) => a.localeCompare(b))).toEqual(messages)
          return messages
        }

        expect(await findMessages({ $in: [linkA] })).toEqual(['on-linked'])
        expect(await findMessages({ $all: [linkA] })).toEqual(['on-linked'])
        expect(await findMessages(linkA)).toEqual(['on-linked'])
        expect(await findMessages({ $nin: [linkA] })).toEqual(['on-plain'])
      })
    })

    describe('Date Handling', () => {
      it('should handle Date objects correctly', async () => {
        const { operations, client, taskPlugin } = getContext()

        const now = new Date()
        const commentId = await operations.createDoc(taskPlugin.class.TaskComment, '' as Ref<Space>, {
          message: 'Date test',
          date: now,
          attachedTo: 'test' as Ref<any>,
          attachedToClass: taskPlugin.class.Task,
          collection: 'comments'
        })

        const comment: any = await client.findOne(taskPlugin.class.TaskComment, { _id: commentId })
        expect(comment?.date).toBeDefined()
        const commentDate = new Date(comment?.date)
        expect(commentDate.getTime()).toBe(now.getTime())
      })
    })

    describe('Document Structure', () => {
      it('should have correct document structure', async () => {
        const { operations, client, taskPlugin } = getContext()

        await operations.createDoc(taskPlugin.class.Task, '' as Ref<Space>, {
          name: 'Schema Test',
          description: 'Testing schema',
          rate: 1
        })

        const tasks: any[] = await client.findAll(taskPlugin.class.Task, {})
        expect(tasks).toHaveLength(1)

        // Verify required fields exist
        const task = tasks[0]
        expect(task._id).toBeDefined()
        expect(task._class).toBeDefined()
        expect(task.space).toBeDefined()
        expect(task.name).toBeDefined()
      })
    })
  })
}
