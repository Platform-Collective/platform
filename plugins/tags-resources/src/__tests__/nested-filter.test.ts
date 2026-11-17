// Copyright © 2026 Hardcore Engineering Inc.
// Licensed under the Eclipse Public License, Version 2.0

import { Analytics } from '@hcengineering/analytics'
import core, {
  findProperty,
  type AnyAttribute,
  type Class,
  type Collection,
  type Client,
  type Doc,
  type DocumentQuery,
  type FindResult,
  type Ref,
  type RefTo,
  type Space
} from '@hcengineering/core'
import { getResource, type IntlString } from '@hcengineering/platform'
import { createQuery, getClient, type LiveQuery } from '@hcengineering/presentation'
import { type TagElement, type TagReference } from '@hcengineering/tags'
import { type AnyComponent } from '@hcengineering/ui'
import view, { type Filter, type FilterFunction, type FilterMode } from '@hcengineering/view'
import {
  FilterQuery,
  nestedDontMatchResult,
  nestedMatchResult,
  removeFilter,
  setFilters
} from '@hcengineering/view-resources'
import { FilterQueryLifetime } from '@hcengineering/view-resources/src/filter/lifecycle'
import { createFilterQueryComposer } from '@hcengineering/view-resources/src/filter/composer'
import {
  makeFilterQuery,
  makeFilterQueryWithLifetime
} from '@hcengineering/view-resources/src/filter/query-builder'

import tags from '../plugin'
import { tagsInResult, tagsNinResult } from '../utils'

jest.mock('@hcengineering/platform', () => ({
  ...jest.requireActual('@hcengineering/platform'),
  getResource: jest.fn()
}))
jest.mock('@hcengineering/presentation', () => ({ createQuery: jest.fn(), getClient: jest.fn() }))
jest.mock('@hcengineering/ui', () => ({}))
jest.mock('@hcengineering/analytics', () => ({ Analytics: { handleError: jest.fn() } }))

const vacancyClass = 'test:class:Vacancy' as Ref<Class<Space>>
const applicantClass = 'test:class:Applicant' as Ref<Class<Doc>>
const selectedTag = 'test:tag:A' as Ref<TagElement>
const caption = 'test:string:Labels' as IntlString
const nestedResource = 'view:function:FilterNestedMatchResult' as FilterFunction
const tagFilterComponent = 'tags:component:TagsFilter' as AnyComponent

function document<T extends Doc> (
  _class: Ref<Class<T>>,
  id: string
): Omit<Doc, '_id' | '_class'> & { _id: Ref<T>, _class: Ref<Class<T>> } {
  // Synthetic documents only need base Doc fields for these queries.
  return {
    _id: id as Ref<T>,
    _class,
    space: core.space.Workspace,
    modifiedBy: core.account.System,
    modifiedOn: 0
  }
}

function reference (id: string, vacancy: Doc): TagReference {
  return {
    ...document(tags.class.TagReference, id),
    attachedTo: vacancy._id,
    attachedToClass: vacancyClass,
    collection: 'labels',
    tag: selectedTag,
    title: 'Selected label',
    color: 0
  }
}

function nestedFilter (): Filter {
  const collection: Collection<TagReference> = {
    _class: core.class.Collection,
    of: tags.class.TagReference,
    label: caption
  }
  const vacancyRef: RefTo<Doc> = { _class: core.class.RefTo, to: vacancyClass, label: caption }
  const attribute: AnyAttribute = {
    ...document(core.class.Attribute, 'test:attribute:Labels'),
    attributeOf: vacancyClass,
    name: 'labels',
    label: caption,
    type: collection
  }
  const nested: Filter = {
    index: 1,
    key: { _class: vacancyClass, key: '_id', attribute, label: caption, component: tagFilterComponent },
    mode: tags.filter.FilterTagsIn,
    modes: [tags.filter.FilterTagsIn, tags.filter.FilterTagsNin],
    value: [selectedTag]
  }
  return {
    index: 1,
    key: {
      ...nested.key,
      _class: applicantClass,
      key: 'space',
      attribute: {
        ...document(core.class.Attribute, 'test:attribute:Vacancy'),
        attributeOf: applicantClass,
        name: 'space',
        label: caption,
        type: vacancyRef
      }
    },
    mode: view.filter.FilterNestedMatch,
    modes: [view.filter.FilterNestedMatch, view.filter.FilterNestedDontMatch],
    nested,
    value: nested.value,
    onRemove: (): void => {
      FilterQuery.remove(1)
    }
  }
}

function deferred<T> (): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolveValue: (value: T) => void = () => {}
  const promise = new Promise<T>((resolve) => {
    resolveValue = resolve
  })
  return { promise, resolve: resolveValue }
}

interface Subscription {
  clazz: Ref<Class<Doc>>
  query: DocumentQuery<Doc>
  callback: (docs: FindResult<Doc>) => void | Promise<void>
}

function transport (
  deliver?: (clazz: Ref<Class<Doc>>, callback: () => void) => void,
  deliverAfterRemoval = false
): {
  docs: Doc[]
  subscriptions: Set<Subscription>
  select: (clazz: Ref<Class<Doc>>, query: DocumentQuery<Doc>) => FindResult<Doc>
  publish: (clazz: Ref<Class<Doc>>) => Promise<void>
  create: () => LiveQuery
} {
  const docs: Doc[] = []
  const subscriptions = new Set<Subscription>()
  function select (clazz: Ref<Class<Doc>>, query: DocumentQuery<Doc>): FindResult<Doc> {
    let matches = docs.filter((doc) => doc._class === clazz)
    for (const key in query) {
      matches = findProperty(matches, key, query[key])
    }
    return Object.assign(matches, { total: matches.length })
  }
  return {
    docs,
    subscriptions,
    select,
    async publish (clazz): Promise<void> {
      for (const subscription of Array.from(subscriptions)) {
        if (subscription.clazz === clazz) {
          await subscription.callback(select(clazz, subscription.query))
        }
      }
    },
    create (): LiveQuery {
      let current: Subscription | undefined
      // The transport and mode/resource lookup are synthetic. The transport
      // models LiveQuery's replacement and unchanged-query contract; resolvers
      // and query composition are production code. Class IDs and documents are
      // minimal fixtures with the real Applicant.space/attachedTo relationship.
      // No model hierarchy, real LiveQuery, Svelte rendering or server runs here.
      const query: Pick<LiveQuery, 'query' | 'unsubscribe'> = {
        unsubscribe (): void {
          if (current !== undefined) subscriptions.delete(current)
          current = undefined
        },
        query<T extends Doc> (
          clazz: Ref<Class<T>>,
          value: DocumentQuery<T>,
          callback: (docs: FindResult<T>) => void | Promise<void>
        ): boolean {
          if (current?.clazz === clazz && JSON.stringify(current.query) === JSON.stringify(value)) return false
          query.unsubscribe()
          current = { clazz, query: value, callback: callback as Subscription['callback'] }
          subscriptions.add(current)
          // Resolver callback bodies are synchronous; delivery can be deferred
          // to exercise removal while an initial snapshot is still pending.
          const subscription = current
          const snapshot = (): void => {
            if (!deliverAfterRemoval && !subscriptions.has(subscription)) return
            const result = callback(select(clazz, value) as FindResult<T>)
            if (result !== undefined) throw new Error('Unexpected asynchronous subscription callback')
          }
          if (deliver === undefined) snapshot()
          else deliver(clazz, snapshot)
          return true
        }
      }
      return query as LiveQuery
    }
  }
}

describe('nested vacancy label subscriptions', () => {
  const handleError = jest.spyOn(Analytics, 'handleError')
  const consoleError = jest.spyOn(console, 'error')
  const vacancyA = document(vacancyClass, 'test:vacancy:A')
  const vacancyB = document(vacancyClass, 'test:vacancy:B')
  const applicantA = {
    ...document(applicantClass, 'test:applicant:A'),
    space: vacancyA._id,
    attachedTo: 'test:candidate:A' as Ref<Doc>
  }
  const applicantB = {
    ...document(applicantClass, 'test:applicant:B'),
    space: vacancyB._id,
    attachedTo: 'test:candidate:B' as Ref<Doc>
  }
  let source: ReturnType<typeof transport>
  let mode: FilterMode

  beforeEach(() => {
    source = transport()
    source.docs.push(vacancyA, vacancyB, applicantA, applicantB, reference('test:reference:A', vacancyA))
    mode = {
      ...document(view.class.FilterMode, tags.filter.FilterTagsIn),
      label: caption,
      result: tags.function.FilterTagsInResult
    }
    const client: Pick<Client, 'findOne'> = { findOne: jest.fn().mockResolvedValue(mode) }
    jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
    jest.mocked(createQuery).mockImplementation(() => source.create())
    jest.mocked(getResource).mockResolvedValue(tagsInResult)
  })

  afterEach(() => {
    setFilters([])
    for (const index of Array.from(FilterQuery.queries.keys())) FilterQuery.remove(index)
    jest.clearAllMocks()
  })

  it.each([
    [
      view.filter.FilterNestedMatch,
      nestedMatchResult,
      [applicantA._id],
      [applicantA._id, applicantB._id],
      [applicantB._id]
    ],
    [view.filter.FilterNestedDontMatch, nestedDontMatchResult, [applicantB._id], [], [applicantA._id]]
  ])('updates matching applicants after label gains and losses in mode %s', async (id, result, initial, both, last) => {
    const filter = nestedFilter()
    filter.mode = id
    setFilters([filter])
    const refresh = jest.fn()
    jest
      .mocked(getResource)
      .mockImplementation(async (resource) => (resource === nestedResource ? result : tagsInResult))
    async function matches (): Promise<Array<Ref<Doc>>> {
      const nestedMode: FilterMode = { ...mode, _id: id, result: nestedResource }
      const query = await makeFilterQuery({}, [filter], async () => nestedMode, undefined, undefined, refresh)
      expect(query).toEqual({
        space: id === view.filter.FilterNestedMatch ? { $in: expect.any(Array) } : { $nin: expect.any(Array) }
      })
      if (query === undefined) throw new Error('Unexpected cancelled composition')
      return source.select(applicantClass, query).map((doc) => doc._id)
    }

    expect(await matches()).toEqual(initial)
    expect(Array.from(source.subscriptions, (subscription) => subscription.clazz).sort()).toEqual(
      [tags.class.TagReference, vacancyClass].sort()
    )

    refresh.mockClear()
    source.docs.push(reference('test:reference:B', vacancyB), reference('test:reference:B:duplicate', vacancyB))
    await source.publish(tags.class.TagReference)
    expect(refresh).toHaveBeenCalled()
    expect(await matches()).toEqual(both)
    expect(source.subscriptions.size).toBe(2)

    refresh.mockClear()
    source.docs.splice(
      source.docs.findIndex((doc) => doc._id === 'test:reference:A'),
      1
    )
    await source.publish(tags.class.TagReference)
    expect(refresh).toHaveBeenCalled()
    expect(await matches()).toEqual(last)
    expect(source.subscriptions.size).toBe(2)

    removeFilter(0)
    expect(source.subscriptions.size).toBe(0)
    expect(FilterQuery.queries.size).toBe(0)
    expect(FilterQuery.results.size).toBe(0)
    refresh.mockClear()
    await source.publish(tags.class.TagReference)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('keeps direct tag results independent and clears both stages when all filters are reset', async () => {
    const filter = nestedFilter()
    if (filter.nested === undefined) throw new Error('Missing nested filter fixture')
    const direct: Filter = {
      ...filter.nested,
      index: 2,
      onRemove: () => {
        FilterQuery.remove(2)
      }
    }
    setFilters([filter, direct])
    const refresh = jest.fn()
    expect(await nestedMatchResult(filter, refresh)).toEqual({ $in: [vacancyA._id] })
    expect(await tagsInResult(direct, refresh)).toEqual({ $in: [vacancyA._id] })
    expect(await tagsNinResult(direct, refresh)).toEqual({ $nin: [vacancyA._id] })
    expect(source.subscriptions.size).toBe(3)
    removeFilter(1)
    expect(source.subscriptions.size).toBe(2)
    expect(await nestedMatchResult(filter, refresh)).toEqual({ $in: [vacancyA._id] })
    setFilters([])
    expect(source.subscriptions.size).toBe(0)
    expect(FilterQuery.results.size).toBe(0)
  })

  it.each([
    { nested: false, exclude: false },
    { nested: false, exclude: true },
    { nested: true, exclude: false },
    { nested: true, exclude: true }
  ])('refreshes retained labels after sibling removal (%j)', async ({ nested, exclude }) => {
    const outer = nestedFilter()
    if (outer.nested === undefined) throw new Error('Missing nested filter fixture')
    const filter = nested ? outer : outer.nested
    if (exclude) filter.mode = nested ? view.filter.FilterNestedDontMatch : tags.filter.FilterTagsNin
    const targetClass = nested ? applicantClass : vacancyClass
    const labelMode: FilterMode = {
      ...mode,
      _id: filter.mode,
      result: nested ? nestedResource : exclude ? tags.function.FilterTagsNinResult : tags.function.FilterTagsInResult
    }
    const siblingMode: FilterMode = {
      ...mode,
      _id: 'test:filter:Sibling' as Ref<FilterMode>,
      result: 'test:function:Sibling' as FilterFunction
    }
    const sibling: Filter = {
      ...filter,
      index: 2,
      key: { ...filter.key, key: 'modifiedOn' },
      mode: siblingMode._id,
      nested: undefined,
      onRemove: undefined
    }
    let filters = [filter, sibling]
    let base: DocumentQuery<Doc> = {}
    setFilters(filters)
    jest.mocked(getResource).mockImplementation(async (resource) => {
      if (resource === siblingMode.result) return async (): Promise<{ $gte: number }> => ({ $gte: 0 })
      if (resource === nestedResource) return exclude ? nestedDontMatchResult : nestedMatchResult
      return resource === tags.function.FilterTagsNinResult ? tagsNinResult : tagsInResult
    })
    let dispatched = deferred<DocumentQuery<Doc>>()
    const onChange = jest.fn((query: DocumentQuery<Doc>) => {
      dispatched.resolve(query)
    })
    const refresh = jest.fn()
    const compose = createFilterQueryComposer({
      resolveMode: async (id) => (id === siblingMode._id ? siblingMode : labelMode),
      refresh: refreshCurrent,
      onChange
    })
    function refreshCurrent (): void {
      refresh()
      void compose(base, filters).catch((error) => {
        Analytics.handleError(error)
      })
    }
    await compose(base, filters)
    const initial = await dispatched.promise
    const firstId = nested ? applicantA._id : vacancyA._id
    const secondId = nested ? applicantB._id : vacancyB._id
    expect(source.select(targetClass, initial).map((doc) => doc._id)).toEqual([exclude ? secondId : firstId])
    const membership = Array.from(source.subscriptions).find((entry) => entry.clazz === tags.class.TagReference)
    if (membership === undefined) throw new Error('Missing membership subscription')
    const created = jest.mocked(createQuery).mock.calls.length

    // Recompose with current inputs while the surviving predicate is unchanged.
    // The synthetic transport must retain the original membership callback.
    removeFilter(1)
    filters = [filter]
    base = { _class: targetClass }
    dispatched = deferred<DocumentQuery<Doc>>()
    await compose(base, filters)
    expect(await dispatched.promise).toEqual({
      _class: targetClass,
      [nested ? 'space' : '_id']: { [exclude ? '$nin' : '$in']: [vacancyA._id] }
    })
    expect(source.subscriptions.has(membership)).toBe(true)
    expect(jest.mocked(createQuery).mock.calls).toHaveLength(created)

    dispatched = deferred<DocumentQuery<Doc>>()
    refresh.mockClear()
    source.docs.push(reference('test:reference:B', vacancyB))
    await source.publish(tags.class.TagReference)
    const gained = await dispatched.promise
    expect(refresh).toHaveBeenCalled()
    expect(gained._class).toBe(targetClass)
    expect(source.select(targetClass, gained).map((doc) => doc._id)).toEqual(exclude ? [] : [firstId, secondId])

    dispatched = deferred<DocumentQuery<Doc>>()
    refresh.mockClear()
    source.docs.splice(
      source.docs.findIndex((doc) => doc._id === 'test:reference:A'),
      1
    )
    await source.publish(tags.class.TagReference)
    const lost = await dispatched.promise
    expect(refresh).toHaveBeenCalled()
    expect(lost._class).toBe(targetClass)
    expect(source.select(targetClass, lost).map((doc) => doc._id)).toEqual([exclude ? firstId : secondId])
    expect(source.subscriptions.has(membership)).toBe(true)
    expect(jest.mocked(createQuery).mock.calls).toHaveLength(created)

    removeFilter(0)
    refresh.mockClear()
    await source.publish(tags.class.TagReference)
    expect(refresh).not.toHaveBeenCalled()
    expect(source.subscriptions.size).toBe(0)
    expect(handleError).not.toHaveBeenCalled()
  })

  it.each(['mode', 'resource', 'result'] as const)(
    'reports a rejected %s to Analytics and runs the queued composition',
    async (stage) => {
      const started = deferred<undefined>()
      const release = deferred<undefined>()
      const dispatched = deferred<DocumentQuery<Doc>>()
      const failure = new Error(`Failed ${stage}`)
      const fail = async (): Promise<never> => {
        started.resolve(undefined)
        await release.promise
        throw failure
      }
      const filter = nestedFilter()
      setFilters([filter])
      jest.mocked(getResource).mockImplementation(async () => {
        if (stage === 'resource') return await fail()
        return fail
      })
      const onChange = jest.fn((query: DocumentQuery<Doc>) => {
        dispatched.resolve(query)
      })
      const compose = createFilterQueryComposer({
        resolveMode: async () => (stage === 'mode' ? await fail() : mode),
        refresh: jest.fn(),
        onChange
      })
      await compose({}, [filter])
      await started.promise
      const next: DocumentQuery<Doc> = { _class: vacancyClass }
      await compose(next, [])
      release.resolve(undefined)
      expect(await dispatched.promise).toEqual(next)
      expect(handleError).toHaveBeenCalledTimes(1)
      expect(handleError).toHaveBeenCalledWith(failure)
      expect(onChange.mock.calls).toEqual([[next]])
      expect(consoleError).not.toHaveBeenCalled()
    }
  )

  it('reports a dispatch failure to Analytics and runs the queued composition', async () => {
    const dispatched = deferred<DocumentQuery<Doc>>()
    const failure = new Error('Failed dispatch')
    const next: DocumentQuery<Doc> = { _class: vacancyClass }
    const compose = createFilterQueryComposer({
      resolveMode: async () => mode,
      refresh: jest.fn(),
      onChange: (query) => {
        if (query._class === undefined) {
          void compose(next, []).catch((error) => {
            Analytics.handleError(error)
          })
          throw failure
        }
        dispatched.resolve(query)
      }
    })
    await compose({}, [])
    expect(await dispatched.promise).toEqual(next)
    expect(handleError).toHaveBeenCalledTimes(1)
    expect(handleError).toHaveBeenCalledWith(failure)
    expect(consoleError).not.toHaveBeenCalled()
  })

  it.each([tags.class.TagReference, vacancyClass])(
    'ignores a late initial snapshot from %s after removal',
    async (clazz) => {
      let subscribed: () => void = () => {}
      const subscriptionReady = new Promise<void>((resolve) => {
        subscribed = resolve
      })
      const snapshots: Array<() => void> = []
      const docs = source.docs
      source = transport((target, callback) => {
        if (target === clazz) {
          snapshots.push(callback)
          subscribed()
        } else {
          callback()
        }
      }, true)
      source.docs.push(...docs)
      const filter = nestedFilter()
      setFilters([filter])
      const refresh = jest.fn()
      const pending = nestedMatchResult(filter, refresh)
      await subscriptionReady
      removeFilter(0)
      refresh.mockClear()
      for (const snapshot of snapshots) snapshot()
      expect(await pending).toEqual({ $in: [] })
      expect(refresh).not.toHaveBeenCalled()
      expect(source.subscriptions.size).toBe(0)
      expect(FilterQuery.queries.size).toBe(0)
      expect(FilterQuery.results.size).toBe(0)
    }
  )

  it('does not recreate subscriptions when a removed filter finishes resolving its mode', async () => {
    let resolveMode: (value: FilterMode) => void = () => {}
    const pendingMode = new Promise<FilterMode>((resolve) => {
      resolveMode = resolve
    })
    const client: Pick<Client, 'findOne'> = { findOne: jest.fn().mockReturnValue(pendingMode) }
    jest.mocked(getClient).mockReturnValue(client as ReturnType<typeof getClient>)
    const filter = nestedFilter()
    setFilters([filter])
    const pending = nestedMatchResult(filter, jest.fn())
    removeFilter(0)
    resolveMode(mode)
    expect(await pending).toEqual({ $in: [] })
    expect(source.subscriptions.size).toBe(0)
    expect(FilterQuery.queries.size).toBe(0)
    expect(FilterQuery.results.size).toBe(0)
  })

  it('does not subscribe when a removed filter finishes resolving its result resource', async () => {
    let resolveResource: (value: typeof tagsInResult) => void = () => {}
    const pendingResource = new Promise<typeof tagsInResult>((resolve) => {
      resolveResource = resolve
    })
    let lookupStarted: () => void = () => {}
    const lookupReady = new Promise<void>((resolve) => {
      lookupStarted = resolve
    })
    jest.mocked(getResource).mockImplementation(() => {
      lookupStarted()
      return pendingResource
    })
    const filter = nestedFilter()
    setFilters([filter])
    const refresh = jest.fn()
    const pending = nestedMatchResult(filter, refresh)
    await lookupReady
    removeFilter(0)
    resolveResource(tagsInResult)
    expect(await pending).toEqual({ $in: [] })
    expect(refresh).not.toHaveBeenCalled()
    expect(source.subscriptions.size).toBe(0)
    expect(FilterQuery.queries.size).toBe(0)
    expect(FilterQuery.results.size).toBe(0)
  })

  it.each([tags.class.TagReference, vacancyClass])(
    'settles a cancelled first result from %s and advances the query queue without delivery',
    async (clazz) => {
      const subscribed = deferred<undefined>()
      const cleared = deferred<undefined>()
      const resolverSettled = deferred<unknown>()
      const snapshots: Array<() => void> = []
      const docs = source.docs
      source = transport((target, snapshot) => {
        if (target === clazz) {
          snapshots.push(snapshot)
          subscribed.resolve(undefined)
        } else {
          snapshot()
        }
      })
      source.docs.push(...docs)
      const filter = nestedFilter()
      setFilters([filter])
      const outerMode: FilterMode = { ...mode, result: nestedResource }
      const observeNested = async (entry: Filter, onUpdate: () => void): Promise<unknown> => {
        const result = await nestedMatchResult(entry, onUpdate)
        resolverSettled.resolve(result)
        return result
      }
      jest
        .mocked(getResource)
        .mockImplementation(async (resource) => (resource === nestedResource ? observeNested : tagsInResult))
      const dispatch = jest.fn()
      const refresh = jest.fn()
      const run = createFilterQueryComposer({
        resolveMode: async () => outerMode,
        refresh,
        onChange: (query) => {
          dispatch(query)
          if (Object.keys(query).length === 0) cleared.resolve(undefined)
        }
      })
      await run({}, [filter])
      await subscribed.promise
      removeFilter(0)
      refresh.mockClear()
      await run({}, [])
      await cleared.promise
      // The resolver itself must settle, not just the outer composition race.
      expect(await resolverSettled.promise).toEqual({ $in: [] })
      expect(dispatch.mock.calls).toEqual([[{}]])
      expect(source.subscriptions.size).toBe(0)
      expect(FilterQuery.queries.size).toBe(0)
      expect(FilterQuery.results.size).toBe(0)
      // Ordinary unsubscribe suppresses these snapshots; cancellation already
      // settled composition and allowed the queued clear to finish above.
      for (const snapshot of snapshots) snapshot()
      expect(refresh).not.toHaveBeenCalled()
    }
  )

  it.each(['mode', 'resource'] as const)(
    'cancels composition during outer %s lookup without reviving a reused index',
    async (stage) => {
      const lookup = deferred<undefined>()
      const pendingMode = deferred<FilterMode>()
      const pendingResource = deferred<typeof nestedMatchResult>()
      const outerMode: FilterMode = { ...mode, result: nestedResource }
      const filter = nestedFilter()
      delete filter.onRemove
      setFilters([filter])
      const lifetime = new FilterQueryLifetime([filter.index])
      const resolveMode = jest.fn(async (): Promise<FilterMode> => {
        if (stage === 'mode') {
          lookup.resolve(undefined)
          return await pendingMode.promise
        }
        return outerMode
      })
      jest.mocked(getResource).mockImplementation(async (resource) => {
        if (resource !== nestedResource) return tagsInResult
        lookup.resolve(undefined)
        return await pendingResource.promise
      })
      const refresh = jest.fn()
      const dispatch = jest.fn()
      const pending = makeFilterQueryWithLifetime({}, [filter], resolveMode, undefined, undefined, refresh, lifetime)
      await lookup.promise
      if (stage === 'mode') removeFilter(0)
      else setFilters([])
      // Await cancellation before fulfilling either lookup, then reuse index 1.
      expect(await pending).toBeUndefined()
      expect(FilterQuery.queries.size).toBe(0)
      const replacement = nestedFilter()
      setFilters([replacement])
      jest
        .mocked(getResource)
        .mockImplementation(async (resource) => (resource === nestedResource ? nestedMatchResult : tagsInResult))
      const next = await makeFilterQuery({}, [replacement], async () => outerMode)
      expect(next).toEqual({ space: { $in: [vacancyA._id] } })
      expect(source.subscriptions.size).toBe(2)
      const created = jest.mocked(createQuery).mock.calls.length
      pendingMode.resolve(outerMode)
      pendingResource.resolve(nestedMatchResult)
      // A removed composition's captured generation also guards final dispatch.
      const stale = await pending
      if (stale !== undefined && lifetime.isActive()) dispatch(stale)
      expect(dispatch).not.toHaveBeenCalled()
      expect(refresh).not.toHaveBeenCalled()
      expect(jest.mocked(createQuery).mock.calls).toHaveLength(created)
      expect(source.subscriptions.size).toBe(2)
      expect(FilterQuery.queries.size).toBe(1)
    }
  )
})
