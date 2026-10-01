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

import contact from '@hcengineering/contact'
import { AccountRole, type Doc } from '@hcengineering/core'

import { type ToolContext } from '../mcp/tool'

/**
 * Ownership rules the web app applies in the browser but the transactor does not.
 *
 * The transactor lets any workspace member write to a public space, so a plain
 * user could delete or rename a teamspace someone else owns through the API even
 * though the web app would refuse. The generic write tools mirror the web app's
 * rule so an agent never has more reach than the person using the UI: only a
 * workspace owner, or the creator of a document, may delete it.
 */

/** True when the caller holds the workspace Owner role. */
export async function callerIsOwner (ctx: ToolContext): Promise<boolean> {
  const members = await ctx.accounts.getWorkspaceMembers()
  return members.some((member) => member.person === ctx.account && member.role === AccountRole.Owner)
}

/** The caller's own social ids, which is what `createdBy` records. */
async function callerSocialIds (ctx: ToolContext): Promise<Set<string>> {
  const personQuery: Record<string, unknown> = { personUuid: ctx.account }
  const person = await ctx.client.findOne(contact.class.Person, personQuery as never)
  if (person === undefined) return new Set()

  const identityQuery: Record<string, unknown> = { attachedTo: person._id }
  const identities = await ctx.client.findAll(contact.class.SocialIdentity, identityQuery as never)
  return new Set(identities.map((identity) => identity._id as string))
}

async function callerCreated (ctx: ToolContext, doc: Doc): Promise<boolean> {
  return (await callerSocialIds(ctx)).has(doc.createdBy as string)
}

/** The web app's delete rule: a workspace owner, or whoever created the document. */
export async function mayDelete (ctx: ToolContext, doc: Doc): Promise<boolean> {
  return (await callerIsOwner(ctx)) || (await callerCreated(ctx, doc))
}

/**
 * Who may rename a space, change its members or archive it: a workspace owner,
 * an owner of that space, or its creator.
 */
export async function mayManageSpace (ctx: ToolContext, space: Doc & { owners?: string[] }): Promise<boolean> {
  if (space.owners?.includes(ctx.account) === true) return true
  return (await callerIsOwner(ctx)) || (await callerCreated(ctx, space))
}
