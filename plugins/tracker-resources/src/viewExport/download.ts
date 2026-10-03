//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

/**
 * Starts a browser download of the text as a tab separated file.
 */
export function downloadTsv (text: string, fileName: string): void {
  const blob = new Blob([text], { type: 'text/tab-separated-values;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // Revoked after the click has had time to start the download
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 1000)
}
