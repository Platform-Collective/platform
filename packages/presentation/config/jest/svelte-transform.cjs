// SPDX-License-Identifier: EPL-2.0

const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

module.exports = {
  process (source, filename) {
    // Jest requires a synchronous transform for imports; Svelte preprocessing is asynchronous.
    const result = spawnSync(process.execPath, [join(__dirname, 'svelte-transform-worker.cjs'), filename], {
      input: source,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024
    })
    if (result.error !== undefined) throw result.error
    if (result.status !== 0) throw new Error(`Svelte transform failed for ${filename}: ${result.stderr}`)
    return { code: result.stdout }
  }
}
