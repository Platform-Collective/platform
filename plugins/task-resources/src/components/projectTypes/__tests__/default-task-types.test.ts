// SPDX-License-Identifier: EPL-2.0

import core, { ClassifierKind, generateId } from '@hcengineering/core'
import type { Class, Data, Doc, Ref, Status, TxOperations } from '@hcengineering/core'
import task, { createProjectType } from '@hcengineering/task'
import type { ProjectType, ProjectTypeDescriptor, Task, TaskType } from '@hcengineering/task'
import { getDefaultTaskTypes } from '../default-task-types'

const issueClass = 'test:class:Issue' as Ref<Class<Task>>
const issueStatusClass = 'test:class:IssueStatus' as Ref<Class<Status>>
const templateId = 'test:taskType:Issue' as Ref<TaskType>
const projectId = 'test:projectType:Custom' as Ref<ProjectType>
const descriptor = {
  _id: 'test:descriptor:Tracker',
  baseClass: 'test:class:Project',
  defaultTaskType: templateId
} as unknown as ProjectTypeDescriptor

const statuses = [task.statusCategory.UnStarted, task.statusCategory.Active, task.statusCategory.Won].map(
  (category, index) =>
    ({
      _id: `test:status:${index}`,
      _class: issueStatusClass,
      name: ['Backlog', 'In Progress', 'Done'][index],
      category,
      color: index,
      description: `Status ${index}`,
      ofAttribute: 'test:attribute:IssueStatus'
    }) as unknown as Status
)

const template = {
  _id: templateId,
  _class: task.class.TaskType,
  parent: 'test:projectType:Classic',
  name: 'Issue',
  descriptor: 'test:descriptor:Issue',
  ofClass: issueClass,
  targetClass: 'test:mixin:BuiltInIssue',
  kind: 'both',
  statuses: statuses.map((status) => status._id),
  statusCategories: statuses.map((status) => status.category),
  statusClass: issueStatusClass,
  allowedAsChildOf: [templateId],
  icon: 'test:icon:Issue',
  color: 7
} as unknown as TaskType

interface TestContext {
  client: TxOperations
  documents: Map<string, Doc>
  createDoc: jest.Mock<Promise<Ref<Doc>>, [Ref<Class<Doc>>, Ref<Doc>, Data<Doc>, Ref<Doc>?]>
  createMixin: jest.Mock<Promise<void>, []>
}

function setup (): TestContext {
  const documents = new Map<string, Doc>([
    [descriptor._id, descriptor],
    [templateId, template],
    ...statuses.map((status): [string, Doc] => [status._id, status])
  ])
  const createDoc = jest.fn(async (_class: Ref<Class<Doc>>, space: Ref<Doc>, data: Data<Doc>, id = generateId()) => {
    documents.set(id, { ...data, _class, space, _id: id } as unknown as Doc)
    return id
  })
  const createMixin = jest.fn(async () => {})
  const client = {
    getModel: () => ({ findObject: (id: Ref<Doc>) => documents.get(id) }),
    getHierarchy: () => ({ getClass: () => ({ label: 'test:label:Issue', icon: template.icon }) }),
    findOne: jest.fn(async (_class: Ref<Class<Doc>>, query: { _id?: Ref<Doc>, name?: string }) => {
      return query._id === undefined
        ? Array.from(documents.values()).find((doc) => doc._class === _class && (doc as Status).name === query.name)
        : documents.get(query._id)
    }),
    findAll: jest.fn(async () => []),
    createDoc,
    createMixin
  } as unknown as TxOperations
  return { client, documents, createDoc, createMixin }
}

describe('default project task types', () => {
  it('copies the configured Issue template with its workflow and a new task type id', () => {
    const { client } = setup()
    const [issue] = getDefaultTaskTypes(client, descriptor)

    expect(issue).toMatchObject({
      name: 'Issue',
      descriptor: template.descriptor,
      ofClass: issueClass,
      kind: 'both',
      statusClass: issueStatusClass,
      statusCategories: template.statusCategories,
      color: template.color,
      factory: statuses.map(({ name, category, color, ofAttribute, description }) => ({
        name,
        category,
        color,
        ofAttribute,
        description
      }))
    })
    expect(issue._id).not.toBe(templateId)
    expect(issue.allowedAsChildOf).toEqual([issue._id])
    expect(issue.targetClass).toBeUndefined()
    expect(issue.icon).toBeUndefined()
    expect(getDefaultTaskTypes(client, descriptor)[0]._id).not.toBe(issue._id)
    expect(template.allowedAsChildOf).toEqual([templateId])
  })

  it('creates a parent-local Issue kind and status links using the real createProjectType', async () => {
    const { client, documents, createMixin } = setup()
    const tasks = getDefaultTaskTypes(client, descriptor)
    await createProjectType(
      client,
      { name: 'Custom', description: '', descriptor: descriptor._id, tasks: [], roles: 0, classic: true },
      tasks,
      projectId
    )

    const project = documents.get(projectId) as ProjectType
    expect(project.tasks).toHaveLength(1)
    const issue = documents.get(project.tasks[0]) as TaskType
    expect(issue.parent).toBe(projectId)
    expect(issue.descriptor).toBe(template.descriptor)
    expect(issue.statuses).toHaveLength(statuses.length)
    expect(issue.statuses).toEqual(template.statuses)
    expect(issue.allowedAsChildOf).toEqual([issue._id])
    expect(project.statuses).toEqual(issue.statuses.map((_id) => ({ _id, taskType: issue._id })))
    expect(documents.get(issue.targetClass)).toMatchObject({
      _class: core.class.Mixin,
      extends: issueClass,
      kind: ClassifierKind.MIXIN
    })
    expect(issue.targetClass).not.toBe(template.targetClass)
    expect(createMixin).toHaveBeenCalledWith(
      issue.targetClass,
      core.class.Mixin,
      core.space.Model,
      task.mixin.TaskTypeClass,
      { taskType: issue._id, projectType: projectId }
    )
  })

  it('returns independent workflow data without modifying the template or its statuses', () => {
    const { client } = setup()
    const [issue] = getDefaultTaskTypes(client, descriptor)
    const [otherIssue] = getDefaultTaskTypes(client, descriptor)

    issue.statusCategories.pop()
    issue.allowedAsChildOf?.pop()
    issue.factory[0].name = 'Changed'

    expect(otherIssue.statusCategories).toEqual(template.statusCategories)
    expect(otherIssue.allowedAsChildOf).toEqual([otherIssue._id])
    expect(otherIssue.factory[0].name).toBe(statuses[0].name)
    expect(template.statusCategories).toHaveLength(statuses.length)
    expect(template.allowedAsChildOf).toEqual([templateId])
    expect(statuses[0].name).toBe('Backlog')
  })

  it('remaps only self references in allowed child types', () => {
    const { client, documents } = setup()
    const otherType = 'test:taskType:Other' as Ref<TaskType>
    const restrictedTemplate: TaskType = { ...template, allowedAsChildOf: [templateId, otherType] }
    documents.set(templateId, restrictedTemplate)

    const [issue] = getDefaultTaskTypes(client, descriptor)
    expect(issue.allowedAsChildOf).toEqual([issue._id, otherType])
  })

  it('preserves an unrestricted child configuration', () => {
    const { client, documents } = setup()
    const unrestrictedTemplate: TaskType = { ...template, allowedAsChildOf: undefined }
    documents.set(templateId, unrestrictedTemplate)

    expect(getDefaultTaskTypes(client, descriptor)[0].allowedAsChildOf).toBeUndefined()
  })

  it('keeps descriptors without a default task type empty', () => {
    const { client } = setup()
    expect(getDefaultTaskTypes(client, { ...descriptor, defaultTaskType: undefined })).toEqual([])
  })

  it('fails before writing a project type if the configured template is missing', () => {
    const { client, documents, createDoc } = setup()
    documents.delete(templateId)
    expect(() => getDefaultTaskTypes(client, descriptor)).toThrow(`Default task type not found: ${templateId}`)
    expect(createDoc).not.toHaveBeenCalled()
  })

  it('fails before writing a project type if a configured status is missing', () => {
    const { client, documents, createDoc } = setup()
    documents.delete(statuses[0]._id)
    expect(() => getDefaultTaskTypes(client, descriptor)).toThrow(
      `Default task type status not found: ${statuses[0]._id}`
    )
    expect(createDoc).not.toHaveBeenCalled()
  })
})
