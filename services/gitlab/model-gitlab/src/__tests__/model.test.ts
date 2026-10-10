// SPDX-License-Identifier: EPL-2.0
import activity, { type ActivityMessageControl } from '@hcengineering/activity'
import core, {
  type AnyAttribute,
  type Class,
  type Doc,
  type Ref,
  type Tx,
  type TxCreateDoc,
  type TxMixin
} from '@hcengineering/core'
import { Builder } from '@hcengineering/model'
import gitlab from '../plugin'
import { createModel } from '..'

let txes: Tx[] = []

beforeAll(() => {
  const builder = new Builder()
  createModel(builder)
  txes = builder.getTxes()
})

function created<T extends Doc> (objectClass: Ref<Class<T>>): Array<TxCreateDoc<T>> {
  return txes.filter(
    (tx): tx is TxCreateDoc<T> =>
      tx._class === core.class.TxCreateDoc && (tx as TxCreateDoc<T>).objectClass === objectClass
  )
}

function mixinsOf (objectId: Ref<Doc>): Array<TxMixin<Doc, Doc>> {
  return txes.filter(
    (tx): tx is TxMixin<Doc, Doc> => tx._class === core.class.TxMixin && (tx as TxMixin<Doc, Doc>).objectId === objectId
  )
}

function attribute (of: Ref<Class<Doc>>, name: string): AnyAttribute | undefined {
  return created(core.class.Attribute).find((tx) => tx.attributes.attributeOf === of && tx.attributes.name === name)
    ?.attributes as AnyAttribute | undefined
}

describe('gitlab model', () => {
  it('keeps the hidden merge request diff out of activity', () => {
    expect(mixinsOf(gitlab.class.GitlabPatch).map((tx) => tx.mixin)).toContain(activity.mixin.IgnoreActivity)
  })

  it('keeps the merge request image list out of activity', () => {
    const control = created<ActivityMessageControl>(activity.class.ActivityMessageControl).find(
      (tx) => tx.attributes.objectClass === gitlab.class.GitlabMergeRequest
    )
    expect(control?.attributes.skipFields).toContain('images')
  })

  it('declares the hidden diff and viewed-file counters of a merge request', () => {
    expect(attribute(gitlab.class.GitlabMergeRequest, 'patch')?.type).toMatchObject({
      _class: core.class.Collection,
      of: gitlab.class.GitlabPatch
    })
    expect(attribute(gitlab.class.GitlabMergeRequest, 'viewedFiles')?.type).toMatchObject({
      _class: core.class.Collection,
      of: gitlab.class.GitlabMergeRequestReview
    })
  })

  it('labels the repository of issues and merge requests with the same string', () => {
    expect(attribute(gitlab.mixin.GitlabIssue, 'repository')?.label).toBe(gitlab.string.Repository)
    expect(attribute(gitlab.class.GitlabMergeRequest, 'repository')?.label).toBe(gitlab.string.Repository)
  })
})
