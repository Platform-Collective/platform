// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { runInNewContext } from 'vm'
import { compile, preprocess } from 'svelte/compiler'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

interface TextProps {
  node: { type: string, text?: string }
  preview?: boolean
  parseEmojisFunction?: (text: string) => {
    nodes: Array<string | { emoji: string }>
    emojisOnly: boolean
  }
}

interface ViewerComponent {
  render: (props: TextProps) => { html: string }
}

let viewer: ViewerComponent

beforeAll(async () => {
  const filename = join(__dirname, '../components/markup/NodeContent.svelte')
  const processed = await preprocess(
    readFileSync(filename, 'utf8'),
    {
      script: ({ content }) => ({
        code: transpileModule(content, {
          compilerOptions: { module: ModuleKind.ESNext, target: ScriptTarget.ES2020 }
        }).outputText
      }),
      style: () => ({ code: '' })
    },
    { filename }
  )
  const compiled = compile(processed.code, { filename, generate: 'ssr' })
  const code = transpileModule(compiled.js.code, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 }
  }).outputText
  // Transpile the ESM runtime too, without changing the package's CommonJS Jest configuration.
  const runtimeModules = new Map<string, { exports: Record<string, unknown> }>()
  function loadRuntime (filename: string): Record<string, unknown> {
    const cached = runtimeModules.get(filename)
    if (cached !== undefined) return cached.exports
    const runtimeModule = { exports: {} }
    runtimeModules.set(filename, runtimeModule)
    const runtimeCode = transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 }
    }).outputText
    runInNewContext(
      runtimeCode,
      {
        require: (id: string): Record<string, unknown> => loadRuntime(resolve(dirname(filename), id)),
        module: runtimeModule,
        exports: runtimeModule.exports
      },
      { filename }
    )
    return runtimeModule.exports
  }
  const componentModule: { exports: { default?: ViewerComponent } } = { exports: {} }
  // Only text and hard-break branches are exercised; other viewer dependencies are unrelated.
  const load = (id: string): unknown => {
    if (id === '@hcengineering/text') {
      return { MarkupNodeType: { text: 'text', hard_break: 'hardBreak' } }
    }
    return id.startsWith('svelte/') ? loadRuntime(require.resolve(id)) : {}
  }
  runInNewContext(code, { require: load, module: componentModule, exports: componentModule.exports }, { filename })
  if (componentModule.exports.default === undefined) throw new Error('Viewer component was not exported')
  viewer = componentModule.exports.default
})

const parseEmojisFunction: TextProps['parseEmojisFunction'] = () => ({
  nodes: ['one\n', { emoji: '🙂' }, '\ntwo'],
  emojisOnly: false
})

describe('saved markup whitespace', () => {
  it.each(['\ntwo', 'one\n\ntwo', '  one\n  two'])('preserves whitespace in text node %p', (text) => {
    const { html } = viewer.render({ node: { type: 'text', text } })
    expect(html).toContain(`<span style="white-space: pre-wrap;">${text}</span>`)
  })

  it.each([undefined, parseEmojisFunction])('preserves text newlines with emoji parser %p', (parser) => {
    const { html } = viewer.render({
      node: { type: 'text', text: 'one\n🙂\ntwo' },
      parseEmojisFunction: parser
    })

    const preservedText = Array.from(
      html.matchAll(/<span style="white-space: pre-wrap;">([\s\S]*?)<\/span>/g),
      (match) => match[1]
    )
    expect(preservedText).toEqual(parser === undefined ? ['one\n🙂\ntwo'] : ['one\n', '\ntwo'])
  })

  it.each([undefined, parseEmojisFunction])('keeps preview whitespace inherited with emoji parser %p', (parser) => {
    const { html } = viewer.render({
      node: { type: 'text', text: 'one\n🙂\ntwo' },
      preview: true,
      parseEmojisFunction: parser
    })

    expect(html).toContain('one\n')
    expect(html).toContain('\ntwo')
    expect(html).not.toContain('white-space')
  })

  it('continues to render explicit hard breaks as br elements', () => {
    expect(viewer.render({ node: { type: 'hardBreak' } }).html.trim()).toBe('<br>')
  })
})
