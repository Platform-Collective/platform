// SPDX-License-Identifier: EPL-2.0

import { extensionKit, htmlToJSON, ServerKit } from '@hcengineering/text'

// Kept module-private: its inferred type names @tiptap packages, which this pod does not depend on directly.
const GitlabKit = extensionKit(
  'gitlab',
  (e) =>
    ({
      serverKit: e(ServerKit, {
        image: {
          getBlobRef: async () => ({ src: '', srcset: '' })
        }
      })
    }) as const
)

/** Extensions for parsing HTML embedded in GitLab markdown. */
export const gitlabExtensions: NonNullable<Parameters<typeof htmlToJSON>[1]> = [GitlabKit]
