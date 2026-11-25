// SPDX-License-Identifier: EPL-2.0

const fs = require('fs')
const http = require('http')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const scriptsDirectory = __dirname
let fixture
let registry
let registryUrl

function writeExecutable(name, source) {
  const filename = path.join(fixture, 'bin', name)
  fs.mkdirSync(path.dirname(filename), { recursive: true })
  fs.writeFileSync(filename, `#!${process.execPath}\n${source}`)
  fs.chmodSync(filename, 0o755)
}

function addPackage(name, manifest = {}) {
  const fullPath = path.join(fixture, name.replace(/^@/, '').replace('/', '-'))
  fs.mkdirSync(fullPath, { recursive: true })
  fs.writeFileSync(
    path.join(fullPath, 'package.json'),
    JSON.stringify(
      {
        name,
        version: '1.0.0',
        types: 'index.d.ts',
        ...manifest
      },
      null,
      2
    )
  )
  return { name, version: '1.0.0', fullPath, shouldPublish: true }
}

async function runScript(script, args, projects = [], extraEnv = {}) {
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(scriptsDirectory, script), ...args], {
      cwd: fixture,
      env: {
        ...process.env,
        PATH: `${path.join(fixture, 'bin')}${path.delimiter}${process.env.PATH}`,
        NPM_REGISTRY: registryUrl,
        RUSH_PROJECTS: JSON.stringify(projects),
        CALL_LOG: path.join(fixture, 'calls.jsonl'),
        PACKED_MANIFEST: path.join(fixture, 'packed-package.json'),
        ...extraEnv
      }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function publishedFiles() {
  const log = path.join(fixture, 'calls.jsonl')
  if (!fs.existsSync(log)) return []
  return fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((args) => args[0] === 'publish')
    .map((args) => path.basename(args[1]))
}

beforeEach(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'release-scripts-'))
  writeExecutable('git', 'console.log(process.env.FIXTURE_ROOT)\n')
  writeExecutable(
    'node',
    `
    if (process.argv[2].endsWith('install-run-rush.js')) {
      console.log(JSON.stringify({ projects: JSON.parse(process.env.RUSH_PROJECTS) }))
    } else {
      const result = require('child_process').spawnSync(process.execPath, process.argv.slice(2), { stdio: 'inherit' })
      process.exit(result.status ?? 1)
    }
  `
  )
  writeExecutable(
    'npm',
    `
    const fs = require('fs')
    const path = require('path')
    const args = process.argv.slice(2)
    fs.appendFileSync(process.env.CALL_LOG, JSON.stringify(args) + '\\n')
    if (args[0] === 'pack') {
      const manifest = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
      if (manifest.peerDependencies) {
        fs.copyFileSync(path.join(process.cwd(), 'package.json'), process.env.PACKED_MANIFEST)
      }
      console.log(JSON.stringify([{
        name: manifest.name,
        version: manifest.version,
        filename: manifest.name.replace(/^@/, '').replace('/', '-') + '-' + manifest.version + '.tgz',
        files: [{ path: 'index.d.ts' }]
      }]))
    } else if (args[0] === 'publish' && args[1].includes(process.env.FAIL_PUBLISH || '\0')) {
      process.exit(1)
    }
  `
  )
  registry = http.createServer((request, response) => {
    response.writeHead(404).end()
  })
  await new Promise((resolve) => registry.listen(0, '127.0.0.1', resolve))
  registryUrl = `http://127.0.0.1:${registry.address().port}`
})

afterEach(async () => {
  await new Promise((resolve) => registry.close(resolve))
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('packing keeps the source scope and normalizes peer ranges without aliases', async () => {
  const projects = [
    addPackage('@hcengineering/core', {
      peerDependencies: { '@hcengineering/platform': 'workspace:^1.0.0' }
    }),
    addPackage('@hcengineering/platform')
  ]

  const result = await runScript('safe-publish.js', ['--pack', path.join(fixture, 'packed')], projects, {
    FIXTURE_ROOT: fixture
  })

  expect(result.status).toBe(0)
  const packed = JSON.parse(fs.readFileSync(path.join(fixture, 'packed-package.json'), 'utf8'))
  expect(packed.name).toBe('@hcengineering/core')
  expect(packed.peerDependencies['@hcengineering/platform']).toBe('^1.0.0')
})

test('packed publishing follows dependency order', async () => {
  const packed = path.join(fixture, 'packed')
  fs.mkdirSync(packed)
  const packages = [
    { name: '@hcengineering/app', dependencies: ['@hcengineering/core'] },
    { name: '@hcengineering/core', dependencies: ['@hcengineering/platform'] },
    { name: '@hcengineering/platform', dependencies: [] }
  ]
  fs.writeFileSync(
    path.join(packed, 'packages.json'),
    JSON.stringify(
      packages.map((pkg) => ({
        ...pkg,
        version: '1.0.0',
        filename: `${pkg.name.slice(15)}-1.0.0.tgz`
      }))
    )
  )
  for (const pkg of packages) fs.writeFileSync(path.join(packed, `${pkg.name.slice(15)}-1.0.0.tgz`), '')

  const result = await runScript('safe-publish.js', ['--publish-packed', packed])

  expect(result.status).toBe(0)
  expect(publishedFiles()).toEqual(['platform-1.0.0.tgz', 'core-1.0.0.tgz', 'app-1.0.0.tgz'])
})

test('a failed packed publish prints its resume command and stops dependents', async () => {
  const packed = path.join(fixture, 'packed')
  fs.mkdirSync(packed)
  const packages = [
    { name: '@hcengineering/core', dependencies: [] },
    { name: '@hcengineering/app', dependencies: ['@hcengineering/core'] }
  ]
  fs.writeFileSync(
    path.join(packed, 'packages.json'),
    JSON.stringify(
      packages.map((pkg) => ({
        ...pkg,
        version: '1.0.0',
        filename: `${pkg.name.slice(15)}-1.0.0.tgz`
      }))
    )
  )
  for (const pkg of packages) fs.writeFileSync(path.join(packed, `${pkg.name.slice(15)}-1.0.0.tgz`), '')

  const result = await runScript('safe-publish.js', ['--publish-packed', packed], [], {
    FAIL_PUBLISH: 'core-1.0.0.tgz'
  })

  expect(result.status).toBe(1)
  expect(result.stderr).toContain(`Resume with: node common/scripts/safe-publish.js --publish-packed "${packed}"`)
  expect(publishedFiles()).toEqual(['core-1.0.0.tgz'])
})

test('environment validation requires reviewers and the v* tag policy', async () => {
  const environment = path.join(fixture, 'environment.json')
  const policies = path.join(fixture, 'policies.json')
  fs.writeFileSync(
    environment,
    JSON.stringify({
      protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }]
    })
  )
  fs.writeFileSync(policies, JSON.stringify({ branch_policies: [{ name: 'v*' }] }))

  expect((await runScript('safe-publish.js', ['--check-environment', environment, policies])).status).toBe(0)
  fs.writeFileSync(environment, JSON.stringify({ protection_rules: [] }))
  expect((await runScript('safe-publish.js', ['--check-environment', environment, policies])).status).toBe(1)
  fs.writeFileSync(
    environment,
    JSON.stringify({
      protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User' }] }]
    })
  )
  fs.writeFileSync(policies, JSON.stringify({ branch_policies: [{ name: 'develop', type: 'branch' }] }))
  expect((await runScript('safe-publish.js', ['--check-environment', environment, policies])).status).toBe(1)
})

test('bump checks only packages inside the exact source scope', async () => {
  const projects = [addPackage('@hcengineering/core'), addPackage('@hcengineering-extra/ignored', { version: '0.0.1' })]

  const result = await runScript('bump.js', ['--check', '1.0.0'], projects, { FIXTURE_ROOT: fixture })

  expect(result.status).toBe(0)
})
