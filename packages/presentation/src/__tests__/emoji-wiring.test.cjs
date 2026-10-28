// SPDX-License-Identifier: EPL-2.0

// Run with node. Compile production components in memory; mock only app services/layout.
const { before, afterEach, test } = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { resolve, dirname } = require('node:path')
const { pathToFileURL } = require('node:url')
const vm = require('node:vm')

const root = resolve(__dirname, '../../../..')
const sourceRoot = process.env.EMOJI_SOURCE_ROOT ?? root
// An existing checkout may supply dependencies without installing into the worktree.
const dependencyRoot = process.env.EMOJI_DEPS_ROOT ?? root
const deps = createRequire(resolve(dependencyRoot, 'packages/presentation/package.json'))
const emojiDeps = createRequire(resolve(dependencyRoot, 'plugins/emoji/package.json'))
const ts = deps('typescript')
const { compile } = deps('svelte/compiler')
const jsdomDeps = createRequire(deps.resolve('jest-environment-jsdom'))
const { JSDOM } = jsdomDeps('jsdom')
const desktop = emojiDeps('emojibase-data/en/data.json').find((emoji) => emoji.hexcode === '1F5A5')
const iconId = 'view:icon-with-emoji'
let runtime
let svelte
let stores
let mounted = []

function source (path) {
  return readFileSync(resolve(sourceRoot, path), 'utf8')
}

function evaluate (code, filename, imports) {
  const output = ts.transpileModule(code, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const module = { exports: {} }
  const requireMock = (name) => {
    if (!(name in imports)) throw new Error(`Unmocked import ${name} in ${filename}`)
    return imports[name]
  }
  vm.runInThisContext(`(function(require, module, exports) {${output}\n})`, { filename })(
    requireMock, module, module.exports
  )
  return module.exports
}

function loadPresentation () {
  const path = 'plugins/emoji/src/presentation.ts'
  return evaluate(source(path), path, {
    './presentation-data': evaluate(source('plugins/emoji/src/presentation-data.ts'), 'presentation-data.ts', {})
    // Intentionally no emojibase-data import: synchronous rendering must not load the full dataset.
  })
}

function component (code, filename, imports) {
  const prepared = code.replace(/<style[\s\S]*?<\/style>/g, '').replace(
    /<script lang="ts">([\s\S]*?)<\/script>/g,
    (_, script) => `<script>${ts.transpileModule(script, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true }
    }).outputText}</script>`
  )
  const compiled = compile(prepared, { filename, generate: 'dom', css: 'external' }).js.code
  return evaluate(compiled, filename, {
    'svelte/internal': runtime,
    'svelte': svelte,
    'svelte/store': stores,
    'svelte/internal/disclose-version': {},
    ...Object.fromEntries(Object.entries(imports).map(([name, value]) => [
      name, typeof value === 'function' ? { default: value } : value
    ]))
  }).default
}

function fixture () {
  const presentation = loadPresentation()
  const emoji = {
    default: { component: { EmojiPopup: 'emoji-popup' }, string: {}, icon: {} },
    ...presentation,
    isCustomEmoji: (value) => value.image !== undefined
  }
  const Slot = component('<slot />', 'Slot.svelte', {})
  const Empty = component('', 'Empty.svelte', {})
  const blob = async () => ({ src: '/custom.png', srcset: '/custom@2x.png 2x' })
  const ui = {
    default: { string: {} },
    Scroller: Slot, Lazy: Slot, Modal: Slot, ButtonBase: Slot,
    Label: Empty, SearchInput: Empty, Icon: Empty, ButtonIcon: Empty,
    ModernEditbox: Empty, TextArea: Empty,
    ButtonMenu: component(`<script>import { createEventDispatcher } from 'svelte'
      const dispatch = createEventDispatcher()</script>
      <button class="choose-emoji" on:click={() => dispatch('selected', 'emoji')}>Emoji</button>`, 'Menu.svelte', {}),
    tooltip: () => ({}), capitalizeFirstLetter: (s) => s,
    deviceOptionsStore: stores.writable({ fontSize: 16, isMobile: false }),
    themeStore: stores.writable({ dark: false }),
    getPlatformColorDef: () => ({ name: 'blue' }),
    closeTooltip: () => {},
    // Match the old UI decoder when checking pre-fix production wiring.
    fromCodePoint: (...codes) => String.fromCodePoint(...codes.map((code) => Math.min(code, 0x10ffff)))
  }
  const platform = { getEmbeddedLabel: (s) => s }
  const utils = { getEmojiSkins: () => undefined, getUnicodeEmojiByShortCode: () => desktop }
  const store = {
    searchEmoji: stores.writable(''), unicodeEmojiStore: stores.writable([desktop]),
    customEmojiStore: stores.writable([]), resultEmojis: stores.writable([desktop]),
    getSkinTone: () => 0, getFrequentlyEmojis: () => [desktop], addFrequentlyEmojis: () => {}
  }
  const categories = [{ id: 'frequently-used', emojis: [desktop] }]
  const common = {
    '@hcengineering/core': { default: { class: {} } },
    '@hcengineering/emoji': emoji,
    '@hcengineering/platform': platform,
    '@hcengineering/ui': ui,
    '@hcengineering/presentation': { getBlobRef: blob },
    '../utils': utils, '../store': store,
    '../types': { emojiCategories: categories },
    './ActionsPopup.svelte': Empty, './SkinTonePopup.svelte': Empty
  }
  const resources = 'plugins/emoji-resources/src/components/'
  const Button = component(source(resources + 'EmojiButton.svelte'), 'EmojiButton.svelte', common)
  const Palette = component(source(resources + 'EmojiGroupPalette.svelte'), 'EmojiGroupPalette.svelte', {
    ...common, './EmojiButton.svelte': Button
  })
  const Group = component(source(resources + 'EmojiGroup.svelte'), 'EmojiGroup.svelte', {
    ...common, './EmojiGroupPalette.svelte': Palette
  })
  const Popup = component(source(resources + 'EmojiPopup.svelte'), 'EmojiPopup.svelte', {
    ...common, './EmojiGroup.svelte': Group
  })
  // The actual dynamic resource host forwards props and events to the real popup.
  const Dynamic = component(`<script>import Popup from 'Popup'
    export let props = {}</script><Popup {...props} on:close />`, 'Dynamic.svelte', { Popup })
  ui.Component = Dynamic
  const Icon = component(source('packages/presentation/src/components/IconWithEmoji.svelte'), 'IconWithEmoji.svelte', {
    ...common, '../preview': { getBlobRef: blob }
  })
  const view = { default: { ids: { IconWithEmoji: iconId }, string: {} } }
  const Picker = component(source('plugins/view-resources/src/components/IconPicker.svelte'), 'IconPicker.svelte', {
    ...common, '../icons': { iconsLibrary: [] }, '../plugin': view, './ColorsPopup.svelte': Empty
  })
  const taskType = { _id: 'task-type', statuses: [], statusCategories: [] }
  const type = { _id: 'project-type', statuses: [] }
  const client = { getModel: () => ({ findAllSync: () => [] }) }
  const query = { query: () => {}, unsubscribe: () => {} }
  const State = component(source('plugins/task-resources/src/components/state/CreateStatePopup.svelte'), 'CreateStatePopup.svelte', {
    ...common,
    '@hcengineering/presentation': { default: { string: {} }, IconWithEmoji: Icon, getClient: () => client, createQuery: () => query },
    '@hcengineering/setting-resources': { settingsStore: stores.writable({}) },
    '@hcengineering/task': { default: {}, createState: () => {} },
    '@hcengineering/view-resources': { ColorsPopup: Empty, statusStore: stores.writable({}) },
    '@hcengineering/view-resources/src/plugin': view,
    '../..': { taskTypeStore: stores.writable(new Map([[taskType._id, taskType]])), typeStore: stores.writable(new Map([[type._id, type]])) },
    '../../plugin': { default: { string: {} } },
    './ApproveStatusRenamePopup.svelte': Empty, './DeleteStateConfirmationPopup.svelte': Empty
  })
  function reference (color) {
    const hierarchy = { isDerived: () => false, findClass: () => ({ icon: iconId, color }) }
    const module = evaluate(source('plugins/text-editor-resources/src/components/extension/reference.ts'), 'reference.ts', {
      ...common,
      '@tiptap/core': { mergeAttributes: Object.assign },
      '@tiptap/pm/state': { PluginKey: class {} },
      '@hcengineering/text': { ReferenceNode: { extend: (options) => options } },
      '@hcengineering/presentation': { getClient: () => ({ getHierarchy: () => hierarchy }), createQuery: () => query, getBlobRef: blob },
      '@hcengineering/view': view,
      '@hcengineering/contact': { default: { mention: { Here: 'here', Everyone: 'everyone' }, class: { Contact: 'contact' } } },
      '@hcengineering/activity': {}, '@hcengineering/workbench': {},
      '../MentionList.svelte': Empty, '../node-view': {}, './suggestion': {}
    })
    const extension = module.ReferenceExtension
    const viewInstance = extension.addNodeView.call({ name: 'reference', options: { HTMLAttributes: {}, suggestion: { char: '@' } } })({
      node: { attrs: { id: 'doc', objectclass: 'class', label: 'Document' } }, HTMLAttributes: {}
    })
    document.body.append(viewInstance.dom)
    return viewInstance.dom.querySelector('span')
  }
  return { Popup, Picker, State, Icon, reference, taskType, type }
}

function mount (Component, props) {
  const target = document.createElement('div')
  document.body.append(target)
  const instance = new Component({ target, props })
  mounted.push(instance)
  return { target, instance }
}

before(async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>')
  global.window = dom.window
  global.document = dom.window.document
  global.CustomEvent = dom.window.CustomEvent
  runtime = await import(pathToFileURL(deps.resolve('svelte/internal')).href)
  svelte = await import(pathToFileURL(resolve(dirname(deps.resolve('svelte/internal')), '../index.js')).href)
  stores = await import(pathToFileURL(deps.resolve('svelte/store')).href)
})

afterEach(() => {
  for (const component of mounted) component.$destroy()
  mounted = []
  document.body.replaceChildren()
})

test('shared rendering loads only the compact lookup and preserves every Unicode qualification', () => {
  const { getEmojiFromCodePoints } = loadPresentation()
  const unicode = emojiDeps('emojibase-data/meta/unicode.json')
  const expected = new Map()
  for (const emoji of unicode) {
    if (!emoji.includes('\uFE0F')) continue
    const key = emoji.replace(/\uFE0F/g, '')
    if (emoji.length > (expected.get(key)?.length ?? 0)) expected.set(key, emoji)
  }
  for (const emoji of unicode) {
    const key = emoji.replace(/\uFE0F/g, '')
    const codepoints = Array.from(key, (character) => character.codePointAt(0))
    assert.equal(getEmojiFromCodePoints(codepoints), expected.get(key) ?? key)
  }
})

test('Desktop click traverses the production button, palette, popup and icon picker close events', async () => {
  const { Picker } = fixture()
  const { target, instance } = mount(Picker, { icon: 'ordinary', color: 0xdeadbeef })
  let result
  instance.$on('close', (event) => { result = event.detail })
  target.querySelector('.hulyPopupEmoji-button').click()
  await svelte.tick()
  assert.deepEqual(result, { icon: iconId, color: [0x1f5a5, 0xfe0f] })
})

test('IconWithEmoji renders legacy scalar and array codepoints with FE0F', async () => {
  const { Icon } = fixture()
  for (const icon of [0x1f5a5, [0x1f5a5]]) {
    const { target } = mount(Icon, { icon, size: 'small' })
    assert.equal(target.querySelector('.value').textContent.trim(), desktop.emoji)
  }
})

test('IconPicker highlights legacy scalar and array desktop icons', async () => {
  const { Picker } = fixture()
  for (const color of [0x1f5a5, [0x1f5a5]]) {
    const { target } = mount(Picker, { icon: iconId, color })
    assert.equal(target.querySelector('.hulyPopupEmoji-button.selected')?.textContent.trim(), desktop.emoji)
  }
})

test('CreateStatePopup highlights legacy icons and safely opens the emoji tab for ordinary colour hashes', async () => {
  const { State, taskType, type } = fixture()
  for (const color of [0x1f5a5, [0x1f5a5]]) {
    const { target } = mount(State, { taskType, type, icons: [], icon: iconId, color })
    assert.equal(target.querySelector('.hulyPopupEmoji-button.selected')?.textContent.trim(), desktop.emoji)
  }
  const { target } = mount(State, { taskType, type, icons: [], icon: 'ordinary', color: 0xdeadbeef })
  target.querySelectorAll('.choose-emoji')[1].click()
  await svelte.tick()
  assert.ok(target.querySelector('.hulyPopupEmoji-button'))
  assert.equal(target.querySelector('.hulyPopupEmoji-button.selected'), null)
})

test('reference node view renders legacy scalar and array emoji icons with FE0F', () => {
  const { reference } = fixture()
  for (const color of [0x1f5a5, [0x1f5a5]]) {
    const icon = reference(color)
    assert.equal(icon.textContent, desktop.emoji)
    assert.ok(icon.classList.contains('emoji'))
  }
})
