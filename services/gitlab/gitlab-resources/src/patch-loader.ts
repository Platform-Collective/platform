// SPDX-License-Identifier: EPL-2.0

import { type GitlabPatch } from '@hcengineering/gitlab'
import { getFileUrl } from '@hcengineering/presentation'
import { createTextCache } from './patch-text'

const cached = createTextCache(async (file, name) => {
  const res = await fetch(getFileUrl(file, name))
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return await res.text()
})

/** The text of a stored diff. Every diff version has its own blob, so a blob never goes stale. */
export async function patchText (patch: Pick<GitlabPatch, 'file'>): Promise<string> {
  return await cached(patch.file, 'patch.diff')
}
