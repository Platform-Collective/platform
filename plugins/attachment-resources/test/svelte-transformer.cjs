// SPDX-License-Identifier: EPL-2.0

const { compile } = require('svelte/compiler')
const { transpileModule, ModuleKind, ScriptTarget } = require('typescript')

function transpile (source) {
  return transpileModule(source, {
    compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 }
  }).outputText
}

module.exports = {
  process (source, filename) {
    if (!filename.endsWith('.svelte')) return { code: transpile(source) }

    const input = source
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, (_, script) => {
        const code = transpileModule(script, {
          compilerOptions: {
            module: ModuleKind.ESNext,
            target: ScriptTarget.ES2022,
            verbatimModuleSyntax: true
          }
        }).outputText
        return `<script>${code}</script>`
      })
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    const { js } = compile(input, { filename, generate: 'dom', css: 'external' })
    return { code: transpile(js.code) }
  }
}
