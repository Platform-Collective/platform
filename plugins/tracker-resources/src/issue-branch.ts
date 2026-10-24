// SPDX-License-Identifier: EPL-2.0

const MAX_BRANCH_LENGTH = 60
const ASCII_FOLDS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th'
}

/** Generate an ASCII Git branch name, keeping complete dash-separated words within 60 characters. */
export function generateIssueBranchName (identifier: string, title: string): string {
  const branch = `${identifier}-${title}`
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[ßæœøłđðþ]/g, (letter) => ASCII_FOLDS[letter])
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  if (branch.length <= MAX_BRANCH_LENGTH) return branch

  const boundary = branch.lastIndexOf('-', MAX_BRANCH_LENGTH)
  // A single overlong token has no dash boundary, so enforce the limit directly.
  return branch.slice(0, boundary > 0 ? boundary : MAX_BRANCH_LENGTH)
}
