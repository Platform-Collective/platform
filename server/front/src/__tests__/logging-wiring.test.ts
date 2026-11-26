// SPDX-License-Identifier: EPL-2.0
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { runInNewContext } from 'vm'
import { transpileModule, ModuleKind } from 'typescript'
import express from 'express'
import morgan from 'morgan'
import { request } from 'http'
const root = resolve(__dirname, '../../../..')
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8')
it.each([
  'server/front/src/index.ts',
  'pods/server/src/server_http.ts',
  'pods/preview/src/server.ts',
  'pods/link-preview/src/server.ts',
  'services/backup/backup-api-pod/src/server.ts',
  'services/billing/pod-billing/src/server.ts',
  'services/datalake/pod-datalake/src/server.ts',
  'services/payment/pod-payment/src/server.ts',
  'services/rekoni/src/server.ts'
])('uses token-free request logging: %s', (path) => {
  const text = source(path)
  expect(text.includes("morgan('short'")).toBe(false)
  expect(text.includes('safeRequestLog')).toBe(true)
  expect(/morgan\(\s*(?!\s|\(_tokens\b)/.test(text)).toBe(false)
})
it.each([
  ['server/front/src/starter.ts', /console.log\('Starting Front service with', config\)/],
  ['services/ai-bot/love-agent/src/start.ts', /console.log\('Starting love worker', config\)/],
  ['pods/stats/src/stats.ts', /console.error\(err, req.host, req.headers, req.ip\)/],
  ['models/calendar/src/migration.ts', /\{ secret, error: err \}/],
  ['foundations/server/packages/kafka/src/index.ts', /message: 'Using queue', config/]
])('does not dump credential-bearing structures: %s', (path, pattern) => {
  expect(pattern.test(source(path))).toBe(false)
})

it('does not log raw error/fallback request URLs', () => {
  expect(source('services/rekoni/src/server.ts').includes('{ url: _req.url }')).toBe(false)
  expect(source('pods/link-preview/src/server.ts').includes('url, err }')).toBe(false)
})

it('love-agent startup never passes credential config to console', async () => {
  const canary = 'synthetic-worker-credential'
  const calls: unknown[][] = []
  const exports: { start?: () => Promise<void> } = {}
  const script = transpileModule(source('services/ai-bot/love-agent/src/start.ts'), {
    compilerOptions: { module: ModuleKind.CommonJS }
  }).outputText
  runInNewContext(script, {
    exports,
    require: (name: string) =>
      name === './config.js'
        ? { default: { DeepgramApiKey: canary, OpenaiApiKey: canary, PlatformToken: canary } }
        : { runAgent: () => {} },
    console: { log: (...args: unknown[]) => calls.push(args) },
    process: { on: () => {} }
  })
  await exports.start?.()
  expect(calls.length).toBe(1)
  expect(JSON.stringify(calls).includes(canary)).toBe(false)
})

it.each(['server/front/src/index.ts', 'pods/server/src/server_http.ts'])(
  'real request keeps duration and size without credentials: %s',
  async (path) => {
    const canary = 'synthetic-request-credential'
    const exports = {}
    runInNewContext(
      transpileModule(source('foundations/core/packages/core/src/logging.ts'), {
        compilerOptions: { module: ModuleKind.CommonJS }
      }).outputText,
      { exports }
    )
    const expression = source(path).match(
      /morgan\(\s*(\(_tokens,\s*req,\s*res\)\s*=>\s*JSON\.stringify\(\s*safeRequestLog\([\s\S]*?\)\s*\))\s*,\s*\{\s*stream:/
    )?.[1]
    expect(typeof expression === 'string').toBe(true)
    const formatter = runInNewContext('(' + expression + ')', exports) as morgan.FormatFn
    let finish: (text: string) => void = () => {}
    const logged = new Promise<string>((resolve) => {
      finish = resolve
    })
    const app = express()
    app.use(morgan(formatter, { stream: { write: finish } }))
    app.use((_req, res) => {
      res.send('safe response')
    })
    const server = app.listen(0, '127.0.0.1')
    try {
      await new Promise<void>((resolve) => {
        server.on('listening', resolve)
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('missing test listener')
      await new Promise<void>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: address.port,
            path: '/_transactor/' + canary + '?token=' + canary,
            headers: { Authorization: 'Bearer ' + canary, Cookie: 'session=' + canary }
          },
          (res) => {
            res.resume()
            res.on('end', resolve)
          }
        )
        req.on('error', reject)
        req.end()
      })
      const text = await logged
      expect(text.includes(canary)).toBe(false)
      const record = JSON.parse(text)
      expect(record.route).toBe('transactor')
      expect(record.status).toBe(200)
      expect(typeof record.duration === 'number' && record.duration >= 0).toBe(true)
      expect(record.bytes).toBe(13)
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err !== undefined) reject(err)
          else resolve()
        })
      })
    }
  }
)
