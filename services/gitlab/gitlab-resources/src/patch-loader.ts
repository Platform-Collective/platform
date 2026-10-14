// SPDX-License-Identifier: EPL-2.0

import { type DiffFile } from '@hcengineering/diffview'
import { type GitlabPatch } from '@hcengineering/gitlab'
import { getFileUrl } from '@hcengineering/presentation'
import { parsePatch } from './hunk'
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

// Thread snippets read the parsed diff; parsed once per blob, not once per thread
const cachedFiles = createTextCache<DiffFile[]>(async (file, name) => parsePatch(await cached(file, name)))

/** The files of a stored diff, parsed once per blob. */
export async function patchFiles (patch: Pick<GitlabPatch, 'file'>): Promise<DiffFile[]> {
  return await cachedFiles(patch.file, 'patch.diff')
}
