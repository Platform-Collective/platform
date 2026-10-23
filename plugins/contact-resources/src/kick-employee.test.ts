// SPDX-License-Identifier: EPL-2.0

import type { Employee } from '@hcengineering/contact'
import { getCurrentAccount, type AccountUuid } from '@hcengineering/core'
import login from '@hcengineering/login'
import { getResource } from '@hcengineering/platform'
import { getClient } from '@hcengineering/presentation'
import { showPopup } from '@hcengineering/ui'
import { canKickEmployee, kickEmployee } from './kick-employee'

jest.mock('@hcengineering/core', () => ({ getCurrentAccount: jest.fn() }), { virtual: true })
jest.mock('@hcengineering/login', () => ({ function: { LeaveWorkspace: 'leave-workspace' } }), { virtual: true })
jest.mock('@hcengineering/platform', () => ({ getResource: jest.fn() }), { virtual: true })
jest.mock('@hcengineering/presentation', () => ({ MessageBox: 'message-box', getClient: jest.fn() }), { virtual: true })
jest.mock('@hcengineering/ui', () => ({ showPopup: jest.fn() }), { virtual: true })
jest.mock('./plugin', () => ({
  mixin: { Employee: 'employee' },
  string: { KickEmployee: 'kick-employee', KickEmployeeDescr: 'kick-employee-description' }
}))

describe('kickEmployee', () => {
  const currentAccountUuid = 'current-account' as AccountUuid
  const otherAccountUuid = 'other-account' as AccountUuid
  const update = jest.fn(async (employee: Employee, data: Partial<Employee>) => Object.assign(employee, data))
  const leaveWorkspace = jest.fn().mockResolvedValue(undefined)

  beforeEach(() => {
    jest.clearAllMocks()
    jest
      .mocked(getCurrentAccount)
      .mockReturnValue({ uuid: currentAccountUuid } as unknown as ReturnType<typeof getCurrentAccount>)
    jest.mocked(getClient).mockReturnValue({
      getHierarchy: () => ({ as: (employee: Employee) => employee }),
      update
    } as unknown as ReturnType<typeof getClient>)
    jest.mocked(getResource).mockResolvedValue(leaveWorkspace)
  })

  function createEmployee (personUuid?: AccountUuid): Employee {
    return { _id: 'employee-id', personUuid, active: true } as unknown as Employee
  }

  async function confirmRemoval (): Promise<void> {
    const props = jest.mocked(showPopup).mock.calls[0][1] as { action: () => Promise<void> }
    await props.action()
  }

  it('keeps the current account active without opening confirmation or leaving the workspace', async () => {
    const employee = createEmployee(currentAccountUuid)

    await kickEmployee(employee)

    expect(showPopup).not.toHaveBeenCalled()
    expect(getClient).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(getResource).not.toHaveBeenCalled()
    expect(leaveWorkspace).not.toHaveBeenCalled()
    expect(employee.active).toBe(true)
  })

  it('hides the action for the current account only', async () => {
    expect(await canKickEmployee(createEmployee(currentAccountUuid))).toBe(false)
    expect(await canKickEmployee(createEmployee(otherAccountUuid))).toBe(true)
    expect(await canKickEmployee(createEmployee())).toBe(true)
  })

  it('removes another employee only after confirmation', async () => {
    const employee = createEmployee(otherAccountUuid)

    await kickEmployee(employee)

    expect(showPopup).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(leaveWorkspace).not.toHaveBeenCalled()
    expect(employee.active).toBe(true)

    await confirmRemoval()

    expect(update).toHaveBeenCalledWith(employee, { active: false })
    expect(employee.active).toBe(false)
    expect(getResource).toHaveBeenCalledWith(login.function.LeaveWorkspace)
    expect(leaveWorkspace).toHaveBeenCalledWith(otherAccountUuid)
  })

  it('deactivates an employee without an account after confirmation', async () => {
    const employee = createEmployee()

    await kickEmployee(employee)
    await confirmRemoval()

    expect(update).toHaveBeenCalledWith(employee, { active: false })
    expect(employee.active).toBe(false)
    expect(getResource).not.toHaveBeenCalled()
    expect(leaveWorkspace).not.toHaveBeenCalled()
  })
})
