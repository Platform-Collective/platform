#!/usr/bin/env node

/**
 * Safe publish script that rejects older releases and skips already published versions.
 *
 * Usage:
 *   node safe-publish.js [--include <package-name>] [--check-types | --pack <dir>]
 *   node safe-publish.js --publish-packed <dir>
 *
 * Options:
 *   --include <name>  Only consider packages whose name includes <name>
 *   --check-types     Check packed declaration entry points without publishing
 *   --pack <dir>      Prepare and check tarballs for a separate publishing job
 *   --publish-packed <dir>  Publish prepared tarballs without installing or building
 */

const { execSync, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

/**
 * Read a package version from npm. Only a 404 means it is absent.
 */
function getRegistryVersion(packageName, version) {
  return new Promise((resolve, reject) => {
    const registryUrl = process.env.NPM_REGISTRY || 'https://registry.npmjs.org'
    const url = `${registryUrl}/${encodeURIComponent(packageName)}/${version}`

    const client = url.startsWith('https:') ? https : http

    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        if (res.statusCode === 404) {
          resolve(null)
        } else {
          reject(new Error(`Registry returned HTTP ${res.statusCode} for ${packageName}@${version}`))
        }
        return
      }

      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
      })
      res.on('error', reject)
      res.on('end', () => {
        try {
          const metadata = JSON.parse(body)
          if (typeof metadata.version !== 'string') {
            throw new Error(`Registry response has no version for ${packageName}@${version}`)
          }
          resolve(metadata.version)
        } catch (err) {
          reject(err)
        }
      })
    })

    req.on('error', reject)
    req.setTimeout(5000, () => {
      req.destroy(new Error(`Registry request timed out for ${packageName}@${version}`))
    })
  })
}

/**
 * Compare stable release versions. Reject unsupported versions rather than risking a downgrade.
 */
function compareVersions(version, latest) {
  const releasePattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
  if (!releasePattern.test(version) || !releasePattern.test(latest)) {
    throw new Error(`Expected major.minor.patch releases, got ${version} and ${latest}`)
  }
  const currentParts = version.split('.').map(Number)
  const latestParts = latest.split('.').map(Number)
  for (let i = 0; i < currentParts.length; i++) {
    if (currentParts[i] !== latestParts[i]) return currentParts[i] - latestParts[i]
  }
  return 0
}

/**
 * Get list of packages that should be published from rush
 */
function getPublishablePackages(includePattern) {
  try {
    const repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim()
    const output = execSync('node common/scripts/install-run-rush.js list -p --json', {
      encoding: 'utf-8',
      cwd: repoRoot
    })
    const lines = output.split('\n')
    let jsonStart = -1
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith('{')) {
        jsonStart = i
        break
      }
    }
    if (jsonStart === -1) {
      throw new Error('Could not find JSON output from rush list')
    }
    const config = JSON.parse(lines.slice(jsonStart).join('\n'))

    return config.projects.filter((project) => {
      // Check if package should be published according to rush.json
      const shouldPublish = project.shouldPublish === true

      // Skip if no package name
      if (!project.name) {
        return false
      }

      // If includePattern is specified, filter by it
      if (includePattern && !project.name.includes(includePattern)) {
        return false
      }

      if (!shouldPublish || !project.name.startsWith('@hcengineering/')) return false
      const manifest = JSON.parse(fs.readFileSync(path.join(project.fullPath, 'package.json'), 'utf8'))
      if (manifest.private === true) {
        console.log(`⊘ Skipping ${project.name} (private)`)
        return false
      }
      return true
    })
  } catch (err) {
    throw new Error(`Error getting package list: ${err.message}`)
  }
}

/**
 * Verify top-level and exported types entries are included in npm's pack file list.
 */
function checkPackedTypes(pkg, packed) {
  const manifest = JSON.parse(fs.readFileSync(path.join(pkg.fullPath, 'package.json'), 'utf8'))
  const entries = []
  function collectTypes(value) {
    if (value === null || typeof value !== 'object') return
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'types') entries.push(entry)
      else collectTypes(entry)
    }
  }
  if (manifest.types !== undefined) entries.push(manifest.types)
  collectTypes(manifest.exports)
  if (entries.length === 0) {
    console.log(`⊘ ${pkg.name}: no types entry declared`)
    return
  }
  if (entries.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
    throw new Error(`${pkg.name} has no declared types entry`)
  }
  if (packed === undefined) {
    const output = execSync('npm pack --dry-run --json --ignore-scripts', {
      cwd: pkg.fullPath,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit']
    })
    packed = JSON.parse(output)[0]
  }
  for (const entry of new Set(entries)) {
    const typesPath = entry.replace(/^\.\//, '')
    if (!packed.files.some((file) => file.path === typesPath)) {
      throw new Error(`${pkg.name}: declared types file ${entry} is missing from npm pack`)
    }
    console.log(`✓ ${pkg.name}: packed ${entry}`)
  }
}

/**
 * Normalize workspace: dependency ranges in package.json to plain semver
 * so that consumers without workspace support can install the package.
 * Set repository metadata to the publishing repository for GitHub provenance.
 * Returns the original package.json string so it can be restored.
 */
function normalizeWorkspaceDeps(packagePath) {
  const packageJsonPath = path.join(packagePath, 'package.json')
  let original = null

  try {
    original = fs.readFileSync(packageJsonPath, 'utf8')
    const pkg = JSON.parse(original)

    const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

    let changed = false
    for (const field of depFields) {
      const deps = pkg[field]
      if (!deps || typeof deps !== 'object') continue

      for (const [name, range] of Object.entries(deps)) {
        if (typeof range === 'string' && range.startsWith('workspace:')) {
          const normalized = range.replace(/^workspace:/, '')
          deps[name] = normalized
          changed = true
        }
      }
    }

    if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY) {
      pkg.repository = {
        type: 'git',
        url: `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git`,
        directory: path.relative(process.env.GITHUB_WORKSPACE, packagePath).split(path.sep).join('/')
      }
      changed = true
    }

    if (changed) {
      fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    }
  } catch (err) {
    throw new Error(`Could not prepare package.json for ${packagePath}: ${err.message}`)
  }

  return original
}

/**
 * Publish a single package
 */
function publishPackage(packagePath, packageName, tarball) {
  if (!tarball && JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8')).private === true) {
    console.log(`⊘ Skipping ${packageName} (private)`)
    return true
  }
  const originalPackageJson = tarball ? null : normalizeWorkspaceDeps(packagePath)

  try {
    if (!tarball) {
      try {
        execSync('npm pkg fix', { cwd: packagePath, encoding: 'utf-8', stdio: 'pipe' })
      } catch {
        // Ignore pkg fix errors (e.g. npm < 10)
      }
    }
    console.log(`Publishing ${packageName}...`)
    const withProvenance =
      process.env.GITHUB_ACTIONS === 'true' &&
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL &&
      process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    const options = {
      cwd: packagePath,
      stdio: 'inherit',
      encoding: 'utf-8'
    }
    if (tarball) {
      execFileSync('npm', ['publish', tarball, '--ignore-scripts', '--access', 'public',
        ...(withProvenance ? ['--provenance'] : [])], options)
    } else {
      execSync(withProvenance ? 'npm publish --provenance' : 'npm publish', options)
    }
    console.log(`✓ Successfully published ${packageName}`)
    return true
  } catch (err) {
    console.error(`✗ Failed to publish ${packageName}:`, err.message)
    return false
  } finally {
    if (originalPackageJson != null) {
      try {
        const packageJsonPath = path.join(packagePath, 'package.json')
        fs.writeFileSync(packageJsonPath, originalPackageJson, 'utf8')
      } catch (err) {
        console.warn(`Warning: could not restore original package.json for ${packagePath}: ${err.message}`)
      }
    }
  }
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2)
  let includePattern = null
  let checkTypes = false
  let packDirectory = null
  let publishDirectory = null

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--include' && i + 1 < args.length) {
      includePattern = args[i + 1]
      i++
    } else if (args[i] === '--check-types') {
      checkTypes = true
    } else if (args[i] === '--pack' && args[i + 1] && !args[i + 1].startsWith('--')) {
      packDirectory = path.resolve(args[++i])
    } else if (args[i] === '--publish-packed' && args[i + 1] && !args[i + 1].startsWith('--')) {
      publishDirectory = path.resolve(args[++i])
    } else {
      throw new Error(`Unknown or incomplete argument: ${args[i]}`)
    }
  }
  if ([checkTypes, packDirectory, publishDirectory].filter(Boolean).length > 1 || (publishDirectory && includePattern)) {
    throw new Error('Use only one of --check-types, --pack or --publish-packed')
  }

  console.log('Fetching publishable packages...')
  const packages = publishDirectory
    ? JSON.parse(fs.readFileSync(path.join(publishDirectory, 'packages.json'), 'utf8')).map((pkg) => {
      if (!pkg.name.startsWith('@hcengineering/') || path.basename(pkg.filename) !== pkg.filename ||
          !pkg.filename.endsWith('.tgz') || !fs.statSync(path.join(publishDirectory, pkg.filename)).isFile()) {
        throw new Error('Invalid packed package metadata')
      }
      return { ...pkg, tarball: path.join(publishDirectory, pkg.filename) }
    })
    : getPublishablePackages(includePattern)

  if (packages.length === 0) {
    throw new Error('No packages found to publish')
  }

  console.log(`Found ${packages.length} package(s) to check`)
  console.log('='.repeat(80))

  if (checkTypes) {
    for (const pkg of packages) checkPackedTypes(pkg)
    return
  }

  if (packDirectory) {
    fs.mkdirSync(packDirectory, { recursive: true })
    const packedPackages = []
    for (const pkg of packages) {
      const original = normalizeWorkspaceDeps(pkg.fullPath)
      try {
        const [packed] = JSON.parse(execFileSync('npm', [
          'pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory
        ], { cwd: pkg.fullPath, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }))
        checkPackedTypes(pkg, packed)
        packedPackages.push({ name: packed.name, version: packed.version, filename: packed.filename })
      } finally {
        fs.writeFileSync(path.join(pkg.fullPath, 'package.json'), original, 'utf8')
      }
    }
    fs.writeFileSync(path.join(packDirectory, 'packages.json'), JSON.stringify(packedPackages, null, 2) + '\n')
    return
  }

  let published = 0
  let skipped = 0
  let failed = 0
  const pending = []

  // Complete every registry/version check before publishing the first package.
  for (const pkg of packages) {
    const packageName = pkg.name
    const version = pkg.version

    console.log(`\nChecking ${packageName}@${version}...`)
    compareVersions(version, version)

    const latest = await getRegistryVersion(packageName, 'latest')
    if (latest !== null && compareVersions(version, latest) < 0) {
      throw new Error(`${packageName}@${version} is lower than registry latest ${latest}; bump the release version`)
    }
    const exists = latest === version || (await getRegistryVersion(packageName, version)) !== null

    if (exists) {
      console.log(`⊘ Skipping ${packageName}@${version} (already published)`)
      skipped++
    } else {
      pending.push(pkg)
    }
  }

  for (const pkg of pending) {
    const success = publishPackage(pkg.fullPath, pkg.name, pkg.tarball)
    if (success) {
      published++
    } else {
      failed++
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('Summary:')
  console.log(`  Published: ${published}`)
  console.log(`  Skipped:   ${skipped}`)
  console.log(`  Failed:    ${failed}`)
  console.log('='.repeat(80))

  if (failed > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
