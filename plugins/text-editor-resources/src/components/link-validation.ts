// SPDX-License-Identifier: EPL-2.0

/** Check whether a link can be saved, including an empty link used to remove it. */
export function canSaveLink (link: string): boolean {
  if (link === '') return true

  try {
    return Boolean(new URL(link))
  } catch {
    return false
  }
}
