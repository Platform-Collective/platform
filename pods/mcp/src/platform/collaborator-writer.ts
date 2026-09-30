/**
  Copyright © 2026 Intabia Fusion.

  Licensed under the Eclipse Public License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License. You may
  obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

  See the License for the specific language governing permissions and
  limitations under the License.
*/

import { getClient as getCollaboratorClient } from '@hcengineering/collaborator-client'
import { makeCollabId, type Class, type Doc, type Ref } from '@hcengineering/core'

import { type SessionIdentity } from '../auth/authenticator'
import { toMarkup } from './markup'
import { type MarkupWriter } from './markup-reader'

/**
 * Builds a writer that stores rich text through the collaborator service.
 *
 * Returns undefined when no collaborator URL is configured, so tools can refuse
 * a description explicitly instead of dropping it.
 */
export function createCollaboratorWriter (
  collaboratorUrl: string
): ((identity: SessionIdentity) => MarkupWriter | undefined) {
  if (collaboratorUrl === '') return () => undefined

  return (identity) => {
    const client = getCollaboratorClient(identity.workspace, identity.workspaceToken, collaboratorUrl)
    return {
      write: async (objectClass, objectId, attribute, markdown) => {
        const collabId = makeCollabId(objectClass as Ref<Class<Doc>>, objectId as Ref<Doc>, attribute)
        return await client.createMarkup(collabId, toMarkup(markdown))
      }
    }
  }
}
