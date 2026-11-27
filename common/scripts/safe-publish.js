#!/usr/bin/env node

/**
 * Safe publish script that rejects older releases and skips already published versions.
 *
 * Packages are developed under the source scope and published under the npm scope, both set in
 * common/config/npm-publish.json. Dependencies on other published packages keep their source names as npm
 * aliases (for example "@hcengineering/core": "npm:@platformcollective/core@^0.7.433"), so the published code,
 * which imports the source names, resolves them unchanged.
 *
 * Usage:
 *   node safe-publish.js [--include <package-name>] [--check-types | --pack <dir>]
 *   node safe-publish.js --publish-packed <dir>
 *   node safe-publish.js --check-version <version>
 *   node safe-publish.js --check-environment <environment.json> <policies.json>
 *
 * Options:
 *   --include <name>  Only consider packages whose name includes <name>
 *   --check-types     Check packed declaration entry points without publishing
 *   --pack <dir>      Prepare and check tarballs for a separate publishing job
 *   --publish-packed <dir>  Publish prepared tarballs without installing or building
 *   --check-version <version>  Require a release above the configured baseline and every registry latest
 *   --check-environment  Verify reviewers and v* tag deployment rules
 */

const { execSync, execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const CONFIG_FILE = path.join(__dirname, '..', 'config', 'npm-publish.json')
const RELEASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

function loadConfig() {
  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  const scopePattern = /^@[a-z0-9][a-z0-9._-]*\/$/
  if (!scopePattern.test(config.sourceScope ?? '') || !scopePattern.test(config.npmScope ?? '')) {
    throw new Error(`${CONFIG_FILE}: sourceScope and npmScope must look like "@scope/"`)
  }
  if (!RELEASE_PATTERN.test(config.baselineVersion ?? '')) {
    throw new Error(`${CONFIG_FILE}: baselineVersion must be a major.minor.patch release`)
  }
  return config
}

const { sourceScope: SOURCE_SCOPE, npmScope: NPM_SCOPE, baselineVersion: BASELINE_VERSION } = loadConfig()

/**
 * Name under which a package is published on npm.
 */
function publishedName(name) {
  if (name.startsWith(NPM_SCOPE)) return name
  if (!name.startsWith(SOURCE_SCOPE)) throw new Error(`Unexpected package name ${name}`)
  return NPM_SCOPE + name.slice(SOURCE_SCOPE.length)
}

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
  if (!RELEASE_PATTERN.test(version) || !RELEASE_PATTERN.test(latest)) {
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

      if (!shouldPublish || !project.name.startsWith(SOURCE_SCOPE)) return false
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
 * Rename the package to the npm scope, and point dependencies on other published
 * packages to that scope through npm aliases that keep their source names.
 * Set repository metadata to the publishing repository for GitHub provenance.
 * Returns the original package.json string so it can be restored.
 */
function normalizeWorkspaceDeps(packagePath, publishedSourceNames) {
  const packageJsonPath = path.join(packagePath, 'package.json')
  let original = null

  try {
    original = fs.readFileSync(packageJsonPath, 'utf8')
    const pkg = JSON.parse(original)

    const depFields = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']

    pkg.name = publishedName(pkg.name)
    for (const field of depFields) {
      const deps = pkg[field]
      if (!deps || typeof deps !== 'object') continue

      for (const [name, range] of Object.entries(deps)) {
        if (typeof range !== 'string') continue
        const normalized = range.replace(/^workspace:/, '')
        if (publishedSourceNames.has(name)) {
          deps[name] = `npm:${publishedName(name)}@${normalized}`
        } else if (name.startsWith(SOURCE_SCOPE) && field !== 'devDependencies') {
          // Consumers would otherwise install the upstream package of that name.
          throw new Error(`${name} is not published, so ${pkg.name} cannot depend on it`)
        } else {
          deps[name] = normalized
        }
      }
    }

    if (process.env.GITHUB_ACTIONS === 'true' && process.env.GITHUB_REPOSITORY) {
      pkg.repository = {
        type: 'git',
        url: `git+https://github.com/${process.env.GITHUB_REPOSITORY}.git`,
        directory: path.relative(process.env.GITHUB_WORKSPACE, packagePath).split(path.sep).join('/')
      }
    }

    fs.writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  } catch (err) {
    throw new Error(`Could not prepare package.json for ${packagePath}: ${err.message}`)
  }

  return original
}

/**
 * Publish a single package
 */
function publishPackage(packagePath, packageName, tarball, publishedSourceNames) {
  if (!tarball && JSON.parse(fs.readFileSync(path.join(packagePath, 'package.json'), 'utf8')).private === true) {
    console.log(`⊘ Skipping ${packageName} (private)`)
    return true
  }
  const originalPackageJson = tarball ? null : normalizeWorkspaceDeps(packagePath, publishedSourceNames)

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
      execFileSync(
        'npm',
        ['publish', tarball, '--ignore-scripts', '--access', 'public', ...(withProvenance ? ['--provenance'] : [])],
        options
      )
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
 * Return internal runtime dependencies that are part of this release.
 */
function getInternalDependencies(pkg, packageNames) {
  if (Array.isArray(pkg.dependencies)) {
    return pkg.dependencies.filter((name) => packageNames.has(name))
  }
  if (!pkg.fullPath) return []
  const manifest = JSON.parse(fs.readFileSync(path.join(pkg.fullPath, 'package.json'), 'utf8'))
  return Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies }).filter((name) =>
    packageNames.has(name)
  )
}

/**
 * Sort packages so internal dependencies are published before their dependents.
 */
function sortPackagesByDependencies(packages) {
  const packageNames = new Set(packages.map((pkg) => pkg.name))
  const packagesByName = new Map(packages.map((pkg) => [pkg.name, pkg]))
  const ordered = []
  const visiting = new Set()
  const visited = new Set()

  function visit(pkg) {
    if (visited.has(pkg.name) || visiting.has(pkg.name)) return
    visiting.add(pkg.name)
    for (const name of getInternalDependencies(pkg, packageNames)) {
      visit(packagesByName.get(name))
    }
    visiting.delete(pkg.name)
    visited.add(pkg.name)
    ordered.push(pkg)
  }

  for (const pkg of packages) visit(pkg)
  return ordered
}

/**
 * Verify that npm publishing cannot use an automatically created, unprotected environment.
 */
function checkPublishEnvironment(environmentFile, policiesFile) {
  const environment = JSON.parse(fs.readFileSync(environmentFile, 'utf8'))
  const hasReviewers = environment.protection_rules?.some(
    (rule) => rule.type === 'required_reviewers' && Array.isArray(rule.reviewers) && rule.reviewers.length > 0
  )
  if (!hasReviewers) {
    throw new Error('The npm-publish environment must exist and have required reviewers')
  }

  const policyPages = JSON.parse(fs.readFileSync(policiesFile, 'utf8'))
  const policies = (Array.isArray(policyPages) ? policyPages : [policyPages]).flatMap(
    (page) => page.branch_policies ?? []
  )
  const hasTagPolicy = policies.some((policy) => policy.name === 'v*' && policy.type === 'tag')
  if (!hasTagPolicy) {
    throw new Error('The npm-publish environment must restrict deployments to v* tags')
  }
}

/**
 * Require a release above the configured baseline that does not go below any package's registry latest.
 * A version equal to the highest registry latest is accepted so a partially published release can be resumed.
 */
async function checkReleaseVersion(version, packages) {
  if (!RELEASE_PATTERN.test(version)) {
    throw new Error(`Expected a major.minor.patch release, got ${version}`)
  }
  if (compareVersions(version, BASELINE_VERSION) <= 0) {
    throw new Error(`The release version must be greater than ${BASELINE_VERSION} (baselineVersion in ${CONFIG_FILE})`)
  }

  let highest = null
  const names = packages.map((pkg) => publishedName(pkg.name))
  for (let i = 0; i < names.length; i += 16) {
    const batch = names.slice(i, i + 16)
    const latest = await Promise.all(batch.map((name) => getRegistryVersion(name, 'latest')))
    batch.forEach((name, index) => {
      if (latest[index] !== null && (highest === null || compareVersions(latest[index], highest.version) > 0)) {
        highest = { name, version: latest[index] }
      }
    })
  }
  if (highest !== null && compareVersions(version, highest.version) < 0) {
    throw new Error(`The release version ${version} is lower than ${highest.name}@${highest.version} on the registry`)
  }
  console.log(
    `✓ ${version} is above ${BASELINE_VERSION}` +
      (highest === null ? ` (no ${NPM_SCOPE}* package on the registry yet)` : ` and not below ${highest.name}@${highest.version}`)
  )
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
  let environmentFiles = null
  let releaseVersion = null

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
    } else if (args[i] === '--check-environment' && i + 2 < args.length) {
      environmentFiles = [path.resolve(args[++i]), path.resolve(args[++i])]
    } else if (args[i] === '--check-version' && args[i + 1] && !args[i + 1].startsWith('--')) {
      releaseVersion = args[++i]
    } else {
      throw new Error(`Unknown or incomplete argument: ${args[i]}`)
    }
  }
  const modes = [checkTypes, packDirectory, publishDirectory, environmentFiles, releaseVersion]
  if (
    modes.filter(Boolean).length > 1 ||
    ((publishDirectory || environmentFiles || releaseVersion) && includePattern)
  ) {
    throw new Error('Use only one of --check-types, --pack, --publish-packed, --check-version or --check-environment')
  }
  if (environmentFiles) {
    checkPublishEnvironment(...environmentFiles)
    console.log('✓ The npm-publish environment is protected')
    return
  }

  console.log('Fetching publishable packages...')
  if (releaseVersion) {
    await checkReleaseVersion(releaseVersion, getPublishablePackages(null))
    return
  }
  const packages = sortPackagesByDependencies(
    publishDirectory
      ? JSON.parse(fs.readFileSync(path.join(publishDirectory, 'packages.json'), 'utf8')).map((pkg) => {
          if (
            !pkg.name.startsWith(NPM_SCOPE) ||
            path.basename(pkg.filename) !== pkg.filename ||
            !pkg.filename.endsWith('.tgz') ||
            !fs.statSync(path.join(publishDirectory, pkg.filename)).isFile()
          ) {
            throw new Error('Invalid packed package metadata')
          }
          return { ...pkg, tarball: path.join(publishDirectory, pkg.filename) }
        })
      : getPublishablePackages(includePattern)
  )

  if (packages.length === 0) {
    throw new Error('No packages found to publish')
  }
  const packageNames = new Set(packages.map((pkg) => pkg.name))
  // Dependencies on these packages become npm aliases. Use all publishable packages, also with --include,
  // since a release publishes all of them.
  const publishedSourceNames = publishDirectory
    ? new Set()
    : includePattern
      ? new Set(getPublishablePackages(null).map((pkg) => pkg.name))
      : packageNames

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
      const original = normalizeWorkspaceDeps(pkg.fullPath, publishedSourceNames)
      try {
        const [packed] = JSON.parse(
          execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packDirectory], {
            cwd: pkg.fullPath,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'inherit']
          })
        )
        checkPackedTypes(pkg, packed)
        packedPackages.push({
          name: packed.name,
          version: packed.version,
          filename: packed.filename,
          dependencies: getInternalDependencies(pkg, packageNames).map(publishedName)
        })
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
    const packageName = publishedName(pkg.name)
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
    const success = publishPackage(pkg.fullPath, publishedName(pkg.name), pkg.tarball, publishedSourceNames)
    if (success) {
      published++
    } else {
      failed++
      break
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('Summary:')
  console.log(`  Published: ${published}`)
  console.log(`  Skipped:   ${skipped}`)
  console.log(`  Failed:    ${failed}`)
  console.log('='.repeat(80))

  if (failed > 0) {
    const resumeCommand = publishDirectory
      ? `node common/scripts/safe-publish.js --publish-packed ${JSON.stringify(publishDirectory)}`
      : `node common/scripts/safe-publish.js${includePattern ? ` --include ${JSON.stringify(includePattern)}` : ''}`
    console.error(`Resume with: ${resumeCommand}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
