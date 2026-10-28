// SPDX-License-Identifier: EPL-2.0

const { compile, preprocess } = require('svelte/compiler')
const sveltePreprocess = require('svelte-preprocess')
const ts = require('typescript')

async function transform () {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const filename = process.argv[2]
  const prepared = await preprocess(Buffer.concat(chunks).toString(), [
    // These DOM tests do not assert layout; omit styles without parsing component source.
    { style: () => ({ code: '' }) },
    sveltePreprocess({ typescript: { tsconfigFile: false, compilerOptions: { verbatimModuleSyntax: true } } })
  ], { filename })
  const compiled = compile(prepared.code, { filename, generate: 'dom', css: 'external' })
  const output = ts.transpileModule(compiled.js.code, {
    fileName: filename + '.js',
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  })
  process.stdout.write(output.outputText)
}

transform().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
