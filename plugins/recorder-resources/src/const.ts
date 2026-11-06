//
// Copyright © 2025 Hardcore Engineering Inc.
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

export const DefaultAudioBps = 128000
export const DefaultVideoBps = 4000000
export const DefaultVideoRes = 1080
export const DefaultFps = 30
export const DefaultChunkIntervalMs = 1000

export const MAX_RETAINED_BYTES = 512 * 1024 * 1024
// This bounds an outage on the original upload; keep it below the server's STREAM_TIMEOUT (default 5m).
export const UPLOAD_RETRY_BUDGET_MS = 180000
export const RECOVERY_OFFLINE_DEADLINE_MS = 10 * 60 * 1000
// Allow the final PATCH to flush parts, complete the backend object and reconcile a lost response.
export const UPLOAD_REQUEST_TIMEOUT_MS = 6 * 60 * 1000
export const UPLOAD_CLEANUP_TIMEOUT_MS = 5000
