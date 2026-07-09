//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021 Hardcore Engineering, Inc.
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

import { createApp } from '@hcengineering/ui'
import { configurePlatform } from './platform'

/**
 * Check if running inside a Capacitor native app.
 */
function isCapacitorEnvironment (): boolean {
  return (
    typeof window !== 'undefined' &&
    (window as Window & { Capacitor?: unknown }).Capacitor !== undefined
  )
}

/**
 * Show a basic error UI when the app fails to initialize.
 * This is a fallback for when the native shell error screen isn't shown.
 */
function showInitializationError (error: Error): void {
  console.error('Failed to initialize platform:', error)

  // In Capacitor, the native shell should handle errors, so we don't need to show UI
  if (isCapacitorEnvironment()) {
    console.log('Running in Capacitor - native shell should handle error display')
    return
  }

  // For web browsers, show a simple error message
  document.body.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #1F2937; color: white; font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 32px;">
      <h1 style="font-size: 24px; margin-bottom: 16px;">Connection Error</h1>
      <p style="color: #9CA3AF; margin-bottom: 32px;">Unable to connect to the server.<br/>Please check if the server is running and try again.</p>
      <button onclick="location.reload()" style="padding: 12px 32px; background: #4F46E5; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 16px;">Retry</button>
    </div>
  `
}

configurePlatform()
  .then(() => {
    createApp(document.body)
  })
  .catch((error: Error) => {
    showInitializationError(error)
  })
