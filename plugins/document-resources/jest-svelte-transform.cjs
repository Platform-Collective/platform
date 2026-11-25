// SPDX-License-Identifier: EPL-2.0

const { execFileSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { compile, preprocess } = require('svelte/compiler')
const { preprocess: preprocessor } = require('./svelte.config')
const ts = require('typescript')

if (require.main === module) {
  const filename = process.argv[2]
  void preprocess(readFileSync(filename, 'utf8'), preprocessor, { filename })
    .then(({ code }) => {
      process.stdout.write(compile(code, { filename, generate: 'dom', css: 'external' }).js.code)
    })
    .catch((error) => {
      console.error(error)
      process.exitCode = 1
    })
}

module.exports = {
  process(source, filename) {
    // Jest loads CommonJS synchronously, while the Svelte preprocessor is asynchronous.
    const code = filename.endsWith('.svelte')
      ? execFileSync(process.execPath, [__filename, filename], { encoding: 'utf8', timeout: 30000 })
      : source

    return {
      code: ts.transpileModule(code, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
      }).outputText
    }
  }
}
