//
// Copyright © 2026 Hardcore Engineering Inc.
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

const fs = require('fs')
const path = require('path')

// Run from mobile/ directory (cwd = mobile)
const cwd = process.cwd()
const webDir = path.join(cwd, 'www')
const prodDist = path.join(cwd, '..', 'dev', 'prod', 'dist')
const prodPublic = path.join(cwd, '..', 'dev', 'prod', 'public')

if (!fs.existsSync(prodDist)) {
  console.error(
    'dev/prod/dist not found. Build the web app first: rush build --to @hcengineering/prod'
  )
  process.exit(1)
}

if (fs.existsSync(webDir)) {
  fs.rmSync(webDir, { recursive: true, force: true })
}

fs.mkdirSync(webDir, { recursive: true })
fs.cpSync(prodDist, webDir, { recursive: true })

if (fs.existsSync(prodPublic)) {
  const entries = fs.readdirSync(prodPublic, { withFileTypes: true })
  for (const entry of entries) {
    const src = path.join(prodPublic, entry.name)
    const dest = path.join(webDir, entry.name)
    fs.cpSync(src, dest, { recursive: true })
  }
}

// Use mobile-specific config (full backend URLs) so fallback page can reach the dev server.
// MOBILE_CONFIG selects another file from dev/prod/public (e.g. config-mobile-huly.json in CI).
const configName = process.env.MOBILE_CONFIG ?? 'config-mobile.json'
const configFile = path.join(prodPublic, configName)
if (fs.existsSync(configFile)) {
  fs.cpSync(configFile, path.join(webDir, 'config.json'))
} else if (process.env.MOBILE_CONFIG !== undefined) {
  console.error(`MOBILE_CONFIG=${configName} not found in dev/prod/public`)
  process.exit(1)
}

console.log('Web assets copied to mobile/www')
