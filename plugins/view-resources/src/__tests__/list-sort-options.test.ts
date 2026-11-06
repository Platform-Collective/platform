// SPDX-License-Identifier: EPL-2.0

import core, {
  ClassifierKind,
  DOMAIN_MODEL,
  Hierarchy,
  ModelDb,
  SortingOrder,
  TxFactory,
  type Class,
  type Doc,
  type FindOptions,
  type Ref,
  type Status
} from '@hcengineering/core'
import { type IntlString } from '@hcengineering/platform'
import { getListSortOptions } from '../components/list/sort-options'

interface Issue extends Doc {
  status: Ref<Status>
}

const ISSUE_CLASS = 'tracker:class:Issue' as Ref<Class<Issue>>
const STATUS_CLASS = 'tracker:class:IssueStatus' as Ref<Class<Status>>
const txFactory = new TxFactory(core.account.System)

function createHierarchy (): Hierarchy {
  const hierarchy = new Hierarchy()
  for (const [_id, parent] of [
    [core.class.Obj, undefined],
    [core.class.Doc, core.class.Obj],
    [core.class.Class, core.class.Doc],
    [core.class.Attribute, core.class.Doc],
    [core.class.Type, core.class.Obj],
    [core.class.RefTo, core.class.Type],
    [core.class.Status, core.class.Doc],
    [STATUS_CLASS, core.class.Status],
    [ISSUE_CLASS, core.class.Doc]
  ] as const) {
    hierarchy.tx(
      txFactory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        { kind: ClassifierKind.CLASS, label: 'Class' as IntlString, extends: parent, domain: DOMAIN_MODEL },
        _id
      )
    )
  }
  hierarchy.tx(
    txFactory.createTxCreateDoc(core.class.Attribute, core.space.Model, {
      name: 'status',
      label: 'Status' as IntlString,
      attributeOf: ISSUE_CLASS,
      type: { _class: core.class.RefTo, to: STATUS_CLASS }
    })
  )
  return hierarchy
}

describe('list status ordering', () => {
  let hierarchy: Hierarchy

  beforeEach(() => {
    hierarchy = createHierarchy()
  })

  it.each([SortingOrder.Ascending, SortingOrder.Descending])('sorts status names in direction %s', (direction) => {
    const options: FindOptions<Issue> = {
      lookup: { space: core.class.Space },
      total: true,
      limit: 20,
      sort: { status: direction }
    }
    const result = getListSortOptions(hierarchy, ISSUE_CLASS, options)

    expect(result).toEqual({
      ...options,
      sort: { '$lookup.status.name': direction },
      lookup: { space: core.class.Space, status: STATUS_CLASS }
    })
    expect(options.sort).toEqual({ status: direction })
    expect(options.lookup).toEqual({ space: core.class.Space })
  })

  it('preserves an existing nested status lookup', () => {
    const options: FindOptions<Issue> = {
      lookup: { status: [STATUS_CLASS, { category: core.class.StatusCategory }] },
      sort: { status: SortingOrder.Ascending }
    }
    const result = getListSortOptions(hierarchy, ISSUE_CLASS, options)
    expect(result.lookup).toEqual(options.lookup)
    expect(result.sort).toEqual({ '$lookup.status.name': SortingOrder.Ascending })
  })

  it('preserves other ordering keys and query options', () => {
    const options: FindOptions<Issue> = {
      lookup: { space: core.class.Space },
      showArchived: true,
      sort: { modifiedOn: SortingOrder.Descending }
    }
    expect(getListSortOptions(hierarchy, ISSUE_CLASS, options)).toBe(options)
    expect(getListSortOptions(hierarchy, ISSUE_CLASS, {})).toEqual({})
  })

  it('preserves sort-key precedence when translating status', () => {
    const options: FindOptions<Issue> = {
      sort: { createdOn: SortingOrder.Descending, status: SortingOrder.Ascending, modifiedOn: SortingOrder.Ascending }
    }
    const result = getListSortOptions(hierarchy, ISSUE_CLASS, options)
    expect(Object.entries(result.sort ?? {})).toEqual([
      ['createdOn', SortingOrder.Descending],
      ['$lookup.status.name', SortingOrder.Ascending],
      ['modifiedOn', SortingOrder.Ascending]
    ])
    expect(options.sort?.status).toBe(SortingOrder.Ascending)
  })

  it('preserves custom sorting rules from the list', () => {
    const options: FindOptions<Issue> = {
      sort: {
        status: { order: SortingOrder.Ascending, cases: [{ query: 'done' as Ref<Status>, index: 1 }], default: 0 }
      }
    }
    expect(getListSortOptions(hierarchy, ISSUE_CLASS, options)).toBe(options)
  })

  it('preserves priority sorting rules resolved by the list', () => {
    const options: FindOptions<Issue> = {
      sort: {
        priority: {
          order: SortingOrder.Ascending,
          cases: [1, 2, 3, 4, 0].map((query, index) => ({ query, index: index + 1 }))
        }
      }
    }
    expect(getListSortOptions(hierarchy, ISSUE_CLASS, options)).toBe(options)
  })

  it('leaves non-reference status fields unchanged', () => {
    jest.spyOn(hierarchy, 'findAttribute').mockReturnValue({
      ...hierarchy.getAttribute(ISSUE_CLASS, 'status'),
      type: { _class: core.class.TypeString, label: 'String' as IntlString }
    })
    const options: FindOptions<Issue> = { sort: { status: SortingOrder.Descending } }
    expect(getListSortOptions(hierarchy, ISSUE_CLASS, options)).toBe(options)
  })

  it('does not add a lookup when the status attribute is missing', () => {
    jest.spyOn(hierarchy, 'findAttribute').mockReturnValue(undefined)
    const options: FindOptions<Issue> = { sort: { status: SortingOrder.Ascending } }
    expect(getListSortOptions(hierarchy, ISSUE_CLASS, options)).toBe(options)
  })

  it('does not translate references to classes outside the Status hierarchy', () => {
    jest.spyOn(hierarchy, 'isDerived').mockReturnValue(false)
    const options: FindOptions<Issue> = { sort: { status: SortingOrder.Ascending } }
    expect(getListSortOptions(hierarchy, ISSUE_CLASS, options)).toBe(options)
  })

  it.each([SortingOrder.Ascending, SortingOrder.Descending])(
    'orders ungrouped rows before limiting across multiple pages in direction %s',
    async (direction) => {
      const db = new ModelDb(hierarchy)
      const statuses = [
        { _id: 'z-status' as Ref<Status>, name: 'Alpha' },
        { _id: 'm-status' as Ref<Status>, name: 'Beta' },
        { _id: 'a-status' as Ref<Status>, name: 'Zulu' }
      ]
      for (const status of statuses) {
        await db.tx(
          txFactory.createTxCreateDoc(
            STATUS_CLASS,
            core.space.Model,
            { name: status.name, ofAttribute: hierarchy.getAttribute(ISSUE_CLASS, 'status')._id },
            status._id
          )
        )
      }
      const issues = Array.from({ length: 75 }, (_, i) => ({
        _id: `issue-${i}` as Ref<Issue>,
        status: statuses[i % statuses.length]._id
      }))
      for (const issue of issues) {
        await db.tx(txFactory.createTxCreateDoc(ISSUE_CLASS, core.space.Model, { status: issue.status }, issue._id))
      }

      const expected = direction === SortingOrder.Ascending ? statuses : [...statuses].reverse()
      for (const limit of [20, 50, 75]) {
        const options = getListSortOptions(hierarchy, ISSUE_CLASS, { limit, sort: { status: direction } })
        const rows = await db.findAll<Issue>(ISSUE_CLASS, {}, options)
        const expectedStatuses = expected.flatMap((status) => Array<Ref<Status>>(25).fill(status._id)).slice(0, limit)
        expect(rows.map((row) => row.status)).toEqual(expectedStatuses)
      }
    }
  )
})
