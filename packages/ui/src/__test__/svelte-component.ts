// SPDX-License-Identifier: EPL-2.0
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { compile } from 'svelte/compiler'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'

export interface MountedComponent {
  $destroy: () => void
  $set: (props: Record<string, unknown>) => void
  $on: (event: string, callback: (event: CustomEvent) => void) => void
  getAside?: () => string | boolean
  setAside?: (value: string | boolean) => void
}
export type ComponentConstructor = new (options: {
  target: HTMLElement
  props?: Record<string, unknown>
}) => MountedComponent

/** Compile components with one browser runtime and explicit service substitutes. */
export function componentRuntime (): {
  modules: Map<string, unknown>
  load: (filename: string) => Record<string, unknown>
  evaluate: (source: string, filename: string) => Record<string, unknown>
  tick: () => Promise<void>
} {
  const cache = new Map<string, { exports: Record<string, unknown> }>()
  const modules = new Map<string, unknown>()
  const runtime = resolve(dirname(require.resolve('svelte/package.json')), 'src/runtime')
  const options = { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 }
  function evaluate (source: string, filename: string): Record<string, unknown> {
    const module = { exports: {} }
    cache.set(filename, module)
    if (filename.endsWith('.svelte')) {
      source = source.replace(
        /<script lang="ts">([\s\S]*?)<\/script>/,
        (_, script: string) =>
          `<script>${
            transpileModule(script, {
              compilerOptions: {
                ...options,
                module: ModuleKind.ESNext,
                verbatimModuleSyntax: true
              }
            }).outputText
          }</script>`
      )
      source = source.replace(/<style[\s\S]*?<\/style>/g, '')
      source = compile(source, { filename, generate: 'dom', css: 'external' }).js.code
    }
    const localRequire = (id: string): unknown => {
      if (id.endsWith('/disclose-version')) return {}
      if (id === 'svelte' || id.startsWith('svelte/')) {
        return load(resolve(runtime, id === 'svelte' ? 'index.js' : `${id.slice(7)}/index.js`))
      }
      if (modules.has(id)) return modules.get(id)
      const path = resolve(dirname(filename), id)
      if (modules.has(path)) return modules.get(path)
      return load(/\.(svelte|[jt]s)$/.test(path) ? path : `${path}.ts`)
    }
    // eslint-disable-next-line no-new-func, @typescript-eslint/no-implied-eval
    new Function('require', 'module', 'exports', transpileModule(source, { compilerOptions: options }).outputText)(
      localRequire,
      module,
      module.exports
    )
    return module.exports
  }
  function load (filename: string): Record<string, unknown> {
    return cache.get(filename)?.exports ?? evaluate(readFileSync(filename, 'utf8'), filename)
  }
  return { modules, load, evaluate, tick: (load(resolve(runtime, 'index.js')) as { tick: () => Promise<void> }).tick }
}
