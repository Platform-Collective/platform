// SPDX-License-Identifier: EPL-2.0

const { compile } = require('svelte/compiler')
const ts = require('typescript')

// Compile the tested components and Svelte's ESM runtime for Jest's CommonJS execution.
module.exports = {
  process (source, filename) {
    let code = source
    if (filename.endsWith('.svelte')) {
      // These handler/query tests do not assert CSS. Omit styles so SCSS-only parents can mount too.
      const javascript = source
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '')
        .replace(/<script lang="ts">([\s\S]*?)<\/script>/g, (_, script) => {
          const result = ts.transpileModule(script, {
            compilerOptions: {
              target: ts.ScriptTarget.ES2020,
              module: ts.ModuleKind.ESNext,
              verbatimModuleSyntax: true
            }
          })
          return `<script>${result.outputText}</script>`
        })
      code = compile(javascript, { filename, generate: 'dom', dev: true }).js.code
    }
    return {
      code: ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, allowJs: true }
      }).outputText
    }
  }
}
