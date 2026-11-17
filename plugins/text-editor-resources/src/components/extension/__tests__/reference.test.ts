// SPDX-License-Identifier: EPL-2.0

import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { type Location } from '@hcengineering/ui'
import { getTargetObjectFromUrl } from '../reference'

jest.mock('@tiptap/core', () => ({ mergeAttributes: jest.fn() }))
jest.mock('@tiptap/pm/state', () => ({ Plugin: jest.fn(), PluginKey: jest.fn() }))
jest.mock('@hcengineering/text', () => ({ ReferenceNode: { extend: jest.fn(() => ({})) } }))
jest.mock('../suggestion', () => ({ __esModule: true, default: {} }))
jest.mock('../../MentionList.svelte', () => ({ __esModule: true, default: {} }))
jest.mock('../../node-view', () => ({ SvelteRenderer: jest.fn() }))
jest.mock('@hcengineering/platform', () => ({
  getMetadata: jest.fn(),
  getResource: jest.fn(),
  translate: jest.fn()
}))
jest.mock('@hcengineering/presentation', () => ({
  __esModule: true,
  default: { metadata: { FrontUrl: 'presentation:metadata:FrontUrl' }, string: {} },
  createQuery: jest.fn(),
  getBlobRef: jest.fn(),
  getClient: jest.fn(),
  MessageBox: {}
}))
jest.mock('@hcengineering/view', () => ({
  __esModule: true,
  default: {
    mixin: {
      LinkIdProvider: 'view:mixin:LinkIdProvider',
      ReferenceObjectProvider: 'view:mixin:ReferenceObjectProvider',
      ObjectTooltip: 'view:mixin:ObjectTooltip',
      ObjectIdentifier: 'view:mixin:ObjectIdentifier',
      ObjectTitle: 'view:mixin:ObjectTitle'
    }
  }
}))
jest.mock('@hcengineering/activity', () => ({
  __esModule: true,
  default: { class: { ActivityMessage: 'activity:class:ActivityMessage' } }
}))
jest.mock('@hcengineering/contact', () => ({
  __esModule: true,
  default: { mention: { Everyone: 'contact:mention:Everyone', Here: 'contact:mention:Here' } }
}))
jest.mock('@hcengineering/ui', () => ({
  parseLocation: jest.fn(),
  showPopup: jest.fn(),
  tooltip: jest.fn(),
  fromCodePoint: jest.fn()
}))
jest.mock('@hcengineering/workbench', () => ({
  __esModule: true,
  default: {
    class: { Application: 'workbench:class:Application' },
    metadata: { ExcludedApplications: 'workbench:metadata:ExcludedApplications' }
  }
}))

describe('getTargetObjectFromUrl', () => {
  it('resolves pasted reference locations without changing foreground navigation', async () => {
    const location: Location = { path: ['workbench', 'workspace', 'tracker'] }
    const resolver = jest.fn().mockResolvedValue({
      loc: { ...location, fragment: 'issue|ISSUE-1|tracker:class:Issue' }
    })
    const findAllSync = jest.fn((_class: string) => {
      if (_class === 'workbench:class:Application') {
        return [{ alias: 'tracker', locationResolver: 'tracker:function:ResolveLocation' }]
      }
      return []
    })
    const client = {
      getModel: () => ({ findAllSync }),
      getHierarchy: () => ({ isDerived: () => false })
    }
    jest.mocked(getClient).mockReturnValue(client as unknown as ReturnType<typeof getClient>)
    jest.mocked(getResource).mockResolvedValue(resolver)

    await expect(getTargetObjectFromUrl(location)).resolves.toEqual({
      _id: 'ISSUE-1',
      _class: 'tracker:class:Issue'
    })
    expect(resolver).toHaveBeenCalledWith(location, { background: true })
  })
})
