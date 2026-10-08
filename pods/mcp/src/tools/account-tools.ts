// SPDX-License-Identifier: EPL-2.0

import contact from '@hcengineering/contact'
import { AccountRole, type AccountUuid } from '@hcengineering/core'
import platform, { PlatformError } from '@hcengineering/platform'

import { errorResult, textResult, type McpToolCallResult } from '../mcp/protocol'
import { booleanProp, numberProp, objectSchema, stringProp } from '../mcp/schema'
import { type HulyTool, type ToolContext } from '../mcp/tool'
import { toIso } from './shared'

/**
 * Workspace administration: settings, members and roles.
 *
 * These go to the account service, not the workspace transactor, and run with
 * the caller's own token. The service enforces the role rules (for example a
 * maintainer cannot remove an owner), so a refusal is reported as a plain
 * sentence the agent can relay instead of an opaque platform status.
 */

/** Roles an agent may assign. `Admin` is the platform operator role and is never grantable here. */
const ASSIGNABLE_ROLES = Object.keys(AccountRole).filter((name) => name !== 'Admin')

const roleFromName = (name: string): AccountRole => AccountRole[name as keyof typeof AccountRole]

const roleName = (role: AccountRole): string =>
  Object.entries(AccountRole).find(([, value]) => value === role)?.[0] ?? String(role)

const ROLE_PROP = {
  type: 'string' as const,
  enum: ASSIGNABLE_ROLES
}

/** Maximum member names resolved in one call; members past this are listed by id only. */
const MAX_NAMED_MEMBERS = 200

/** Runs an account call, turning a Forbidden status into an answer the agent can act on. */
async function asCaller (action: string, run: () => Promise<McpToolCallResult>): Promise<McpToolCallResult> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof PlatformError && err.status.code === platform.status.Forbidden) {
      return errorResult(
        `Your role in this workspace does not allow you to ${action}. Call huly_get_workspace to see your role.`
      )
    }
    throw err
  }
}

async function callerRole (ctx: ToolContext): Promise<string | null> {
  const members = await ctx.accounts.getWorkspaceMembers()
  const me = members.find((member) => member.person === ctx.account)
  return me === undefined ? null : roleName(me.role)
}

export const getWorkspaceTool: HulyTool = {
  name: 'huly_get_workspace',
  title: 'Get workspace settings',
  description:
    'Show this workspace\'s settings (name, url, region, guest access) and the caller\'s own role in it. ' +
    'Call this first to learn what the caller is allowed to change.',
  readOnly: true,
  inputSchema: objectSchema({}),
  handler: async (ctx) => {
    const [info, role] = await Promise.all([ctx.accounts.getWorkspaceInfo(), callerRole(ctx)])
    const result = {
      id: info.uuid,
      name: info.name,
      url: info.url,
      region: info.region ?? null,
      createdOn: toIso(info.createdOn),
      allowReadOnlyGuests: info.allowReadOnlyGuest ?? false,
      allowGuestSignUp: info.allowGuestSignUp ?? false,
      yourRole: role
    }
    return textResult(JSON.stringify(result, null, 2), result)
  }
}

export const listMembersTool: HulyTool = {
  name: 'huly_list_members',
  title: 'List workspace members',
  description:
    'List everyone with access to this workspace, with their role. ' +
    'The accountId is what huly_set_member_role and huly_remove_member expect. ' +
    'A name can be null for a member who has just joined and has no profile in the workspace yet.',
  readOnly: true,
  inputSchema: objectSchema({}),
  handler: async (ctx) => {
    const members = await ctx.accounts.getWorkspaceMembers()

    // Names live on the workspace's own Person records, which link to the
    // account through personUuid. The account service's person lookup is
    // service-only, so a user token cannot use it.
    const query: Record<string, unknown> = { personUuid: { $in: members.map((member) => member.person) } }
    const persons = (await ctx.client.findAll(contact.class.Person, query as never, {
      limit: MAX_NAMED_MEMBERS
    })) as unknown as Array<{ name: string, personUuid?: string }>
    const names = new Map(persons.map((person) => [person.personUuid, person.name]))

    const rows = members.map((member) => ({
      accountId: member.person,
      name: names.get(member.person) ?? null,
      role: roleName(member.role),
      you: member.person === ctx.account
    }))
    return textResult(JSON.stringify({ members: rows }, null, 2), { members: rows })
  }
}

export const updateWorkspaceNameTool: HulyTool = {
  name: 'huly_update_workspace_name',
  title: 'Rename workspace',
  description: 'Change the display name of the workspace. The workspace url does not change.',
  readOnly: false,
  inputSchema: objectSchema({ name: stringProp('New workspace name.', { minLength: 1, maxLength: 100 }) }, ['name']),
  handler: async (ctx, args) =>
    await asCaller('rename the workspace', async () => {
      await ctx.accounts.updateWorkspaceName(args.name as string)
      return textResult(`Renamed the workspace to "${String(args.name)}".`, { updated: true })
    })
}

export const updateGuestSettingsTool: HulyTool = {
  name: 'huly_update_workspace_guest_settings',
  title: 'Change guest access',
  description:
    'Turn read-only guest access and guest sign-up on or off for the workspace. Only the fields you pass change.',
  readOnly: false,
  inputSchema: objectSchema({
    allowReadOnlyGuests: booleanProp('Let people without an account view the workspace read-only.'),
    allowGuestSignUp: booleanProp('Let guests sign up for an account on their own.')
  }),
  handler: async (ctx, args) => {
    if (args.allowReadOnlyGuests === undefined && args.allowGuestSignUp === undefined) {
      return textResult('Nothing to change. Pass allowReadOnlyGuests and/or allowGuestSignUp.', { updated: false })
    }
    return await asCaller('change guest access', async () => {
      const changed: string[] = []
      if (args.allowReadOnlyGuests !== undefined) {
        await ctx.accounts.updateAllowReadOnlyGuests(args.allowReadOnlyGuests as boolean)
        changed.push('allowReadOnlyGuests')
      }
      if (args.allowGuestSignUp !== undefined) {
        await ctx.accounts.updateAllowGuestSignUp(args.allowGuestSignUp as boolean)
        changed.push('allowGuestSignUp')
      }
      return textResult(`Updated guest access: ${changed.join(', ')}.`, { updated: true, changed })
    })
  }
}

export const setMemberRoleTool: HulyTool = {
  name: 'huly_set_member_role',
  title: 'Change a member\'s role',
  description:
    'Change the role of a workspace member. Get the accountId from huly_list_members. ' +
    'The account service decides who may grant which role.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      accountId: stringProp('Member account id from huly_list_members.'),
      role: { ...ROLE_PROP, description: 'New role.' }
    },
    ['accountId', 'role']
  ),
  handler: async (ctx, args) =>
    await asCaller('change member roles', async () => {
      const role = roleFromName(args.role as string)
      await ctx.accounts.updateWorkspaceRole(args.accountId as AccountUuid, role)
      return textResult(`Set the role of ${String(args.accountId)} to ${String(args.role)}.`, {
        updated: true,
        role: args.role
      })
    })
}

export const removeMemberTool: HulyTool = {
  name: 'huly_remove_member',
  title: 'Remove a member',
  description:
    'Remove a member from the workspace. Their account is not deleted, they just lose access here. ' +
    'Get the accountId from huly_list_members. The last owner cannot be removed.',
  readOnly: false,
  destructive: true,
  inputSchema: objectSchema({ accountId: stringProp('Member account id from huly_list_members.') }, ['accountId']),
  handler: async (ctx, args) =>
    await asCaller('remove members', async () => {
      await ctx.accounts.removeMember(args.accountId as AccountUuid)
      return textResult(`Removed ${String(args.accountId)} from the workspace.`, { removed: true })
    })
}

export const inviteMemberTool: HulyTool = {
  name: 'huly_invite_member',
  title: 'Invite a member by email',
  description:
    'Send an email invitation to join the workspace with the given role. This sends a real email. ' +
    'To get a link instead, use huly_create_invite_link.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      email: stringProp('Email address to invite.', { minLength: 3, maxLength: 320 }),
      role: { ...ROLE_PROP, description: 'Role the invitee gets. Defaults to User.', default: 'User' }
    },
    ['email']
  ),
  handler: async (ctx, args) =>
    await asCaller('invite members', async () => {
      const role = (args.role as string | undefined) ?? 'User'
      try {
        await ctx.accounts.sendInvite(args.email as string, roleFromName(role))
      } catch (err) {
        // A Forbidden still means "your role", so leave that to asCaller. Anything else at this
        // point is almost always the account service failing to send mail.
        if (err instanceof PlatformError && err.status.code === platform.status.Forbidden) throw err
        return errorResult(
          `The invitation to ${String(args.email)} could not be sent. The account service may have no email ` +
            'service configured. Use huly_create_invite_link to get a link to share instead.'
        )
      }
      return textResult(`Invited ${String(args.email)} as ${role}.`, { invited: true })
    })
}

export const createInviteLinkTool: HulyTool = {
  name: 'huly_create_invite_link',
  title: 'Create an invite link',
  description:
    'Create a link that lets one email address join the workspace with the given role. ' +
    'Anyone holding the link can use it until it expires, so treat it as a credential.',
  readOnly: false,
  inputSchema: objectSchema(
    {
      email: stringProp('Email address the link is for.', { minLength: 3, maxLength: 320 }),
      role: { ...ROLE_PROP, description: 'Role the invitee gets. Defaults to User.', default: 'User' },
      expiresInHours: numberProp('Hours until the link expires (1-720, default 48).', {
        minimum: 1,
        maximum: 720,
        default: 48
      })
    },
    ['email']
  ),
  handler: async (ctx, args) =>
    await asCaller('create invite links', async () => {
      const role = (args.role as string | undefined) ?? 'User'
      const hours = typeof args.expiresInHours === 'number' ? args.expiresInHours : 48
      const link = await ctx.accounts.createInviteLink(args.email as string, roleFromName(role), hours)
      return textResult(JSON.stringify({ link, email: args.email, role, expiresInHours: hours }, null, 2), {
        created: true
      })
    })
}

export const accountTools: HulyTool[] = [
  getWorkspaceTool,
  listMembersTool,
  updateWorkspaceNameTool,
  updateGuestSettingsTool,
  setMemberRoleTool,
  removeMemberTool,
  inviteMemberTool,
  createInviteLinkTool
]
