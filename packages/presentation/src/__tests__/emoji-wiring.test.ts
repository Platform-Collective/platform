// SPDX-License-Identifier: EPL-2.0

import assert from 'node:assert/strict'
import { tick } from 'svelte'
import type { SvelteComponent } from 'svelte'
import Icon from '../components/IconWithEmoji.svelte'

type ComponentConstructor<Props extends Record<string, unknown> = Record<string, unknown>> = new (options: {
  target: HTMLElement
  props?: Props
}) => SvelteComponent

interface ReferenceNodeView {
  addNodeView: (
    this: unknown
  ) => (options: {
    node: { attrs: { id: string, objectclass: string, label: string } }
    HTMLAttributes: Record<string, unknown>
  }) => { dom: HTMLElement, destroy: () => void }
}

// The drawing suite supplies a manual Svelte mock with a no-op dispatcher.
jest.unmock('svelte')

jest.mock('@hcengineering/emoji', () => ({
  __esModule: true,
  default: { component: { EmojiPopup: 'emoji-popup' }, string: {}, icon: {} },
  ...jest.requireActual('../../../../plugins/emoji/src/presentation'),
  isCustomEmoji: (value: { image?: string }) => value.image !== undefined
}))

jest.mock('@hcengineering/ui', () => {
  const { writable } = jest.requireActual('svelte/store')
  const Slot = require('./fixtures/emoji/Slot.svelte').default
  const Empty = require('./fixtures/emoji/Empty.svelte').default
  return {
    __esModule: true,
    default: { string: {} },
    Scroller: Slot,
    Lazy: Slot,
    Modal: Slot,
    ButtonBase: Slot,
    Label: Empty,
    SearchInput: Empty,
    Icon: Empty,
    ButtonIcon: Empty,
    ModernEditbox: Empty,
    TextArea: Empty,
    ButtonMenu: require('./fixtures/emoji/Menu.svelte').default,
    get Component (): ComponentConstructor {
      return require('./fixtures/emoji/Dynamic.svelte').default
    },
    tooltip: () => ({}),
    capitalizeFirstLetter: (value: string) => value,
    deviceOptionsStore: writable({ fontSize: 16, isMobile: false }),
    themeStore: writable({ dark: false }),
    getPlatformColorDef: () => ({ name: 'blue' }),
    closeTooltip: () => {}
  }
})

jest.mock('@hcengineering/core', () => ({ __esModule: true, default: { class: {} } }))
jest.mock('@hcengineering/platform', () => ({ getEmbeddedLabel: (value: string) => value }))
jest.mock(
  '@hcengineering/presentation',
  () => ({
    __esModule: true,
    default: { string: {} },
    get IconWithEmoji (): ComponentConstructor {
      return require('../components/IconWithEmoji.svelte').default
    },
    getBlobRef: jest.fn(),
    getClient: jest.fn(),
    createQuery: () => ({ query: jest.fn(), unsubscribe: jest.fn() })
  }),
  { virtual: true }
)
jest.mock('../preview', () => ({ getBlobRef: jest.fn() }))
jest.mock('@hcengineering/setting-resources', () => ({ settingsStore: require('svelte/store').writable({}) }), {
  virtual: true
})
jest.mock('@hcengineering/task', () => ({ __esModule: true, default: {} }), { virtual: true })
jest.mock(
  '@hcengineering/view-resources',
  () => ({
    ColorsPopup: require('./fixtures/emoji/Empty.svelte').default,
    statusStore: require('svelte/store').writable({})
  }),
  { virtual: true }
)
jest.mock(
  '@hcengineering/view-resources/src/plugin',
  () => ({
    __esModule: true,
    default: { ids: { IconWithEmoji: 'view:icon-with-emoji' }, string: {} }
  }),
  { virtual: true }
)
jest.mock('@hcengineering/view', () => ({
  __esModule: true,
  default: { ids: { IconWithEmoji: 'view:icon-with-emoji' }, string: {} }
}))
jest.mock('@hcengineering/contact', () => ({
  __esModule: true,
  default: { mention: { Here: 'here', Everyone: 'everyone' }, class: { Contact: 'contact' } }
}))
jest.mock('@hcengineering/activity', () => ({}), { virtual: true })
jest.mock('@hcengineering/workbench', () => ({}), { virtual: true })
jest.mock('@hcengineering/text', () => ({ ReferenceNode: { extend: (options: unknown) => options } }))
jest.mock('@tiptap/core', () => ({ mergeAttributes: Object.assign }), { virtual: true })
jest.mock('@tiptap/pm/state', () => ({ PluginKey: jest.fn() }), { virtual: true })

jest.mock('../../../../plugins/emoji-resources/src/utils', () => ({
  getEmojiSkins: () => undefined,
  getUnicodeEmojiByShortCode: () => ({ emoji: '✋' })
}))
jest.mock('../../../../plugins/emoji-resources/src/store', () => {
  const { writable } = jest.requireActual('svelte/store')
  const desktop = require('emojibase-data/en/data.json').find((emoji: { hexcode: string }) => emoji.hexcode === '1F5A5')
  return {
    searchEmoji: writable(''),
    unicodeEmojiStore: writable([desktop]),
    customEmojiStore: writable([]),
    resultEmojis: writable([desktop]),
    getSkinTone: () => 0,
    getFrequentlyEmojis: () => [desktop],
    addFrequentlyEmojis: jest.fn()
  }
})
jest.mock('../../../../plugins/emoji-resources/src/types', () => ({
  emojiCategories: [
    {
      id: 'frequently-used',
      emojis: [require('emojibase-data/en/data.json').find((emoji: { hexcode: string }) => emoji.hexcode === '1F5A5')]
    }
  ]
}))
jest.mock('../../../../plugins/emoji-resources/src/components/ActionsPopup.svelte', () =>
  require('./fixtures/emoji/Empty.svelte')
)
jest.mock('../../../../plugins/emoji-resources/src/components/SkinTonePopup.svelte', () =>
  require('./fixtures/emoji/Empty.svelte')
)
jest.mock('../../../../plugins/view-resources/src/icons', () => ({ iconsLibrary: [] }))
jest.mock('../../../../plugins/view-resources/src/plugin', () => ({
  __esModule: true,
  default: { ids: { IconWithEmoji: 'view:icon-with-emoji' }, string: {} }
}))
jest.mock('../../../../plugins/view-resources/src/components/ColorsPopup.svelte', () =>
  require('./fixtures/emoji/Empty.svelte')
)
jest.mock('../../../../plugins/task-resources/src', () => ({
  taskTypeStore: require('svelte/store').writable(
    new Map([['task-type', { _id: 'task-type', statuses: [], statusCategories: [] }]])
  ),
  typeStore: require('svelte/store').writable(new Map([['project-type', { _id: 'project-type', statuses: [] }]]))
}))
jest.mock('../../../../plugins/task-resources/src/plugin', () => ({ __esModule: true, default: { string: {} } }))
jest.mock('../../../../plugins/task-resources/src/components/state/ApproveStatusRenamePopup.svelte', () =>
  require('./fixtures/emoji/Empty.svelte')
)
jest.mock('../../../../plugins/task-resources/src/components/state/DeleteStateConfirmationPopup.svelte', () =>
  require('./fixtures/emoji/Empty.svelte')
)
jest.mock('../../../../plugins/text-editor-resources/src/components/MentionList.svelte', () =>
  require('./fixtures/emoji/Empty.svelte')
)
jest.mock('../../../../plugins/text-editor-resources/src/components/node-view', () => ({}))
jest.mock('../../../../plugins/text-editor-resources/src/components/extension/suggestion', () => ({}))

const iconId = 'view:icon-with-emoji'
const desktopEmoji = String.fromCodePoint(0x1f5a5, 0xfe0f)
const taskType = { _id: 'task-type', statuses: [], statusCategories: [] }
const type = { _id: 'project-type', statuses: [] }
const mounted: SvelteComponent[] = []

// Load cross-package components through Jest without extending this package's Svelte type-checking root.
const Picker: ComponentConstructor = require('../../../../plugins/view-resources/src/components/IconPicker.svelte').default
const State: ComponentConstructor =
  require('../../../../plugins/task-resources/src/components/state/CreateStatePopup.svelte').default

function mount<Props extends Record<string, unknown>> (
  Component: ComponentConstructor<Props>,
  props: Props
): { target: HTMLElement, instance: SvelteComponent } {
  const target = document.createElement('div')
  document.body.append(target)
  const instance = new Component({ target, props })
  mounted.push(instance)
  return { target, instance }
}

function element<T extends Element> (target: ParentNode, selector: string): T {
  const found = target.querySelector<T>(selector)
  assert.ok(found, `Missing element: ${selector}`)
  return found
}

beforeEach(() => {
  jest.useFakeTimers()
  require('@hcengineering/presentation').getClient.mockReturnValue({ getModel: () => ({ findAllSync: () => [] }) })
})

afterEach(() => {
  for (const component of mounted.splice(0)) component.$destroy()
  jest.clearAllTimers()
  jest.useRealTimers()
  document.body.replaceChildren()
})

test('shared rendering loads only the compact lookup and preserves every Unicode qualification', () => {
  const unicode = jest.requireActual<string[]>('emojibase-data/meta/unicode.json')
  jest.doMock('emojibase-data/meta/unicode.json', () => {
    throw new Error('Synchronous rendering must not import the full Unicode dataset')
  })
  try {
    jest.isolateModules(() => {
      const { getEmojiFromCodePoints } = require('../../../../plugins/emoji/src/presentation')
      const expected = new Map<string, string>()
      for (const emoji of unicode) {
        if (!emoji.includes('\uFE0F')) continue
        const key = emoji.replace(/\uFE0F/g, '')
        if (emoji.length > (expected.get(key)?.length ?? 0)) expected.set(key, emoji)
      }
      for (const emoji of unicode) {
        const key = emoji.replace(/\uFE0F/g, '')
        const codepoints = Array.from(key, (character) => character.codePointAt(0) ?? 0)
        assert.equal(getEmojiFromCodePoints(codepoints), expected.get(key) ?? key)
      }
    })
  } finally {
    jest.dontMock('emojibase-data/meta/unicode.json')
  }
})

test('Desktop click traverses the production button, palette, popup and icon picker close events', async () => {
  const { target, instance } = mount(Picker, { icon: 'ordinary', color: 0xdeadbeef })
  let result: unknown
  instance.$on('close', (event) => {
    result = event.detail
  })
  element<HTMLButtonElement>(target, '.hulyPopupEmoji-button').click()
  await tick()
  expect(result).toEqual({ icon: iconId, color: [0x1f5a5, 0xfe0f] })
})

test('IconWithEmoji renders legacy scalar and array codepoints with FE0F', () => {
  for (const icon of [0x1f5a5, [0x1f5a5]]) {
    const { target } = mount(Icon, { icon, size: 'small' })
    assert.equal(element(target, '.value').textContent?.trim(), desktopEmoji)
  }
})

test('IconPicker highlights legacy scalar and array desktop icons', () => {
  for (const color of [0x1f5a5, [0x1f5a5]]) {
    const { target } = mount(Picker, { icon: iconId, color })
    assert.equal(element(target, '.hulyPopupEmoji-button.selected').textContent?.trim(), desktopEmoji)
  }
})

test('CreateStatePopup highlights legacy icons and safely opens the emoji tab for ordinary colour hashes', async () => {
  for (const color of [0x1f5a5, [0x1f5a5]]) {
    const { target } = mount(State, { taskType, type, icons: [], icon: iconId, color })
    assert.equal(element(target, '.hulyPopupEmoji-button.selected').textContent?.trim(), desktopEmoji)
  }
  const { target } = mount(State, { taskType, type, icons: [], icon: 'ordinary', color: 0xdeadbeef, readonly: false })
  element<HTMLButtonElement>(target, '[data-menu-item="emoji"]').click()
  await tick()
  assert.ok(target.querySelector('.hulyPopupEmoji-button'))
  assert.equal(target.querySelector('.hulyPopupEmoji-button.selected'), null)
})

test('reference node view renders legacy scalar and array emoji icons with FE0F', () => {
  for (const color of [0x1f5a5, [0x1f5a5]]) {
    require('@hcengineering/presentation').getClient.mockReturnValue({
      getHierarchy: () => ({ isDerived: () => false, findClass: () => ({ icon: iconId, color }) })
    })
    const reference: {
      ReferenceExtension: ReferenceNodeView
    } = require('../../../../plugins/text-editor-resources/src/components/extension/reference')
    const view = reference.ReferenceExtension.addNodeView.call({
      name: 'reference',
      options: { HTMLAttributes: {}, suggestion: { char: '@' } }
    })({
      node: { attrs: { id: 'doc', objectclass: 'class', label: 'Document' } },
      HTMLAttributes: {}
    })
    document.body.append(view.dom)
    const icon = element<HTMLSpanElement>(view.dom, 'span')
    assert.equal(icon.textContent, desktopEmoji)
    assert.ok(icon.classList.contains('emoji'))
    view.destroy()
  }
})
