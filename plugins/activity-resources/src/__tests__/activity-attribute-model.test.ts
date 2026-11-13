// SPDX-License-Identifier: EPL-2.0

import { type DocAttributeUpdates } from '@hcengineering/activity'
import { type Class, type Client, type Doc, type Ref } from '@hcengineering/core'
import { type AttributeModel } from '@hcengineering/view'
import type * as ActivityMessagesUtils from '../activityMessagesUtils'

const REF_TO = 'core:class:RefTo'
const ACTIVITY_PRESENTER = 'view:mixin:ActivityAttributePresenter'
const OBJECT_PRESENTER = 'view:mixin:ObjectPresenter'
const ISSUE = 'tracker:class:Issue' as Ref<Class<Doc>>
const NO_PARENT = 'tracker:ids:NoParent'

const findAttributePresenter = jest.fn()
const getAttributePresenter = jest.fn()

jest.mock(
  '@hcengineering/core',
  () => ({
    __esModule: true,
    default: { class: { RefTo: 'core:class:RefTo' } },
    SortingOrder: { Ascending: 1, Descending: -1 }
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/view',
  () => ({
    __esModule: true,
    default: {
      mixin: {
        ActivityAttributePresenter: 'view:mixin:ActivityAttributePresenter',
        ObjectPresenter: 'view:mixin:ObjectPresenter'
      }
    }
  }),
  { virtual: true }
)
jest.mock('@hcengineering/presentation', () => ({}), { virtual: true })
jest.mock(
  '@hcengineering/view-resources',
  () => ({
    findAttributePresenter: (...args: unknown[]) => findAttributePresenter(...args),
    getAttributePresenter: async (...args: unknown[]) => await getAttributePresenter(...args)
  }),
  { virtual: true }
)
jest.mock('@hcengineering/contact', () => ({}), { virtual: true })
jest.mock('@hcengineering/activity', () => ({}), { virtual: true })
jest.mock('@hcengineering/platform', () => ({ getResource: async (id: string) => `resource:${id}` }), {
  virtual: true
})

Object.defineProperty(globalThis, 'localStorage', {
  value: { getItem: () => null },
  configurable: true
})

const { getAttributeModel, isUnresolvedObjectRef } =
  jest.requireActual<typeof ActivityMessagesUtils>('../activityMessagesUtils')

const parentAttribute = {
  name: 'attachedTo',
  attributeOf: ISSUE,
  label: 'tracker:string:Parent',
  type: { _class: REF_TO, to: ISSUE }
}
const titleAttribute = {
  name: 'title',
  attributeOf: ISSUE,
  label: 'tracker:string:Title',
  type: { _class: 'core:class:TypeString' }
}

function makeClient (objectPresenter: string | null = 'tracker:component:IssuePresenter'): Client {
  const attributes: Record<string, unknown> = { attachedTo: parentAttribute, title: titleAttribute }
  const hierarchy = {
    findAttribute: (_class: string, key: string) => attributes[key],
    classHierarchyMixin: (_class: string, mixin: string) =>
      mixin === OBJECT_PRESENTER && _class === ISSUE && objectPresenter !== null
        ? { presenter: objectPresenter }
        : undefined
  }
  return { getHierarchy: () => hierarchy } as unknown as Client
}

function update (attrKey: string, set: string[]): DocAttributeUpdates {
  return { attrKey, attrClass: ISSUE, set, added: [], removed: [], isMixin: false }
}

describe('activity attribute model for references', () => {
  beforeEach(() => {
    findAttributePresenter.mockReset()
    getAttributePresenter.mockReset()
    jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it.each([
    ['set', ['issue-parent-1']],
    ['replaced', ['issue-parent-2']],
    ['removed', [NO_PARENT]]
  ])('presents a parent that was %s with the issue object presenter', async (_case, set) => {
    findAttributePresenter.mockReturnValue(undefined)

    const model = await getAttributeModel(makeClient(), update('attachedTo', set), ISSUE)

    expect(model).toMatchObject({
      key: 'attachedTo',
      _class: ISSUE,
      label: 'tracker:string:Parent',
      presenter: 'resource:tracker:component:IssuePresenter',
      attribute: parentAttribute
    })
    expect(getAttributePresenter).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  it('keeps an existing attribute presenter ahead of the object presenter', async () => {
    const attributeModel = { key: 'attachedTo', presenter: 'attribute-presenter' }
    findAttributePresenter.mockReturnValue('tracker:component:ParentRefPresenter')
    getAttributePresenter.mockResolvedValue(attributeModel)

    const model = await getAttributeModel(makeClient(), update('attachedTo', ['issue-parent-1']), ISSUE)

    expect(model).toBe(attributeModel)
    expect(getAttributePresenter).toHaveBeenCalledTimes(1)
    expect(getAttributePresenter.mock.calls[0][4]).toBe(ACTIVITY_PRESENTER)
  })

  it('does not use the object presenter for an attribute that is not a reference', async () => {
    const attributeModel = { key: 'title', presenter: 'string-presenter' }
    findAttributePresenter.mockReturnValue(undefined)
    getAttributePresenter.mockRejectedValueOnce(new Error('no activity presenter'))
    getAttributePresenter.mockResolvedValueOnce(attributeModel)

    const model = await getAttributeModel(makeClient(), update('title', ['New title']), ISSUE)

    expect(model).toBe(attributeModel)
    expect(getAttributePresenter).toHaveBeenCalledTimes(2)
  })

  it('returns nothing for a reference whose class has no object presenter either', async () => {
    findAttributePresenter.mockReturnValue(undefined)
    getAttributePresenter.mockRejectedValue(new Error('attribute presenter not found'))

    const model = await getAttributeModel(makeClient(null), update('attachedTo', ['issue-parent-1']), ISSUE)

    expect(model).toBeUndefined()
  })
})

describe('unresolved object references', () => {
  const client = makeClient()
  const parentModel = { key: 'attachedTo', attribute: parentAttribute } as unknown as AttributeModel
  const parentIssue = { _id: 'issue-parent-1', _class: ISSUE }

  beforeEach(() => {
    findAttributePresenter.mockReset()
    findAttributePresenter.mockReturnValue(undefined)
  })

  it('is false when the parent was set or replaced: the value resolves to an issue', () => {
    expect(isUnresolvedObjectRef(client, parentModel, [parentIssue])).toBe(false)
  })

  it('is true when the parent was removed: the placeholder id resolves to no issue', () => {
    expect(isUnresolvedObjectRef(client, parentModel, [NO_PARENT])).toBe(true)
  })

  it('is false while the values are not resolved yet', () => {
    expect(isUnresolvedObjectRef(client, parentModel, [])).toBe(false)
  })

  it('is false for a reference that has its own attribute presenter, which takes ids', () => {
    findAttributePresenter.mockReturnValue('tracker:component:ComponentRefPresenter')

    expect(isUnresolvedObjectRef(client, parentModel, ['component-1'])).toBe(false)
  })

  it('is false for an attribute that is not a reference', () => {
    const titleModel = { key: 'title', attribute: titleAttribute } as unknown as AttributeModel

    expect(isUnresolvedObjectRef(client, titleModel, ['New title'])).toBe(false)
  })
})
