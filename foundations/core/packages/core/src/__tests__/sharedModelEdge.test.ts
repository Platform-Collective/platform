//
// Copyright © 2026 Intabia Fusion.
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

import { MeasureMetricsContext } from '@hcengineering/measurements'
import type { AnyAttribute, Class, Data, Doc, Mixin, Obj, Ref } from '../classes'
import { ClassifierKind } from '../classes'
import core from '../component'
import { Hierarchy } from '../hierarchy'
import { ModelDb } from '../memdb'
import { TxFactory } from '../tx'
import { createDoc, deleteDoc, genMinModel, test } from './minmodel'

const ctx = new MeasureMetricsContext('test', {})
const factory = new TxFactory(core.account.System)

function classTx (_id: string, ext: Ref<Class<Obj>>): ReturnType<TxFactory['createTxCreateDoc']> {
  return factory.createTxCreateDoc(
    core.class.Class,
    core.space.Model,
    { kind: ClassifierKind.CLASS, extends: ext, label: 'x' } as unknown as Data<Class<Obj>>,
    _id as Ref<Class<Obj>>
  )
}

function attrTx (
  _id: string,
  name: string,
  attributeOf: Ref<Class<Obj>> = test.class.Task
): ReturnType<TxFactory['createTxCreateDoc']> {
  return factory.createTxCreateDoc(
    core.class.Attribute,
    core.space.Model,
    { attributeOf, name, type: { _class: core.class.TypeString }, label: 'l' },
    _id as Ref<AnyAttribute>
  )
}

function shared (freeze = true): { h: Hierarchy, db: ModelDb } {
  const h = new Hierarchy()
  const db = new ModelDb(h)
  db.addTxes(
    ctx,
    [
      ...genMinModel(),
      classTx(core.class.Attribute, core.class.Doc),
      classTx(core.class.Mixin, core.class.Class),
      attrTx('attr-sys', 'f')
    ],
    true
  )
  if (freeze) db.freeze()
  return { h, db }
}

function overlay (base: { h: Hierarchy, db: ModelDb }): { h: Hierarchy, db: ModelDb } {
  const h = new Hierarchy(base.h)
  return { h, db: new ModelDb(h, base.db) }
}

describe('shared model edge cases', () => {
  it('create+remove in one addTxes batch does not resurrect the doc in the class index', () => {
    for (const ws of [shared(), overlay(shared())]) {
      const create = createDoc(test.class.Task, { name: 'x', description: 'd', rate: 1 } as any)
      const remove = deleteDoc(test.class.Task, create.objectSpace, create.objectId)
      ws.db.addTxes(ctx, [create, remove], true)
      expect(ws.db.findObject(create.objectId)).toBeUndefined()
      expect(ws.db.findAllSync(test.class.Task, {}).map((it) => it._id)).not.toContain(create.objectId)
    }
  })

  it('replaying a create tx after addTxes hands ownership back to the hierarchy', () => {
    // services/activity, services/notifications order: model.addTxes([tx]) then hierarchy.tx(tx)
    const h = new Hierarchy()
    const db = new ModelDb(h)
    db.addTxes(ctx, genMinModel(), true)
    const create = classTx('x:class:A', core.class.Doc)
    db.addTxes(ctx, [create], true)
    h.tx(create)
    const update = factory.createTxUpdateDoc(core.class.Class, core.space.Model, 'x:class:A' as Ref<Class<Obj>>, {
      label: 'b' as any
    })
    db.addTxes(ctx, [update], true)
    h.tx(update)
    expect(db.getObject('x:class:A' as Ref<Class<Obj>>).label).toBe('b')
    expect(h.getClass('x:class:A' as Ref<Class<Obj>>).label).toBe('b')
  })

  it('update of a class removed in the workspace does not resurrect it', () => {
    const ws = overlay(shared())
    ws.db.addTxes(ctx, [factory.createTxRemoveDoc(core.class.Class, core.space.Model, test.class.Task)], true)
    ws.db.addTxes(
      ctx,
      [factory.createTxUpdateDoc(core.class.Class, core.space.Model, test.class.Task, { label: 'x' as any })],
      true
    )
    expect(ws.h.findClass(test.class.Task)).toBeUndefined()
    expect(ws.db.findObject(test.class.Task)).toBeUndefined()
  })

  it('removing a shared attribute keeps the own same-named override', () => {
    const base = shared()
    const ws = overlay(base)
    ws.db.addTxes(ctx, [attrTx('attr-own', 'f')], true)
    ws.db.addTxes(
      ctx,
      [factory.createTxRemoveDoc(core.class.Attribute, core.space.Model, 'attr-sys' as Ref<Doc>)],
      true
    )
    expect(ws.h.getAllAttributes(test.class.Task).get('f')?._id).toBe('attr-own')
    ws.db.addTxes(
      ctx,
      [factory.createTxRemoveDoc(core.class.Attribute, core.space.Model, 'attr-own' as Ref<Doc>)],
      true
    )
    expect(ws.h.getAllAttributes(test.class.Task).get('f')).toBeUndefined()
    expect(base.h.getAllAttributes(test.class.Task).get('f')?._id).toBe('attr-sys')
  })

  it('own class descendants and domain do not touch parent chains', () => {
    const base = shared()
    const ws = overlay(base)
    ws.db.addTxes(ctx, [classTx('ws:class:Own', test.class.Task)], true)
    const own = 'ws:class:Own' as Ref<Class<Doc>>
    expect(ws.h.findDomain(own)).toBe(ws.h.findDomain(test.class.Task))
    expect(ws.h.getDescendants(test.class.Task)).toContain(own)
    expect(ws.h.getDescendants(own)).toEqual([own])
    expect(base.h.getDescendants(test.class.Task)).not.toContain(own)
    // unaffected chains are shared with the parent, not copied
    expect(ws.h.getAncestors(test.class.Task)).toBe(base.h.getAncestors(test.class.Task))
  })

  it('re-pointing a shared class under an own class shows shared descendants under it', () => {
    const base = shared()
    const ws = overlay(base)
    const own = 'ws:class:Base' as Ref<Class<Doc>>
    ws.db.addTxes(ctx, [classTx(own, core.class.Doc)], true)
    expect(ws.h.getDescendants(own)).toEqual([own])
    ws.db.addTxes(
      ctx,
      [factory.createTxUpdateDoc(core.class.Class, core.space.Model, core.class.AttachedDoc, { extends: own })],
      true
    )
    const d = ws.h.getDescendants(own)
    expect(d).toContain(core.class.AttachedDoc)
    expect(d).toContain(test.class.TaskCheckItem)
    expect(ws.h.isDerived(test.class.TaskCheckItem, own)).toBe(true)
    expect(base.h.isDerived(test.class.TaskCheckItem, own)).toBe(false)
    expect(base.h.getClass(core.class.AttachedDoc).extends).toBe(core.class.Doc)
  })

  it('removing a shared class in the workspace drops its subtree from descendants', () => {
    const base = shared()
    const ws = overlay(base)
    ws.db.addTxes(ctx, [factory.createTxRemoveDoc(core.class.Class, core.space.Model, core.class.AttachedDoc)], true)
    expect(ws.h.getDescendants(core.class.Doc)).not.toContain(core.class.AttachedDoc)
    expect(ws.h.isDerived(test.class.TaskCheckItem, core.class.Doc)).toBe(false)
    expect(base.h.isDerived(test.class.TaskCheckItem, core.class.Doc)).toBe(true)
  })

  it('mixin proxy over a frozen doc tolerates a mixin key shadowing a root key', () => {
    const base = shared()
    const mixin = 'test:mixin:Shadow' as Ref<Mixin<Doc>>
    base.db.addTxes(
      ctx,
      [
        factory.createTxCreateDoc(
          core.class.Mixin,
          core.space.Model,
          { kind: ClassifierKind.MIXIN, extends: test.class.Task, label: 'm' } as unknown as Data<Mixin<Doc>>,
          mixin
        )
      ],
      true
    )
    const task = createDoc(test.class.Task, { name: 'root', description: 'd', rate: 1 } as any)
    base.db.addTxes(
      ctx,
      [task, factory.createTxMixin(task.objectId, test.class.Task, core.space.Model, mixin, { name: 'mixin' } as any)],
      true
    )
    base.db.freeze()
    const doc = base.db.getObject(task.objectId)
    expect(Object.isFrozen(doc)).toBe(true)
    expect((base.h.as(doc, mixin) as any).name).toBe('mixin')
    expect((base.db.findAllSync(mixin, {})[0] as any).name).toBe('mixin')
  })

  it('mixin proxy over a frozen doc keeps the original target when nothing is shadowed', () => {
    const base = shared()
    const mixin = 'test:mixin:NoShadow' as Ref<Mixin<Doc>>
    base.db.addTxes(
      ctx,
      [
        factory.createTxCreateDoc(
          core.class.Mixin,
          core.space.Model,
          { kind: ClassifierKind.MIXIN, extends: test.class.Task, label: 'm' } as unknown as Data<Mixin<Doc>>,
          mixin
        )
      ],
      true
    )
    const task = createDoc(test.class.Task, { name: 'root', description: 'd', rate: 1 } as any)
    base.db.addTxes(
      ctx,
      [task, factory.createTxMixin(task.objectId, test.class.Task, core.space.Model, mixin, { extra: 'v' } as any)],
      true
    )
    base.db.freeze()
    const doc = base.db.getObject(task.objectId)
    const as = base.h.as(doc, mixin)
    expect((as as any).extra).toBe('v')
    expect((as as any).name).toBe('root')
    // No collision, so no defensive copy: the proxy still points at the shared instance.
    expect(Hierarchy.toDoc(as)).toBe(doc)
  })

  it('mixin proxy over a frozen doc tolerates a shadowing key inherited from an ancestor mixin', () => {
    const base = shared()
    const parent = 'test:mixin:ShadowParent' as Ref<Mixin<Doc>>
    const child = 'test:mixin:ShadowChild' as Ref<Mixin<Doc>>
    const mixinTx = (_id: Ref<Mixin<Doc>>, ext: Ref<Class<Obj>>): ReturnType<TxFactory['createTxCreateDoc']> =>
      factory.createTxCreateDoc(
        core.class.Mixin,
        core.space.Model,
        { kind: ClassifierKind.MIXIN, extends: ext, label: 'm' } as unknown as Data<Mixin<Doc>>,
        _id
      )
    base.db.addTxes(ctx, [mixinTx(parent, test.class.Task), mixinTx(child, parent)], true)
    const task = createDoc(test.class.Task, { name: 'root', description: 'd', rate: 1 } as any)
    base.db.addTxes(
      ctx,
      [task, factory.createTxMixin(task.objectId, test.class.Task, core.space.Model, parent, { name: 'mixin' } as any)],
      true
    )
    base.db.freeze()
    const doc = base.db.getObject(task.objectId)
    // Resolved through the ancestor proxy, so the collision is invisible on `child` itself.
    expect((base.h.as(doc, child) as any).name).toBe('mixin')
  })

  it('a frozen shared model refuses model transactions', () => {
    const base = shared()
    expect(() => {
      base.db.addTxes(
        ctx,
        [factory.createTxUpdateDoc(core.class.Class, core.space.Model, test.class.Task, { label: 'x' as any })],
        true
      )
    }).toThrow()
    expect(base.h.getClass(test.class.Task).label).not.toBe('x')
  })

  it('owner-first order (model.tx, then hierarchy.tx) moves a renamed attribute to its new name', async () => {
    const rename = factory.createTxUpdateDoc(
      core.class.Attribute,
      core.space.Model,
      'attr-sys' as Ref<AnyAttribute>,
      {
        name: 'g'
      } as any
    )
    const base = shared()
    for (const { h, db } of [shared(false), overlay(base)]) {
      await db.tx(rename)
      h.tx(rename)
      expect(h.findAttribute(test.class.Task, 'f')).toBeUndefined()
      expect(h.findAttribute(test.class.Task, 'g')).toBe(db.findObject('attr-sys' as Ref<AnyAttribute>))
    }
    expect(base.h.findAttribute(test.class.Task, 'f')?._id).toBe('attr-sys')
  })

  it('tracks ownership only for classifiers and attributes', () => {
    const h = new Hierarchy()
    const db = new ModelDb(h)
    db.addTxes(ctx, genMinModel(), true)
    const owned = (h as any).externallyOwned as Set<string>
    expect(owned.size).toBe((h as any).classifiers.size + (h as any).attributesById.size)
    expect(db.findAllSync(core.class.Doc, {}).length).toBeGreaterThan(owned.size)
  })
})
