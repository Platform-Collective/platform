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

    // Compile the real components. Styles do not affect the image URL assertions; scripts
    // need TypeScript erasure before Svelte compiles their DOM implementation.
    const input = source
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/g, (tag, script) => {
        const code = transpileModule(script, {
          compilerOptions: {
            module: ModuleKind.ESNext,
            target: ScriptTarget.ES2022,
            // Svelte templates also reference imports; TypeScript sees only the script.
            verbatimModuleSyntax: true
          }
        }).outputText
        return `<script${tag.includes('context="module"') ? ' context="module"' : ''}>${code}</script>`
      })
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
    const { js } = compile(input, { filename, generate: 'dom', css: 'external' })
    return { code: transpile(js.code) }
  }
}
