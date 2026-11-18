// SPDX-License-Identifier: EPL-2.0

import { AccountRole, getCurrentAccount, hasAccountRole } from '@hcengineering/core'

/** Project creation is available to workspace employees. */
export async function canCreateProject (): Promise<boolean> {
  return hasAccountRole(getCurrentAccount(), AccountRole.User)
}
