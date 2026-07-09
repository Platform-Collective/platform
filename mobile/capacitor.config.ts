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

import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'org.platformcollective.app',
  appName: 'Huly',
  webDir: 'www',
  // No server.url: app loads from bundled www/ (local resources) so it opens without a server.
  // Backend requests (e.g. login) use config.json; "Server unavailable" is shown when backend is down.
  plugins: {
    SplashScreen: {
      launchShowDuration: 0, // Don't auto-hide; we control it manually
      launchAutoHide: false,
      showSpinner: true,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
      backgroundColor: '#000000'
    }
  }
}

export default config
