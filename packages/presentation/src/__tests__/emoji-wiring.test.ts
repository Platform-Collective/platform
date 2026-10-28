// SPDX-License-Identifier: EPL-2.0

// Compile production components in memory; mock only app services/layout.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import vm from 'node:vm'
import * as ts from 'typescript'
import { compile } from 'svelte/compiler'
import * as svelte from 'svelte'
import type { SvelteComponent } from 'svelte'
import * as stores from 'svelte/store'

interface ComponentConstructor {
  new (options: { target: HTMLElement, props?: Record<string, unknown> }): SvelteComponent
}

interface Presentation {
  getEmojiFromCodePoints: (icon: number | number[]) => string
}

interface DesktopEmoji {
  hexcode: string
  emoji: string
}

interface ReferenceExtension {
  addNodeView: (this: unknown) => (options: {
    node: { attrs: { id: string, objectclass: string, label: string } }
    HTMLAttributes: Record<string, unknown>
  }) => { dom: HTMLElement }
}

const root = resolve(__dirname, '../../../..')
const sourceRoot = process.env.EMOJI_SOURCE_ROOT ?? root
const emojiDeps = createRequire(resolve(root, 'plugins/emoji/package.json'))
const desktop = (emojiDeps('emojibase-data/en/data.json') as DesktopEmoji[]).find((emoji) => emoji.hexcode === '1F5A5')
assert.ok(desktop)
const iconId = 'view:icon-with-emoji'
const runtime = require('svelte/internal')
let mounted: SvelteComponent[] = []

function source (path: string): string {
  return readFileSync(resolve(sourceRoot, path), 'utf8')
}

function evaluate<T> (code: string, filename: string, imports: Record<string, unknown>): T {
  const output = ts.transpileModule(code, {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
  const module = { exports: {} }
  const requireMock = (name: string): unknown => {
    if (!(name in imports)) throw new Error(`Unmocked import ${name} in ${filename}`)
    return imports[name]
  }
  // Pass Jest's DOM into the compiled source's lexical scope.
  vm.runInThisContext(`(function(require, module, exports, window, document) {${output}\n})`, { filename })(
    requireMock,
    module,
    module.exports,
    window,
    document
  )
  return module.exports as T
}

function loadPresentation (): Presentation {
  const path = 'plugins/emoji/src/presentation.ts'
  return evaluate<Presentation>(source(path), path, {
    './presentation-data': evaluate(source('plugins/emoji/src/presentation-data.ts'), 'presentation-data.ts', {})
    // Intentionally no emojibase-data import: synchronous rendering must not load the full dataset.
  })
}

function component (code: string, filename: string, imports: Record<string, unknown>): ComponentConstructor {
  const withoutStyles = code.replace(/<style[\s\S]*?<\/style>/g, '')
  const prepared = withoutStyles.replace(/<script lang="ts">([\s\S]*?)<\/script>/g, (_, script: string) => {
    const output = ts.transpileModule(script, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true }
    }).outputText
    return `<script>${output}</script>`
  })
  const compiled = compile(prepared, { filename, generate: 'dom', css: 'external' }).js.code
  return evaluate<{ default: ComponentConstructor }>(compiled, filename, {
    'svelte/internal': runtime,
    svelte,
    'svelte/store': stores,
    'svelte/internal/disclose-version': {},
    ...Object.fromEntries(
      Object.entries(imports).map(([name, value]) => [name, typeof value === 'function' ? { default: value } : value])
    )
  }).default
}

function fixture () {
  const presentation = loadPresentation()
  const emoji = {
    default: { component: { EmojiPopup: 'emoji-popup' }, string: {}, icon: {} },
    ...presentation,
    isCustomEmoji: (value: { image?: string }) => value.image !== undefined
  }
  const Slot = component('<slot />', 'Slot.svelte', {})
  const Empty = component('', 'Empty.svelte', {})
  const blob = async () => ({ src: '/custom.png', srcset: '/custom@2x.png 2x' })
  const ui: Record<string, unknown> = {
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
    ButtonMenu: component(
      `<script>import { createEventDispatcher } from 'svelte'
      const dispatch = createEventDispatcher()</script>
      <button class="choose-emoji" on:click={() => dispatch('selected', 'emoji')}>Emoji</button>`,
      'Menu.svelte',
      {}
    ),
    tooltip: () => ({}),
    capitalizeFirstLetter: (s: string) => s,
    deviceOptionsStore: stores.writable({ fontSize: 16, isMobile: false }),
    themeStore: stores.writable({ dark: false }),
    getPlatformColorDef: () => ({ name: 'blue' }),
    closeTooltip: () => {},
    // Match the old UI decoder when checking pre-fix production wiring.
    fromCodePoint: (...codes: number[]) => String.fromCodePoint(...codes.map((code) => Math.min(code, 0x10ffff)))
  }
  const platform = { getEmbeddedLabel: (s: string) => s }
  const utils = { getEmojiSkins: () => undefined, getUnicodeEmojiByShortCode: () => desktop }
  const store = {
    searchEmoji: stores.writable(''),
    unicodeEmojiStore: stores.writable([desktop]),
    customEmojiStore: stores.writable([]),
    resultEmojis: stores.writable([desktop]),
    getSkinTone: () => 0,
    getFrequentlyEmojis: () => [desktop],
    addFrequentlyEmojis: () => {}
  }
  const categories = [{ id: 'frequently-used', emojis: [desktop] }]
  const common = {
    '@hcengineering/core': { default: { class: {} } },
    '@hcengineering/emoji': emoji,
    '@hcengineering/platform': platform,
    '@hcengineering/ui': ui,
    '@hcengineering/presentation': { getBlobRef: blob },
    '../utils': utils,
    '../store': store,
    '../types': { emojiCategories: categories },
    './ActionsPopup.svelte': Empty,
    './SkinTonePopup.svelte': Empty
  }
  const resources = 'plugins/emoji-resources/src/components/'
  const Button = component(source(resources + 'EmojiButton.svelte'), 'EmojiButton.svelte', common)
  const Palette = component(source(resources + 'EmojiGroupPalette.svelte'), 'EmojiGroupPalette.svelte', {
    ...common,
    './EmojiButton.svelte': Button
  })
  const Group = component(source(resources + 'EmojiGroup.svelte'), 'EmojiGroup.svelte', {
    ...common,
    './EmojiGroupPalette.svelte': Palette
  })
  const Popup = component(source(resources + 'EmojiPopup.svelte'), 'EmojiPopup.svelte', {
    ...common,
    './EmojiGroup.svelte': Group
  })
  // The actual dynamic resource host forwards props and events to the real popup.
  const Dynamic = component(
    `<script>import Popup from 'Popup'
    export let props = {}</script><Popup {...props} on:close />`,
    'Dynamic.svelte',
    { Popup }
  )
  ui.Component = Dynamic
  const Icon = component(source('packages/presentation/src/components/IconWithEmoji.svelte'), 'IconWithEmoji.svelte', {
    ...common,
    '../preview': { getBlobRef: blob }
  })
  const view = { default: { ids: { IconWithEmoji: iconId }, string: {} } }
  const Picker = component(source('plugins/view-resources/src/components/IconPicker.svelte'), 'IconPicker.svelte', {
    ...common,
    '../icons': { iconsLibrary: [] },
    '../plugin': view,
    './ColorsPopup.svelte': Empty
  })
  const taskType = { _id: 'task-type', statuses: [], statusCategories: [] }
  const type = { _id: 'project-type', statuses: [] }
  const client = { getModel: () => ({ findAllSync: () => [] }) }
  const query = { query: () => {}, unsubscribe: () => {} }
  const State = component(
    source('plugins/task-resources/src/components/state/CreateStatePopup.svelte'),
    'CreateStatePopup.svelte',
    {
      ...common,
      '@hcengineering/presentation': {
        default: { string: {} },
        IconWithEmoji: Icon,
        getClient: () => client,
        createQuery: () => query
      },
      '@hcengineering/setting-resources': { settingsStore: stores.writable({}) },
      '@hcengineering/task': { default: {}, createState: () => {} },
      '@hcengineering/view-resources': { ColorsPopup: Empty, statusStore: stores.writable({}) },
      '@hcengineering/view-resources/src/plugin': view,
      '../..': {
        taskTypeStore: stores.writable(new Map([[taskType._id, taskType]])),
        typeStore: stores.writable(new Map([[type._id, type]]))
      },
      '../../plugin': { default: { string: {} } },
      './ApproveStatusRenamePopup.svelte': Empty,
      './DeleteStateConfirmationPopup.svelte': Empty
    }
  )
  function reference (color: number | number[]): HTMLSpanElement {
    const hierarchy = { isDerived: () => false, findClass: () => ({ icon: iconId, color }) }
    const module = evaluate<{ ReferenceExtension: ReferenceExtension }>(
      source('plugins/text-editor-resources/src/components/extension/reference.ts'),
      'reference.ts',
      {
        ...common,
        '@tiptap/core': { mergeAttributes: Object.assign },
        '@tiptap/pm/state': { PluginKey: class {} },
        '@hcengineering/text': { ReferenceNode: { extend: (options: unknown) => options } },
        '@hcengineering/presentation': {
          getClient: () => ({ getHierarchy: () => hierarchy }),
          createQuery: () => query,
          getBlobRef: blob
        },
        '@hcengineering/view': view,
        '@hcengineering/contact': {
          default: { mention: { Here: 'here', Everyone: 'everyone' }, class: { Contact: 'contact' } }
        },
        '@hcengineering/activity': {},
        '@hcengineering/workbench': {},
        '../MentionList.svelte': Empty,
        '../node-view': {},
        './suggestion': {}
      }
    )
    const extension = module.ReferenceExtension
    const viewInstance = extension.addNodeView.call({
      name: 'reference',
      options: { HTMLAttributes: {}, suggestion: { char: '@' } }
    })({
      node: { attrs: { id: 'doc', objectclass: 'class', label: 'Document' } },
      HTMLAttributes: {}
    })
    document.body.append(viewInstance.dom)
    return element<HTMLSpanElement>(viewInstance.dom, 'span')
  }
  return { Popup, Picker, State, Icon, reference, taskType, type }
}

function mount (
  Component: ComponentConstructor,
  props: Record<string, unknown>
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

afterEach(() => {
  for (const component of mounted) component.$destroy()
  mounted = []
  document.body.replaceChildren()
})

test('shared rendering loads only the compact lookup and preserves every Unicode qualification', () => {
  const { getEmojiFromCodePoints } = loadPresentation()
  const unicode = emojiDeps('emojibase-data/meta/unicode.json') as string[]
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

test('Desktop click traverses the production button, palette, popup and icon picker close events', async () => {
  const { Picker } = fixture()
  const { target, instance } = mount(Picker, { icon: 'ordinary', color: 0xdeadbeef })
  let result: unknown
  instance.$on('close', (event) => {
    result = event.detail
  })
  element<HTMLButtonElement>(target, '.hulyPopupEmoji-button').click()
  await svelte.tick()
  expect(result).toEqual({ icon: iconId, color: [0x1f5a5, 0xfe0f] })
})

test('IconWithEmoji renders legacy scalar and array codepoints with FE0F', () => {
  const { Icon } = fixture()
  for (const icon of [0x1f5a5, [0x1f5a5]]) {
    const { target } = mount(Icon, { icon, size: 'small' })
    assert.equal(element(target, '.value').textContent?.trim(), desktop?.emoji)
  }
})

test('IconPicker highlights legacy scalar and array desktop icons', () => {
  const { Picker } = fixture()
  for (const color of [0x1f5a5, [0x1f5a5]]) {
    const { target } = mount(Picker, { icon: iconId, color })
    assert.equal(element(target, '.hulyPopupEmoji-button.selected').textContent?.trim(), desktop?.emoji)
  }
})

test('CreateStatePopup highlights legacy icons and safely opens the emoji tab for ordinary colour hashes', async () => {
  const { State, taskType, type } = fixture()
  for (const color of [0x1f5a5, [0x1f5a5]]) {
    const { target } = mount(State, { taskType, type, icons: [], icon: iconId, color })
    assert.equal(element(target, '.hulyPopupEmoji-button.selected').textContent?.trim(), desktop?.emoji)
  }
  const { target } = mount(State, { taskType, type, icons: [], icon: 'ordinary', color: 0xdeadbeef })
  target.querySelectorAll<HTMLButtonElement>('.choose-emoji')[1].click()
  await svelte.tick()
  assert.ok(target.querySelector('.hulyPopupEmoji-button'))
  assert.equal(target.querySelector('.hulyPopupEmoji-button.selected'), null)
})

test('reference node view renders legacy scalar and array emoji icons with FE0F', () => {
  const { reference } = fixture()
  for (const color of [0x1f5a5, [0x1f5a5]]) {
    const icon = reference(color)
    assert.equal(icon.textContent, desktop?.emoji)
    assert.ok(icon.classList.contains('emoji'))
  }
})
