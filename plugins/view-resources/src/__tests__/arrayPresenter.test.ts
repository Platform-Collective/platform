// SPDX-License-Identifier: EPL-2.0

import core, {
  ClassifierKind,
  Hierarchy,
  TxFactory,
  type Class,
  type Data,
  type Doc,
  type Mixin,
  type Obj,
  type Ref
} from '@hcengineering/core'
import type { AnyComponent } from '@hcengineering/ui'
import type { AttributePresenter } from '@hcengineering/view'
import { getArrayPresenter } from '../arrayPresenter'

const presenterMixin = 'test:mixin:AttributePresenter' as Ref<Mixin<AttributePresenter>>
const typeWithArray = 'test:class:TypeWithArray' as Ref<Class<Doc>>
const derivedType = 'test:class:DerivedType' as Ref<Class<Doc>>
const typeWithoutArray = 'test:class:TypeWithoutArray' as Ref<Class<Doc>>
const typeWithoutMixin = 'test:class:TypeWithoutMixin' as Ref<Class<Doc>>

const presenter = 'test:component:Presenter' as AnyComponent
const arrayPresenter = 'test:component:ArrayPresenter' as AnyComponent

function buildHierarchy (): Hierarchy {
  const txFactory = new TxFactory(core.account.System)
  const hierarchy = new Hierarchy()
  const createClass = (_id: Ref<Class<Obj>>, data: { extends?: Ref<Class<Obj>>, kind?: ClassifierKind }): void => {
    hierarchy.tx(
      txFactory.createTxCreateDoc(
        core.class.Class,
        core.space.Model,
        { kind: ClassifierKind.CLASS, ...data } as unknown as Data<Class<Obj>>,
        _id
      )
    )
  }
  createClass(core.class.Obj, {})
  createClass(core.class.Doc, { extends: core.class.Obj })
  createClass(core.class.Class, { extends: core.class.Doc })
  createClass(presenterMixin, { extends: core.class.Class, kind: ClassifierKind.MIXIN })
  createClass(typeWithArray, { extends: core.class.Doc })
  createClass(derivedType, { extends: typeWithArray })
  createClass(typeWithoutArray, { extends: core.class.Doc })
  createClass(typeWithoutMixin, { extends: core.class.Doc })

  hierarchy.tx(
    txFactory.createTxMixin(typeWithArray, core.class.Class, core.space.Model, presenterMixin, {
      presenter,
      arrayPresenter
    })
  )
  hierarchy.tx(
    txFactory.createTxMixin(typeWithoutArray, core.class.Class, core.space.Model, presenterMixin, { presenter })
  )
  return hierarchy
}

describe('getArrayPresenter', () => {
  const hierarchy = buildHierarchy()

  it('returns the array presenter of a mixin resolved by the hierarchy', () => {
    expect(getArrayPresenter(hierarchy.classHierarchyMixin(typeWithArray, presenterMixin))).toBe(arrayPresenter)
  })

  it('returns the array presenter inherited from a parent class', () => {
    expect(getArrayPresenter(hierarchy.classHierarchyMixin(derivedType, presenterMixin))).toBe(arrayPresenter)
  })

  it('returns undefined when the mixin has no array presenter', () => {
    const mixin = hierarchy.classHierarchyMixin(typeWithoutArray, presenterMixin)
    expect(mixin?.presenter).toBe(presenter)
    expect(getArrayPresenter(mixin)).toBeUndefined()
  })

  it('returns undefined when the class has no presenter mixin', () => {
    const mixin = hierarchy.classHierarchyMixin(typeWithoutMixin, presenterMixin)
    expect(mixin).toBeUndefined()
    expect(getArrayPresenter(mixin)).toBeUndefined()
  })
})
