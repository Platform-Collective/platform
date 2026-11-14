// SPDX-License-Identifier: EPL-2.0

import type { Blob, BlobMetadata, Ref } from '@hcengineering/core'

interface FilePreviewHostProps {
  value: Ref<Blob> | string
  name: string | undefined
  contentType: string
  metadata: BlobMetadata | undefined
  fit: boolean
  setLoading: ((loading: boolean) => void) | undefined
}

/** Merge viewer defaults, caller options and authoritative host values without mutating inputs. */
export function getFilePreviewProps (
  registration: Readonly<Record<string, any>> | undefined,
  caller: Readonly<Record<string, any>>,
  host: FilePreviewHostProps
): Record<string, any> {
  // Unfixed behavior extracted from FilePreview for red-first contract evidence.
  void registration
  return {
    value: host.value,
    name: host.name,
    contentType: host.contentType,
    metadata: host.metadata,
    ...caller,
    fit: host.fit,
    setLoading: host.setLoading
  }
}
