// SPDX-License-Identifier: EPL-2.0

export type FieldEquals<T> = { [K in keyof T]?: (a: T[K], b: T[K]) => boolean }

export interface MergeResult<T> {
  // GitLab changed the field and Huly did not
  toPlatform: Partial<T>
  // Huly changed the field (also when both changed: Huly wins)
  toGitlab: Partial<T>
  // Fields both sides changed to different values
  conflicts: Array<keyof T>
  // What both sides hold after the changes are applied: the next merge base
  merged: T
}

/**
 * Three-way merge of a synchronized object against `base`, the last state both sides agreed on.
 */
export function mergeFields<T extends object> (
  base: T,
  platform: T,
  external: T,
  equals: FieldEquals<T> = {}
): MergeResult<T> {
  const result: MergeResult<T> = { toPlatform: {}, toGitlab: {}, conflicts: [], merged: { ...platform } }
  const keys = new Set([...Object.keys(base), ...Object.keys(platform), ...Object.keys(external)]) as Set<keyof T>
  for (const key of keys) {
    const eq = (equals[key] ?? Object.is) as (a: unknown, b: unknown) => boolean
    const platformChanged = !eq(base[key], platform[key])
    const externalChanged = !eq(base[key], external[key])
    if (externalChanged && !platformChanged) {
      result.toPlatform[key] = external[key]
      result.merged[key] = external[key]
      continue
    }
    if (platformChanged && !eq(platform[key], external[key])) {
      result.toGitlab[key] = platform[key]
      if (externalChanged) result.conflicts.push(key)
    }
  }
  return result
}

/** Markdown equality that ignores line endings and trailing whitespace. */
export function compareMarkdown (a: string, b: string): boolean {
  const normalize = (s: string): string =>
    s
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((it) => it.trimEnd())
      .join('\n')
  return normalize(a) === normalize(b)
}
