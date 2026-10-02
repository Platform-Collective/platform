// SPDX-License-Identifier: EPL-2.0

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
    const collabIdOf = (objectClass: string, objectId: string, attribute: string): ReturnType<typeof makeCollabId> =>
      makeCollabId(objectClass as Ref<Class<Doc>>, objectId as Ref<Doc>, attribute)

    return {
      write: async (objectClass, objectId, attribute, markdown) =>
        await client.createMarkup(collabIdOf(objectClass, objectId, attribute), toMarkup(markdown)),
      update: async (objectClass, objectId, attribute, markdown) => {
        await client.updateMarkup(collabIdOf(objectClass, objectId, attribute), toMarkup(markdown))
      }
    }
  }
}
