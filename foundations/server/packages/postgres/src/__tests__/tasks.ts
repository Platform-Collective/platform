import core, {
  type AttachedDoc,
  type Class,
  ClassifierKind,
  type Data,
  type Doc,
  type Domain,
  DOMAIN_MODEL,
  type PersonId,
  type Ref,
  type Space,
  type Tx
} from '@hcengineering/core'
import { type IntlString, plugin, type Plugin } from '@hcengineering/platform'
import { createAttribute, createClass, createDoc } from './minmodel'

export interface TaskComment extends AttachedDoc {
  message: string
  date: Date
}

export enum TaskStatus {
  Open,
  Close,
  Resolved = 100,
  InProgress
}

export enum TaskReproduce {
  Always = 'always',
  Rare = 'rare',
  Sometimes = 'sometimes'
}

export interface Task extends Doc {
  name: string
  description: string
  rate?: number | null
  status?: TaskStatus
  reproduce?: TaskReproduce
  eta?: TaskEstimate | null
  arr?: number[]
  stat?: Ref<TStat>
}

export interface TStatCat extends Doc {
  label: string
}

export interface TStat extends Doc {
  name: string
  category: Ref<TStatCat>
}

/**
 * Define ROM and Estimated Time to arrival
 */
export interface TaskEstimate extends AttachedDoc {
  rom: number // in hours
  eta: number // in hours
}

export interface TaskMixin extends Task {
  textValue?: string
}

export interface TaskWithSecond extends Task {
  secondTask: string | null
}

const taskIds = 'taskIds' as Plugin

export const taskPlugin = plugin(taskIds, {
  class: {
    Task: '' as Ref<Class<Task>>,
    TaskEstimate: '' as Ref<Class<TaskEstimate>>,
    TaskComment: '' as Ref<Class<TaskComment>>,
    TStat: '' as Ref<Class<TStat>>,
    TStatCat: '' as Ref<Class<TStatCat>>
  },
  ids: {
    StatCatA: '' as Ref<TStatCat>,
    StatCatB: '' as Ref<TStatCat>,
    StatA: '' as Ref<TStat>,
    StatB: '' as Ref<TStat>
  }
})

/**
 * Create a random task with name specified
 * @param name
 */
export function createTask (name: string, rate: number, description: string): Data<Task> {
  return {
    name,
    description,
    rate
  }
}

export const doc1: Task = {
  _id: 'd1' as Ref<Task>,
  _class: taskPlugin.class.Task,
  name: 'my-space',
  description: 'some-value',
  rate: 20,
  modifiedBy: 'user' as PersonId,
  modifiedOn: 10,
  // createdOn: 10,
  space: '' as Ref<Space>
}

export function createTaskModel (txes: Tx[]): void {
  txes.push(
    createClass(taskPlugin.class.Task, {
      kind: ClassifierKind.CLASS,
      label: 'Task' as IntlString,
      domain: 'test-task' as Domain
    }),
    createClass(taskPlugin.class.TaskEstimate, {
      kind: ClassifierKind.CLASS,
      label: 'Estimate' as IntlString,
      domain: 'test-task' as Domain
    }),
    createClass(taskPlugin.class.TaskComment, {
      kind: ClassifierKind.CLASS,
      label: 'Comment' as IntlString,
      domain: 'test-task' as Domain
    }),
    createClass(taskPlugin.class.TStatCat, {
      kind: ClassifierKind.CLASS,
      label: 'TStatCat' as IntlString,
      domain: DOMAIN_MODEL
    }),
    createClass(taskPlugin.class.TStat, {
      kind: ClassifierKind.CLASS,
      label: 'TStat' as IntlString,
      domain: DOMAIN_MODEL
    }),
    createAttribute({
      attributeOf: taskPlugin.class.Task,
      name: 'arr',
      type: {
        _class: core.class.ArrOf,
        label: 'arr' as IntlString,
        type: core.class.TypeNumber
      }
    }),
    createDoc(taskPlugin.class.TStatCat, { label: 'cat-a' }, taskPlugin.ids.StatCatA),
    createDoc(taskPlugin.class.TStatCat, { label: 'cat-b' }, taskPlugin.ids.StatCatB),
    createDoc(taskPlugin.class.TStat, { name: 'stat-a', category: taskPlugin.ids.StatCatA }, taskPlugin.ids.StatA),
    createDoc(taskPlugin.class.TStat, { name: 'stat-b', category: taskPlugin.ids.StatCatB }, taskPlugin.ids.StatB)
  )
}
