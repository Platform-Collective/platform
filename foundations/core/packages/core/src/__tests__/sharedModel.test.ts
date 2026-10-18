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

import type { Class, Classifier, Doc, Obj, Ref } from '../classes'
import { ClassifierKind, DOMAIN_MODEL } from '../classes'
import core from '../component'
import { Hierarchy } from '../hierarchy'
import { MeasureMetricsContext } from '@hcengineering/measurements'
import { ModelDb } from '../memdb'
import type { Tx } from '../tx'
import { TxFactory } from '../tx'

const ctx = new MeasureMetricsContext('test', {})
const factory = new TxFactory(core.account.System)

const SYS = 'test:class:SystemDoc' as Ref<Class<Doc>>
const WS = 'test:class:WorkspaceDoc' as Ref<Class<Doc>>

function classTx (_id: Ref<Class<Obj>>, ext: Ref<Class<Obj>> | undefined): Tx {
  return factory.createTxCreateDoc(
    core.class.Class,
    core.space.Model,
    { kind: ClassifierKind.CLASS, extends: ext, label: '' as any, domain: DOMAIN_MODEL },
    _id
  )
}

function docTx (_class: Ref<Class<Doc>>, _id: string, label: string): Tx {
  return factory.createTxCreateDoc(_class, core.space.Model, { label }, _id as Ref<Doc>)
}

function attrTx (_id: string, name: string, _class: Ref<Class<Doc>> = SYS): Tx {
  return factory.createTxCreateDoc(
    core.class.Attribute,
    core.space.Model,
    { attributeOf: _class, name, label: '' as any, type: { _class: core.class.TypeString } },
    _id as Ref<Doc>
  )
}

// A shared system model, built once, plus a per-workspace overlay on top of it.
function shared (): { h: Hierarchy, db: ModelDb } {
  const h = new Hierarchy()
  const db = new ModelDb(h)
  db.addTxes(
    ctx,
    [
      classTx(core.class.Obj, undefined),
      classTx(core.class.Doc, core.class.Obj),
      classTx(core.class.Class, core.class.Doc),
      classTx(core.class.Attribute, core.class.Doc),
      classTx(core.class.Mixin, core.class.Class),
      classTx(core.class.Interface, core.class.Doc),
      classTx(SYS, core.class.Doc),
      docTx(SYS, 'sys-1', 'system one'),
      docTx(SYS, 'sys-2', 'system two')
    ],
    true
  )
  return { h, db }
}

function overlay (base: { h: Hierarchy, db: ModelDb }): { h: Hierarchy, db: ModelDb } {
  const h = new Hierarchy(base.h)
  const db = new ModelDb(h, base.db)
  return { h, db }
}

describe('workspace model over a shared system model', () => {
  it('reads system classes and documents through the parent', () => {
    const base = shared()
    const ws = overlay(base)

    expect(ws.h.getClass(SYS)._id).toBe(SYS)
    expect(ws.h.isDerived(SYS, core.class.Doc)).toBe(true)
    expect(ws.db.findObject('sys-1' as Ref<Doc>)).toBeDefined()
    expect(ws.db.findAllSync(SYS, {})).toHaveLength(2)
  })

  it('adds its own classes without touching the shared one', () => {
    const base = shared()
    const ws = overlay(base)

    ws.db.addTxes(ctx, [classTx(WS, SYS), docTx(WS, 'ws-1', 'own')], true)

    expect(ws.h.isDerived(WS, core.class.Doc)).toBe(true)
    expect(ws.h.getDescendants(SYS)).toContain(WS)
    expect(ws.db.findAllSync(SYS, {})).toHaveLength(3)
    // the shared model stays as it was
    expect(base.h.getDescendants(SYS)).not.toContain(WS)
    expect(base.db.findAllSync(SYS, {})).toHaveLength(2)
    expect(() => base.h.getClass(WS)).toThrow()
  })

  it('copies a shared document on write instead of mutating it', () => {
    const base = shared()
    const first = overlay(base)
    const second = overlay(base)

    first.db.addTxes(
      ctx,
      [factory.createTxUpdateDoc(SYS, core.space.Model, 'sys-1' as Ref<Doc>, { label: 'changed' } as any)],
      true
    )

    expect((first.db.findObject('sys-1' as Ref<Doc>) as any).label).toBe('changed')
    // neither the shared model nor a sibling workspace sees it
    expect((base.db.findObject('sys-1' as Ref<Doc>) as any).label).toBe('system one')
    expect((second.db.findObject('sys-1' as Ref<Doc>) as any).label).toBe('system one')
  })

  it('hides a shared document deleted in the workspace', () => {
    const base = shared()
    const ws = overlay(base)

    ws.db.addTxes(ctx, [factory.createTxRemoveDoc(SYS, core.space.Model, 'sys-1' as Ref<Doc>)], true)

    expect(ws.db.findObject('sys-1' as Ref<Doc>)).toBeUndefined()
    expect(ws.db.findAllSync(SYS, {})).toHaveLength(1)
    expect(base.db.findObject('sys-1' as Ref<Doc>)).toBeDefined()
    expect(base.db.findAllSync(SYS, {})).toHaveLength(2)
  })

  it('hides a shared class removed in the workspace', () => {
    const base = shared()
    const ws = overlay(base)

    ws.db.addTxes(ctx, [factory.createTxRemoveDoc(core.class.Class, core.space.Model, SYS)], true)

    expect(() => ws.h.getClass(SYS)).toThrow()
    expect(ws.h.isDerived(SYS, core.class.Doc)).toBe(false)
    expect(ws.h.getDescendants(core.class.Doc)).not.toContain(SYS)
    // the shared model keeps it for every other workspace
    expect(base.h.getClass(SYS)._id).toBe(SYS)
    expect(overlay(base).h.isDerived(SYS, core.class.Doc)).toBe(true)
  })

  it('restores a shared class re-created in the workspace', () => {
    const base = shared()
    const ws = overlay(base)

    ws.db.addTxes(ctx, [factory.createTxRemoveDoc(core.class.Class, core.space.Model, SYS)], true)
    ws.db.addTxes(ctx, [classTx(SYS, core.class.Doc)], true)

    expect(ws.h.getClass(SYS)._id).toBe(SYS)
    expect(ws.h.isDerived(SYS, core.class.Doc)).toBe(true)
  })

  it('keeps a shared classifier intact when the workspace updates it', () => {
    const base = shared()
    const ws = overlay(base)

    ws.db.addTxes(
      ctx,
      [factory.createTxUpdateDoc(core.class.Class, core.space.Model, SYS, { label: 'renamed' } as any)],
      true
    )

    expect(ws.h.getClass(SYS).label).toBe('renamed')
    expect(base.h.getClass(SYS).label).not.toBe('renamed')
  })

  it('merges attributes of shared and own classes', () => {
    const base = shared()
    base.db.addTxes(
      ctx,
      [
        factory.createTxCreateDoc(
          core.class.Attribute,
          core.space.Model,
          { attributeOf: SYS, name: 'shared', label: '' as any, type: { _class: core.class.TypeString } },
          'attr-shared' as Ref<Doc>
        )
      ],
      true
    )
    const ws = overlay(base)
    ws.db.addTxes(
      ctx,
      [
        factory.createTxCreateDoc(
          core.class.Attribute,
          core.space.Model,
          { attributeOf: SYS, name: 'own', label: '' as any, type: { _class: core.class.TypeString } },
          'attr-own' as Ref<Doc>
        )
      ],
      true
    )

    const attrs = ws.h.getAllAttributes(SYS)
    expect(attrs.get('shared')).toBeDefined()
    expect(attrs.get('own')).toBeDefined()
    expect(base.h.getAllAttributes(SYS).get('own')).toBeUndefined()
  })

  it('leaves a standalone model working as before', () => {
    const base = shared()

    expect(base.h.isDerived(SYS, core.class.Doc)).toBe(true)
    expect(base.db.findAllSync(SYS, {})).toHaveLength(2)
  })
})

// Every workspace op the settings UI can run on a system document, replayed against a frozen
// shared model - invariant: the shared model never changes.
const MIXIN = 'test:mixin:Versionable' as Ref<Class<Doc>>
const IFACE = 'test:interface:Marker' as Ref<Classifier>

function scenarioBase (): { h: Hierarchy, db: ModelDb } {
  const base = shared()
  base.db.addTxes(
    ctx,
    [
      attrTx('attr-sys', 'sysAttr'),
      attrTx('attr-sys2', 'sysAttr2'),
      classTx(MIXIN, core.class.Doc),
      factory.createTxCreateDoc(
        core.class.Interface,
        core.space.Model,
        { kind: ClassifierKind.INTERFACE, label: '' as any },
        IFACE
      ),
      factory.createTxUpdateDoc(
        SYS,
        core.space.Model,
        'sys-1' as Ref<Doc>,
        {
          tags: ['a'],
          counter: 1,
          nested: { key: 'v' }
        } as any
      ),
      factory.createTxMixin(SYS, core.class.Class, core.space.Model, MIXIN, { rank: 1 } as any)
    ],
    true
  )
  base.db.freeze()
  return base
}

const byId = (a: Doc, b: Doc): number => a._id.localeCompare(b._id)

function snapshotOf (h: Hierarchy): string {
  const ids = h.getDescendants(core.class.Obj)
  return JSON.stringify(
    ids
      .slice()
      .sort()
      .map((_id) => h.getClass(_id))
  )
}

/** Everything a workspace can observe: documents plus every derived hierarchy structure. */
function fullSnapshot (m: { h: Hierarchy, db: ModelDb }): string {
  const classifiers = [
    ...m.db.findAllSync(core.class.Class, {}).map((it) => it._id as Ref<Classifier>),
    ...m.db.findAllSync(core.class.Interface, {}).map((it) => it._id as Ref<Classifier>)
  ]
  classifiers.sort()
  const sortedIds = (ids: Ref<Classifier>[]): Ref<Classifier>[] => ids.slice().sort()
  return JSON.stringify({
    docs: m.db.findAllSync(core.class.Doc, {}).slice().sort(byId),
    domains: m.h.domains().slice().sort(),
    classifiers: classifiers.map((_id) => ({
      _id,
      doc: m.h.getClassOrInterface(_id as Ref<Class<Obj>>),
      ancestors: sortedIds(m.h.getAncestors(_id)),
      descendants: sortedIds(m.h.getDescendants(_id as Ref<Class<Doc>>)),
      own: Array.from(m.h.getOwnAttributes(_id)).sort((a, b) => a[0].localeCompare(b[0])),
      all: Array.from(m.h.getAllAttributes(_id)).sort((a, b) => a[0].localeCompare(b[0])),
      domain: m.h.findDomain(_id as Ref<Class<Doc>>) ?? null,
      derivedFromDoc: m.h.isDerived(_id as Ref<Class<Doc>>, core.class.Doc)
    }))
  })
}

function allFrozen (db: ModelDb): boolean {
  return db.findAllSync(core.class.Doc, {}).every((it) => Object.isFrozen(it))
}

const scenarios: Array<
  [string, (ws: { h: Hierarchy, db: ModelDb }) => void, (ws: { h: Hierarchy, db: ModelDb }) => void]
> = [
  [
    'hides a system attribute',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [
          factory.createTxUpdateDoc(
            core.class.Attribute,
            core.space.Model,
            'attr-sys' as Ref<Doc>,
            {
              hidden: true
            } as any
          )
        ],
        true
      )
    },
    (ws) => {
      expect((ws.h.getAllAttributes(SYS).get('sysAttr') as any).hidden).toBe(true)
    }
  ],
  [
    'adds its own attribute to a system class',
    (ws) => {
      ws.db.addTxes(ctx, [attrTx('attr-ws', 'wsAttr')], true)
    },
    (ws) => {
      expect(ws.h.getAllAttributes(SYS).get('wsAttr')).toBeDefined()
      expect(ws.h.getAllAttributes(SYS).get('sysAttr')).toBeDefined()
      expect(ws.h.getOwnAttributes(SYS).get('wsAttr')).toBeDefined()
      expect(ws.h.findAttribute(SYS, 'wsAttr')?._id).toBe('attr-ws')
      expect(ws.db.findObject('attr-ws' as Ref<Doc>)).toBeDefined()
    }
  ],
  [
    'renames a system attribute',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [
          factory.createTxUpdateDoc(
            core.class.Attribute,
            core.space.Model,
            'attr-sys' as Ref<Doc>,
            {
              name: 'renamedAttr'
            } as any
          )
        ],
        true
      )
    },
    (ws) => {
      expect(ws.h.getAllAttributes(SYS).get('renamedAttr')?._id).toBe('attr-sys')
      expect(ws.h.findAttribute(SYS, 'renamedAttr')?._id).toBe('attr-sys')
      // the old name must not resolve to the renamed attribute any more
      expect(ws.h.getAllAttributes(SYS).get('sysAttr')?._id).not.toBe('attr-sys')
      expect(ws.h.findAttribute(SYS, 'sysAttr')?._id).not.toBe('attr-sys')
    }
  ],
  [
    'renames its own attribute',
    (ws) => {
      ws.db.addTxes(ctx, [attrTx('attr-ws', 'wsAttr')], true)
      ws.db.addTxes(
        ctx,
        [
          factory.createTxUpdateDoc(
            core.class.Attribute,
            core.space.Model,
            'attr-ws' as Ref<Doc>,
            {
              name: 'wsAttrRenamed'
            } as any
          )
        ],
        true
      )
    },
    (ws) => {
      expect(ws.h.getAllAttributes(SYS).get('wsAttrRenamed')?._id).toBe('attr-ws')
      expect(ws.h.getAllAttributes(SYS).get('wsAttr')).toBeUndefined()
    }
  ],
  [
    'removes a system attribute',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxRemoveDoc(core.class.Attribute, core.space.Model, 'attr-sys' as Ref<Doc>)],
        true
      )
    },
    (ws) => {
      expect(ws.h.getAllAttributes(SYS).has('sysAttr')).toBe(false)
      expect(ws.h.getOwnAttributes(SYS).has('sysAttr')).toBe(false)
      expect(ws.h.findAttribute(SYS, 'sysAttr')).toBeUndefined()
      expect(ws.db.findObject('attr-sys' as Ref<Doc>)).toBeUndefined()
      // the sibling attribute of the same class stays visible
      expect(ws.h.getAllAttributes(SYS).get('sysAttr2')?._id).toBe('attr-sys2')
    }
  ],
  [
    'removes and re-creates a system attribute',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxRemoveDoc(core.class.Attribute, core.space.Model, 'attr-sys' as Ref<Doc>)],
        true
      )
      ws.db.addTxes(ctx, [attrTx('attr-sys', 'sysAttr')], true)
    },
    (ws) => {
      expect(ws.h.getAllAttributes(SYS).get('sysAttr')?._id).toBe('attr-sys')
      expect(ws.db.findObject('attr-sys' as Ref<Doc>)).toBeDefined()
    }
  ],
  [
    'removes its own attribute',
    (ws) => {
      ws.db.addTxes(ctx, [attrTx('attr-ws', 'wsAttr')], true)
      ws.db.addTxes(
        ctx,
        [factory.createTxRemoveDoc(core.class.Attribute, core.space.Model, 'attr-ws' as Ref<Doc>)],
        true
      )
    },
    (ws) => {
      expect(ws.h.getAllAttributes(SYS).has('wsAttr')).toBe(false)
      expect(ws.db.findObject('attr-ws' as Ref<Doc>)).toBeUndefined()
      expect(ws.h.getAllAttributes(SYS).get('sysAttr')?._id).toBe('attr-sys')
    }
  ],
  [
    'overrides a system attribute by name',
    (ws) => {
      ws.db.addTxes(ctx, [attrTx('attr-override', 'sysAttr')], true)
    },
    (ws) => {
      expect(ws.h.getAllAttributes(SYS).get('sysAttr')?._id).toBe('attr-override')
    }
  ],
  [
    'drops the override and falls back to the system attribute',
    (ws) => {
      ws.db.addTxes(ctx, [attrTx('attr-override', 'sysAttr')], true)
      ws.db.addTxes(
        ctx,
        [factory.createTxRemoveDoc(core.class.Attribute, core.space.Model, 'attr-override' as Ref<Doc>)],
        true
      )
    },
    (ws) => {
      expect(ws.h.getAllAttributes(SYS).get('sysAttr')?._id).toBe('attr-sys')
    }
  ],
  [
    'adds an attribute to its own class',
    (ws) => {
      ws.db.addTxes(ctx, [classTx(WS, SYS), attrTx('attr-on-ws', 'ownClassAttr', WS)], true)
    },
    (ws) => {
      expect(ws.h.getOwnAttributes(WS).get('ownClassAttr')?._id).toBe('attr-on-ws')
      // inherited from the system class as well
      expect(ws.h.getAllAttributes(WS).get('sysAttr')?._id).toBe('attr-sys')
      expect(ws.h.getAllAttributes(SYS).has('ownClassAttr')).toBe(false)
    }
  ],
  [
    'changes the type of a system attribute',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [
          factory.createTxUpdateDoc(
            core.class.Attribute,
            core.space.Model,
            'attr-sys' as Ref<Doc>,
            {
              type: { _class: core.class.TypeNumber }
            } as any
          )
        ],
        true
      )
    },
    (ws) => {
      expect((ws.h.getAllAttributes(SYS).get('sysAttr') as any).type._class).toBe(core.class.TypeNumber)
    }
  ],
  [
    'sets a nested field of a system attribute',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [
          factory.createTxUpdateDoc(
            core.class.Attribute,
            core.space.Model,
            'attr-sys' as Ref<Doc>,
            {
              'type._class': core.class.TypeNumber
            } as any
          )
        ],
        true
      )
    },
    (ws) => {
      expect((ws.h.getAllAttributes(SYS).get('sysAttr') as any).type._class).toBe(core.class.TypeNumber)
    }
  ],
  [
    'creates a user mixin over a system class',
    (ws) => {
      const id = 'test:mixin:User' as Ref<Class<Obj>>
      ws.db.addTxes(
        ctx,
        [
          factory.createTxCreateDoc(
            core.class.Mixin,
            core.space.Model,
            { kind: ClassifierKind.MIXIN, extends: SYS, label: '' as any },
            id
          ),
          factory.createTxMixin(id, core.class.Mixin, core.space.Model, MIXIN, { value: true } as any)
        ],
        true
      )
    },
    (ws) => {
      expect(ws.h.isDerived('test:mixin:User' as Ref<Class<Doc>>, SYS)).toBe(true)
      expect(ws.h.getDescendants(SYS)).toContain('test:mixin:User')
      expect(ws.h.isMixin('test:mixin:User' as Ref<Class<Doc>>)).toBe(true)
      expect(ws.h.getBaseClass('test:mixin:User' as Ref<Class<Doc>>)).toBe(SYS)
    }
  ],
  [
    'updates a mixin the system class already carries',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxMixin(SYS, core.class.Class, core.space.Model, MIXIN, { rank: 2 } as any)],
        true
      )
    },
    (ws) => {
      expect((ws.h.getClass(SYS) as any)[MIXIN].rank).toBe(2)
    }
  ],
  [
    'puts a new mixin on a system class',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [
          factory.createTxCreateDoc(
            core.class.Mixin,
            core.space.Model,
            { kind: ClassifierKind.MIXIN, extends: core.class.Class, label: '' as any },
            'test:mixin:Fresh' as Ref<Class<Obj>>
          ),
          factory.createTxMixin(
            SYS,
            core.class.Class,
            core.space.Model,
            'test:mixin:Fresh' as any,
            {
              note: 'x'
            } as any
          )
        ],
        true
      )
    },
    (ws) => {
      expect((ws.h.getClass(SYS) as any)['test:mixin:Fresh']).toEqual({ note: 'x' })
      expect((ws.h.getClass(SYS) as any)[MIXIN].rank).toBe(1)
    }
  ],
  [
    'pushes into an array of a system document',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxUpdateDoc(SYS, core.space.Model, 'sys-1' as Ref<Doc>, { $push: { tags: 'b' } })],
        true
      )
    },
    (ws) => {
      expect((ws.db.findObject('sys-1' as Ref<Doc>) as any).tags).toEqual(['a', 'b'])
    }
  ],
  [
    'pulls from an array of a system document',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxUpdateDoc(SYS, core.space.Model, 'sys-1' as Ref<Doc>, { $pull: { tags: 'a' } })],
        true
      )
    },
    (ws) => {
      expect((ws.db.findObject('sys-1' as Ref<Doc>) as any).tags).toEqual([])
    }
  ],
  [
    'increments a number of a system document',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxUpdateDoc(SYS, core.space.Model, 'sys-1' as Ref<Doc>, { $inc: { counter: 5 } } as any)],
        true
      )
    },
    (ws) => {
      expect((ws.db.findObject('sys-1' as Ref<Doc>) as any).counter).toBe(6)
    }
  ],
  [
    'sets a nested field of a system document',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxUpdateDoc(SYS, core.space.Model, 'sys-1' as Ref<Doc>, { 'nested.key': 'w' } as any)],
        true
      )
    },
    (ws) => {
      expect((ws.db.findObject('sys-1' as Ref<Doc>) as any).nested.key).toBe('w')
    }
  ],
  [
    'creates its own document of a system class',
    (ws) => {
      ws.db.addTxes(ctx, [docTx(SYS, 'ws-doc', 'own doc')], true)
    },
    (ws) => {
      expect(ws.db.findObject('ws-doc' as Ref<Doc>)).toBeDefined()
      expect(ws.db.findAllSync(SYS, {})).toHaveLength(3)
      expect(ws.db.findAllSync(SYS, { _id: 'ws-doc' } as any)).toHaveLength(1)
    }
  ],
  [
    'updates and then removes its own document',
    (ws) => {
      ws.db.addTxes(ctx, [docTx(SYS, 'ws-doc', 'own doc')], true)
      ws.db.addTxes(
        ctx,
        [factory.createTxUpdateDoc(SYS, core.space.Model, 'ws-doc' as Ref<Doc>, { label: 'edited' } as any)],
        true
      )
      ws.db.addTxes(ctx, [factory.createTxRemoveDoc(SYS, core.space.Model, 'ws-doc' as Ref<Doc>)], true)
    },
    (ws) => {
      expect(ws.db.findObject('ws-doc' as Ref<Doc>)).toBeUndefined()
      expect(ws.db.findAllSync(SYS, {})).toHaveLength(2)
    }
  ],
  [
    'removes a system document',
    (ws) => {
      ws.db.addTxes(ctx, [factory.createTxRemoveDoc(SYS, core.space.Model, 'sys-1' as Ref<Doc>)], true)
    },
    (ws) => {
      expect(ws.db.findObject('sys-1' as Ref<Doc>)).toBeUndefined()
      expect(ws.db.findAllSync(SYS, {})).toHaveLength(1)
    }
  ],
  [
    'removes and re-creates a system document',
    (ws) => {
      ws.db.addTxes(ctx, [factory.createTxRemoveDoc(SYS, core.space.Model, 'sys-1' as Ref<Doc>)], true)
      ws.db.addTxes(ctx, [docTx(SYS, 'sys-1', 'back')], true)
    },
    (ws) => {
      expect((ws.db.findObject('sys-1' as Ref<Doc>) as any).label).toBe('back')
      expect(ws.db.findAllSync(SYS, {})).toHaveLength(2)
    }
  ],
  [
    'creates and removes a document in one batch',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [docTx(SYS, 'ws-doc', 'own doc'), factory.createTxRemoveDoc(SYS, core.space.Model, 'ws-doc' as Ref<Doc>)],
        true
      )
    },
    (ws) => {
      expect(ws.db.findObject('ws-doc' as Ref<Doc>)).toBeUndefined()
      expect(ws.db.findAllSync(SYS, {}).map((it) => it._id)).not.toContain('ws-doc')
    }
  ],
  [
    'renames a system class',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxUpdateDoc(core.class.Class, core.space.Model, SYS, { label: 'renamed' } as any)],
        true
      )
    },
    (ws) => {
      expect(ws.h.getClass(SYS).label).toBe('renamed')
    }
  ],
  [
    'adds and removes its own class',
    (ws) => {
      ws.db.addTxes(ctx, [classTx(WS, SYS), docTx(WS, 'ws-1', 'own')], true)
      expect(ws.h.getDescendants(SYS)).toContain(WS)
      ws.db.addTxes(
        ctx,
        [
          factory.createTxRemoveDoc(WS, core.space.Model, 'ws-1' as Ref<Doc>),
          factory.createTxRemoveDoc(core.class.Class, core.space.Model, WS)
        ],
        true
      )
    },
    (ws) => {
      expect(ws.h.findClass(WS)).toBeUndefined()
      expect(ws.h.getDescendants(SYS)).not.toContain(WS)
      expect(ws.h.isDerived(WS, core.class.Doc)).toBe(false)
    }
  ],
  [
    'removes a system class',
    (ws) => {
      ws.db.addTxes(ctx, [factory.createTxRemoveDoc(core.class.Class, core.space.Model, SYS)], true)
    },
    (ws) => {
      expect(ws.h.findClass(SYS)).toBeUndefined()
      expect(ws.h.getDescendants(core.class.Doc)).not.toContain(SYS)
      expect(ws.h.getDescendants(SYS)).toEqual([])
    }
  ],
  [
    'removes and re-creates a system class',
    (ws) => {
      ws.db.addTxes(ctx, [factory.createTxRemoveDoc(core.class.Class, core.space.Model, SYS)], true)
      ws.db.addTxes(ctx, [classTx(SYS, core.class.Doc)], true)
    },
    (ws) => {
      expect(ws.h.isDerived(SYS, core.class.Doc)).toBe(true)
      expect(ws.h.getDescendants(core.class.Doc)).toContain(SYS)
    }
  ],
  [
    're-points a system class under its own class',
    (ws) => {
      ws.db.addTxes(ctx, [classTx(WS, core.class.Doc)], true)
      ws.db.addTxes(ctx, [factory.createTxUpdateDoc(core.class.Class, core.space.Model, SYS, { extends: WS })], true)
    },
    (ws) => {
      expect(ws.h.isDerived(SYS, WS)).toBe(true)
      expect(ws.h.getDescendants(WS)).toContain(SYS)
      expect(ws.h.getAncestors(SYS)).toContain(WS)
    }
  ],
  [
    'makes a system class implement an interface',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxUpdateDoc(core.class.Class, core.space.Model, SYS, { implements: [IFACE] })],
        true
      )
    },
    (ws) => {
      expect(ws.h.isImplements(SYS, IFACE as any)).toBe(true)
      expect(ws.h.getAncestors(SYS)).toContain(IFACE)
    }
  ],
  [
    'removes a system mixin classifier',
    (ws) => {
      ws.db.addTxes(ctx, [factory.createTxRemoveDoc(core.class.Class, core.space.Model, MIXIN)], true)
    },
    (ws) => {
      expect(ws.h.findClass(MIXIN)).toBeUndefined()
      expect(ws.h.isMixin(MIXIN)).toBe(false)
      expect(ws.h.getDescendants(core.class.Doc)).not.toContain(MIXIN)
      // the mixin value stays on the class document, only the classifier is gone
      expect((ws.h.getClass(SYS) as any)[MIXIN].rank).toBe(1)
    }
  ],
  [
    'removes a system interface',
    (ws) => {
      ws.db.addTxes(ctx, [factory.createTxRemoveDoc(core.class.Interface, core.space.Model, IFACE)], true)
    },
    (ws) => {
      expect(() => ws.h.getInterface(IFACE as any)).toThrow()
      expect(ws.db.findObject(IFACE as any)).toBeUndefined()
    }
  ],
  [
    'moves a system class into another domain',
    (ws) => {
      ws.db.addTxes(
        ctx,
        [factory.createTxUpdateDoc(core.class.Class, core.space.Model, SYS, { domain: 'ws-domain' } as any)],
        true
      )
    },
    (ws) => {
      expect(ws.h.getDomain(SYS)).toBe('ws-domain')
      expect(ws.h.domains()).toContain('ws-domain')
    }
  ]
]

describe('workspace operations never reach the shared model', () => {
  it.each(scenarios)('%s', (_name, act, check) => {
    const base = scenarioBase()
    const before = fullSnapshot(base)
    const ws = overlay(base)
    const neighbour = overlay(base)
    // a neighbour that already derived its caches before the other workspace starts writing
    const neighbourBefore = fullSnapshot(neighbour)

    act(ws)
    check(ws)

    expect(fullSnapshot(base)).toBe(before)
    expect(fullSnapshot(neighbour)).toBe(neighbourBefore)
    expect(fullSnapshot(overlay(base))).toBe(before)
    expect(allFrozen(base.db)).toBe(true)
  })

  it('keeps the shared model intact when every scenario runs against its own workspace', () => {
    const base = scenarioBase()
    const before = fullSnapshot(base)

    for (const [, act] of scenarios) {
      act(overlay(base))
    }

    expect(fullSnapshot(base)).toBe(before)
    expect(allFrozen(base.db)).toBe(true)
  })

  it('keeps every scenario isolated when all of them run against one workspace each, interleaved', () => {
    const base = scenarioBase()
    const before = fullSnapshot(base)
    const workspaces = scenarios.map(() => overlay(base))

    // every workspace performs its own operation, then every result is verified again
    scenarios.forEach(([, act], idx) => {
      act(workspaces[idx])
    })
    scenarios.forEach(([, , check], idx) => {
      check(workspaces[idx])
    })

    expect(fullSnapshot(base)).toBe(before)
  })
})

// ModelMiddleware feeds the hierarchy directly when a model filter is configured (fulltext pod),
// so the same copy-on-write rules must hold without a ModelDb behind it.
describe('hierarchy fed directly, without a ModelDb', () => {
  function frozenBase (): Hierarchy {
    const base = shared()
    base.db.addTxes(ctx, [attrTx('attr-sys', 'sysAttr')], true)
    base.db.freeze()
    return base.h
  }

  it('copies a classifier before updating it', () => {
    const base = frozenBase()
    const h = new Hierarchy(base)

    h.tx(factory.createTxUpdateDoc(core.class.Class, core.space.Model, SYS, { label: 'renamed' } as any))

    expect(h.getClass(SYS).label).toBe('renamed')
    expect(base.getClass(SYS).label).not.toBe('renamed')
  })

  it('copies a classifier before mixing into it', () => {
    const base = frozenBase()
    const h = new Hierarchy(base)

    h.tx(factory.createTxMixin(SYS, core.class.Class, core.space.Model, 'test:mixin:M' as any, { v: 1 } as any))

    expect((h.getClass(SYS) as any)['test:mixin:M']).toEqual({ v: 1 })
    expect((base.getClass(SYS) as any)['test:mixin:M']).toBeUndefined()
  })

  it('copies an attribute before updating it', () => {
    const base = frozenBase()
    const h = new Hierarchy(base)

    h.tx(
      factory.createTxUpdateDoc(
        core.class.Attribute,
        core.space.Model,
        'attr-sys' as Ref<Doc>,
        {
          hidden: true
        } as any
      )
    )

    expect(h.getAllAttributes(SYS).get('sysAttr')?.hidden).toBe(true)
    expect(base.getAllAttributes(SYS).get('sysAttr')?.hidden).toBeUndefined()
  })
})

describe('shared model internals', () => {
  it('freezes nested values, not just the document', () => {
    const base = shared()
    base.db.addTxes(ctx, [attrTx('attr-sys', 'sysAttr')], true)
    base.db.freeze()

    const attr = base.db.findObject('attr-sys' as Ref<Doc>) as any
    expect(Object.isFrozen(attr)).toBe(true)
    expect(Object.isFrozen(attr.type)).toBe(true)
  })

  it('resolves an inherited domain without writing it into the shared class', () => {
    const base = shared()
    base.db.addTxes(
      ctx,
      [
        factory.createTxCreateDoc(
          core.class.Class,
          core.space.Model,
          { kind: ClassifierKind.CLASS, extends: SYS, label: '' as any },
          'test:class:NoDomain' as Ref<Class<Obj>>
        )
      ],
      true
    )
    base.db.freeze()
    const ws = overlay(base)
    const _class = 'test:class:NoDomain' as Ref<Class<Doc>>

    expect(ws.h.findDomain(_class)).toBe(DOMAIN_MODEL)
    // second call comes from the cache, and the shared class stays without its own domain
    expect(ws.h.findDomain(_class)).toBe(DOMAIN_MODEL)
    expect(base.h.getClass(_class).domain).toBeUndefined()
  })

  it('reports a document removed twice as missing', () => {
    const base = shared()
    const ws = overlay(base)
    const remove = factory.createTxRemoveDoc(SYS, core.space.Model, 'sys-1' as Ref<Doc>)

    ws.db.addTxes(ctx, [remove, remove], true)

    expect(ws.db.findObject('sys-1' as Ref<Doc>)).toBeUndefined()
    expect(base.db.findObject('sys-1' as Ref<Doc>)).toBeDefined()
  })

  it('falls back to the shared attribute when its override is removed', () => {
    const base = shared()
    base.db.addTxes(ctx, [attrTx('attr-sys', 'sysAttr')], true)
    base.db.freeze()
    const ws = overlay(base)

    ws.db.addTxes(ctx, [attrTx('attr-own', 'sysAttr')], true)
    expect(ws.h.getAllAttributes(SYS).get('sysAttr')?._id).toBe('attr-own')

    ws.db.addTxes(
      ctx,
      [factory.createTxRemoveDoc(core.class.Attribute, core.space.Model, 'attr-own' as Ref<Doc>)],
      true
    )
    expect(ws.h.getAllAttributes(SYS).get('sysAttr')?._id).toBe('attr-sys')
  })

  it('drops attributes of a class removed in the workspace', () => {
    const base = shared()
    base.db.addTxes(ctx, [attrTx('attr-sys', 'sysAttr')], true)
    base.db.freeze()
    const ws = overlay(base)

    ws.db.addTxes(ctx, [factory.createTxRemoveDoc(core.class.Class, core.space.Model, SYS)], true)

    expect(() => ws.h.getAllAttributes(SYS)).toThrow()
    expect(base.h.getAllAttributes(SYS).get('sysAttr')).toBeDefined()
  })

  it('ignores an update of a document neither side has', () => {
    const base = shared()
    const ws = overlay(base)

    ws.db.addTxes(
      ctx,
      [factory.createTxUpdateDoc(SYS, core.space.Model, 'missing' as Ref<Doc>, { label: 'x' } as any)],
      true
    )

    expect(ws.db.findObject('missing' as Ref<Doc>)).toBeUndefined()
  })
})

describe('transactions that reference nothing', () => {
  it('ignores updates, removals and mixins of unknown classifiers and attributes', () => {
    const base = shared()
    base.db.freeze()
    const h = new Hierarchy(base.h)
    const missing = 'test:missing:Doc' as Ref<Doc>

    h.tx(factory.createTxUpdateDoc(core.class.Attribute, core.space.Model, missing, { hidden: true } as any))
    h.tx(
      factory.createTxUpdateDoc(core.class.Class, core.space.Model, missing as Ref<Class<Doc>>, { label: 'x' } as any)
    )
    h.tx(factory.createTxRemoveDoc(core.class.Attribute, core.space.Model, missing))
    h.tx(
      factory.createTxMixin(missing as Ref<Class<Doc>>, core.class.Class, core.space.Model, 'test:mixin:M' as any, {})
    )

    expect(h.findClass(missing as Ref<Class<Doc>>)).toBeUndefined()
    expect(snapshotOf(base.h)).toBe(snapshotOf(new Hierarchy(base.h)))
  })

  it('ignores an update of an attribute the workspace already removed', () => {
    const base = shared()
    base.db.addTxes(ctx, [attrTx('attr-sys', 'sysAttr')], true)
    base.db.freeze()
    const h = new Hierarchy(base.h)

    h.tx(factory.createTxRemoveDoc(core.class.Attribute, core.space.Model, 'attr-sys' as Ref<Doc>))
    h.tx(
      factory.createTxUpdateDoc(core.class.Attribute, core.space.Model, 'attr-sys' as Ref<Doc>, { hidden: true } as any)
    )

    expect(h.findAttribute(SYS, 'sysAttr')).toBeUndefined()
    expect(base.h.findAttribute(SYS, 'sysAttr')?.hidden).toBeUndefined()
  })

  it('gives no domain when the ancestor chain is broken', () => {
    const base = shared()
    base.db.addTxes(
      ctx,
      [
        factory.createTxCreateDoc(
          core.class.Class,
          core.space.Model,
          { kind: ClassifierKind.CLASS, extends: 'test:class:Gone' as Ref<Class<Obj>>, label: '' as any },
          'test:class:Orphan' as Ref<Class<Obj>>
        )
      ],
      true
    )
    const ws = overlay(base)

    expect(ws.h.findDomain('test:class:Orphan' as Ref<Class<Doc>>)).toBeUndefined()
  })

  it('walks interfaces the shared class extends', () => {
    const base = shared()
    base.db.addTxes(
      ctx,
      [
        factory.createTxCreateDoc(
          core.class.Interface,
          core.space.Model,
          { kind: ClassifierKind.INTERFACE, label: '' as any },
          'test:interface:Base' as any
        ),
        factory.createTxCreateDoc(
          core.class.Interface,
          core.space.Model,
          { kind: ClassifierKind.INTERFACE, extends: ['test:interface:Base' as any], label: '' as any },
          'test:interface:Derived' as any
        )
      ],
      true
    )
    const ws = overlay(base)

    expect(ws.h.getAncestors('test:interface:Derived' as Ref<Class<Doc>>)).toContain('test:interface:Base')
  })

  it('returns undefined from asIf for an absent document', () => {
    const base = shared()
    const ws = overlay(base)

    expect(ws.h.asIf(undefined, 'test:mixin:M' as any)).toBeUndefined()
  })
})
