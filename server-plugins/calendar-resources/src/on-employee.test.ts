// SPDX-License-Identifier: EPL-2.0

import calendar, { AccessLevel } from '@hcengineering/calendar'
import contact from '@hcengineering/contact'
import type { Employee, Person } from '@hcengineering/contact'
import core, { SocialIdType, TxFactory } from '@hcengineering/core'
import type { AccountUuid, Class, Doc, DocumentQuery, PersonId, Ref, SocialId, TxMixin } from '@hcengineering/core'
import type { TriggerControl } from '@hcengineering/server-core'
import { OnEmployee } from './index'

function makeEmployee (id: string, account = id): Partial<Employee> {
  return { _id: id as Ref<Employee>, personUuid: account as AccountUuid, active: true }
}

function makeControl (employees: Partial<Employee>[]): {
  control: TriggerControl
  txFactory: TxFactory
  calendars: Array<{ _id: string, createdBy: PersonId }>
  socialIds: SocialId[]
  socialId: SocialId
} {
  const socialId: SocialId = {
    _id: 'social-id' as PersonId,
    type: SocialIdType.EMAIL,
    value: 'employee@example.com',
    key: 'email:employee@example.com',
    verifiedOn: 1
  }
  const calendars: Array<{ _id: string, createdBy: PersonId }> = []
  const socialIds = [socialId]
  const findAll = jest.fn(async (_ctx: unknown, clazz: Ref<Class<Doc>>, query: DocumentQuery<Doc>) => {
    if (clazz === contact.class.SocialIdentity) return socialIds
    if (clazz === contact.mixin.Employee) return employees.filter((employee) => employee._id === query._id)
    if (clazz === calendar.class.Calendar) {
      return calendars.filter((entry) => {
        if (query._id !== undefined) return entry._id === query._id
        const createdBy = query.createdBy as { $in: PersonId[] }
        return createdBy.$in.includes(entry.createdBy)
      })
    }
    throw new Error(`Unexpected class: ${clazz}`)
  })
  const txFactory = new TxFactory(core.account.System)
  const control = { findAll, txFactory } as unknown as TriggerControl
  return { control, txFactory, calendars, socialIds, socialId }
}

function activate (txFactory: TxFactory, employee: Partial<Employee>, active = true): TxMixin<Person, Employee> {
  return txFactory.createTxMixin<Person, Employee>(
    employee._id as Ref<Person>,
    contact.class.Person,
    core.space.Workspace,
    contact.mixin.Employee,
    { active }
  )
}

describe('OnEmployee', () => {
  it('creates one calendar for repeated activations in a batch', async () => {
    const employee = makeEmployee('employee')
    const { control, txFactory, socialId } = makeControl([employee])

    const result = await OnEmployee([activate(txFactory, employee), activate(txFactory, employee)], control)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      _class: core.class.TxCreateDoc,
      objectClass: calendar.class.Calendar,
      objectId: 'employee_calendar',
      objectSpace: calendar.space.Calendar,
      modifiedBy: socialId._id,
      attributes: { name: 'HULY', hidden: false, visibility: 'public', user: socialId._id, access: AccessLevel.Owner }
    })
  })

  it('deduplicates calendar IDs when different people share an account', async () => {
    const employees = [makeEmployee('person-1', 'account'), makeEmployee('person-2', 'account')]
    const { control, txFactory } = makeControl(employees)

    const result = await OnEmployee(
      employees.map((employee) => activate(txFactory, employee)),
      control
    )

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ objectId: 'account_calendar' })
  })

  it('creates separate calendars for different accounts', async () => {
    const employees = [makeEmployee('person-1'), makeEmployee('person-2')]
    const { control, txFactory } = makeControl(employees)

    const result = await OnEmployee(
      employees.map((employee) => activate(txFactory, employee)),
      control
    )

    expect(result).toHaveLength(2)
    expect(result).toEqual([
      expect.objectContaining({ objectId: 'person-1_calendar' }),
      expect.objectContaining({ objectId: 'person-2_calendar' })
    ])
  })

  it('skips an existing account calendar created by an old social identity', async () => {
    const employee = makeEmployee('employee')
    const { control, txFactory, calendars } = makeControl([employee])
    calendars.push({ _id: 'employee_calendar', createdBy: 'old-social-id' as PersonId })

    const result = await OnEmployee([activate(txFactory, employee)], control)

    expect(result).toEqual([])
  })

  it('preserves the existing social identity calendar check', async () => {
    const employee = makeEmployee('employee')
    const { control, txFactory, calendars, socialId } = makeControl([employee])
    calendars.push({ _id: 'legacy-calendar', createdBy: socialId._id })

    expect(await OnEmployee([activate(txFactory, employee)], control)).toEqual([])
  })

  it('skips inactive employees', async () => {
    const employee = makeEmployee('employee')
    const { control, txFactory } = makeControl([employee])

    expect(await OnEmployee([activate(txFactory, employee, false)], control)).toEqual([])
  })

  it('skips employees without social identities', async () => {
    const employee = makeEmployee('employee')
    const { control, txFactory, socialIds } = makeControl([employee])
    socialIds.length = 0

    expect(await OnEmployee([activate(txFactory, employee)], control)).toEqual([])
  })

  it.each<Partial<Employee>>([{ role: 'GUEST' }, { personUuid: undefined }])(
    'skips ineligible employees: %o',
    async (attributes) => {
      const employee = { ...makeEmployee('employee'), ...attributes }
      const { control, txFactory } = makeControl([employee])

      expect(await OnEmployee([activate(txFactory, employee)], control)).toEqual([])
    }
  )
})
