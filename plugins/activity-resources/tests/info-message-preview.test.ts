// SPDX-License-Identifier: EPL-2.0

import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'vm'
import { compile, preprocess } from 'svelte/compiler'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

const languages: Record<string, Record<string, string>> = {
  en: require('../../card-assets/lang/en.json').string,
  de: require('../../card-assets/lang/de.json').string
}

it.each(['en', 'de'])(
  'preserves existing section info-message parameters in the %s Inbox preview',
  async (language) => {
    const filename = join(__dirname, '../src/components/activity-info-message/ActivityInfoMessagePreview.svelte')
    const source = await preprocess(readFileSync(filename, 'utf8'), {
      script: ({ content }) => ({
        code: transpileModule(content, {
          compilerOptions: { target: ScriptTarget.ESNext, module: ModuleKind.ESNext, verbatimModuleSyntax: true }
        }).outputText
      })
    })
    const code = transpileModule(compile(source.code, { filename, generate: 'ssr' }).js.code, {
      compilerOptions: { module: ModuleKind.CommonJS, esModuleInterop: true }
    }).outputText
    const viewed: Array<{ value: string, preview: boolean }> = []
    const translateCB = jest.fn(
      (key: string, props: Record<string, string>, locale: string, callback: (text: string) => void) => {
        const name = key.slice(key.lastIndexOf(':') + 1)
        let text = languages[locale][name]
        if (text === undefined) throw new Error(`Missing actual translation: ${key}`)
        for (const [name, value] of Object.entries(props ?? {})) text = text.split(`{${name}}`).join(value)
        callback(text)
      }
    )
    const dependencies: Record<string, unknown> = {
      'svelte/internal': {
        create_ssr_component: (render: (result: object, props: object, bindings: object, slots: object) => string) => ({
          render: (props: object) => ({ html: render({}, props, {}, {}) })
        }),
        validate_component: (component: unknown) => component,
        validate_store: () => {},
        subscribe: (
          store: { subscribe: (callback: (value: { language: string }) => void) => () => void },
          callback: (value: { language: string }) => void
        ) => store.subscribe(callback)
      },
      '@hcengineering/activity': {},
      '@hcengineering/platform': { translateCB },
      '@hcengineering/ui': {
        themeStore: {
          subscribe: (callback: (value: { language: string }) => void) => {
            callback({ language })
            return () => {}
          }
        }
      },
      '@hcengineering/presentation': {
        HTMLViewer: {
          $$render: (_result: unknown, props: { value: string, preview: boolean }) => {
            viewed.push(props)
            return props.value
          }
        }
      },
      '../activity-message/BaseMessagePreview.svelte': {
        $$render: (
          _result: unknown,
          props: { intlLabel?: string },
          _bindings: unknown,
          slots: { default?: (scope: object) => string }
        ) => {
          if (slots.default !== undefined) return slots.default({})
          return props.intlLabel === undefined ? '' : languages[language][props.intlLabel.split(':').pop() ?? '']
        }
      }
    }
    const exports: { default?: { render: (props: object) => { html: string } } } = {}
    runInNewContext(code, {
      exports,
      require: (id: string) => {
        if (!(id in dependencies)) throw new Error(`Unexpected preview dependency: ${id}`)
        return dependencies[id]
      }
    })
    for (const name of ['SectionLocked', 'SectionUnlocked']) {
      const value = { message: `card:string:${name}`, props: { section: 'Overview' } }
      const html = exports.default?.render({ value }).html
      const expected = languages[language][name].split('{section}').join('Overview')
      expect(translateCB).toHaveBeenLastCalledWith(value.message, value.props, language, expect.any(Function))
      expect(viewed[viewed.length - 1]).toEqual({ value: expected, preview: true })
      expect(html?.trim()).toBe(expected)
      expect(html).not.toContain('{section}')
    }
  }
)
