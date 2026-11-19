// SPDX-License-Identifier: EPL-2.0

import core, {
  AccountRole,
  ClassifierKind,
  Hierarchy,
  MeasureMetricsContext,
  systemAccount,
  TxFactory,
  type Account,
  type Class,
  type Data,
  type Doc,
  type DocumentUpdate,
  type PersonId,
  type Ref,
  type SessionData,
  type TxCreateDoc,
  type TxCUD,
  type WorkspaceUuid
} from '@hcengineering/core'
import platform, { addLocation, PlatformError, Severity, Status, type Plugin } from '@hcengineering/platform'
import serverCore, {
  createPipeline,
  type Middleware,
  type PipelineContext,
  type TxValidator,
  type TxValidatorControl
} from '@hcengineering/server-core'
import { ApplyTxMiddleware } from '../applyTx'
import { MarkDerivedEntryMiddleware } from '../derivedEntry'
import { TxValidatorMiddleware } from '../txValidator'

const testPluginId = 'test-tx-validator' as Plugin
const validatorResource = `${testPluginId}:validator:Validate` as TxValidator['validator']
interface TestDoc extends Doc {
  name?: string
}
const testClass = 'test:class:Validated' as Ref<Class<TestDoc>>
const validate = jest.fn(async (_txes: TxCUD<Doc>[], _control: TxValidatorControl): Promise<void> => {})
addLocation(testPluginId, async () => ({ default: async () => ({ validator: { Validate: validate } }) }))

const account: Account = {
  uuid: 'test-account' as Account['uuid'],
  role: AccountRole.User,
  primarySocialId: 'test-person' as PersonId,
  socialIds: [],
  fullSocialIds: []
}
const factory = new TxFactory(account.primarySocialId)

function makeCtx (currentAccount: Account = account): MeasureMetricsContext & { contextData: SessionData } {
  return Object.assign(new MeasureMetricsContext('test', {}), {
    contextData: { account: currentAccount }
  }) as unknown as MeasureMetricsContext & { contextData: SessionData }
}

function makeValidator (
  txMatch?: TxValidator['txMatch'],
  options: Pick<TxValidator, 'includeSystem' | 'includeDerived'> = {}
): TxValidator {
  return {
    _id: 'test:validator:One' as Ref<TxValidator>,
    _class: serverCore.class.TxValidator,
    space: core.space.Model,
    modifiedBy: core.account.System,
    modifiedOn: 0,
    validator: validatorResource,
    objectClass: testClass,
    txMatch,
    ...options
  }
}

async function makeMiddleware (
  validators: TxValidator[] = [],
  derived: boolean = false
): Promise<{
  middleware: Middleware
  next: { tx: jest.Mock, findAll: jest.Mock }
  hierarchy: Hierarchy
  context: PipelineContext
}> {
  const hierarchy = new Hierarchy()
  const context: PipelineContext = {
    hierarchy,
    modelDb: { findAllSync: () => validators } as unknown as PipelineContext['modelDb'],
    workspace: { uuid: 'test-workspace' as WorkspaceUuid, url: 'test-workspace' },
    branding: null,
    contextVars: {}
  }
  const next = {
    tx: jest.fn(async () => ({})),
    findAll: jest.fn(async () => [])
  }
  const middleware = derived
    ? await TxValidatorMiddleware.createDerived(makeCtx(), context, next as unknown as Middleware)
    : await TxValidatorMiddleware.create(makeCtx(), context, next as unknown as Middleware)
  return { middleware, next, hierarchy, context }
}

function createTx (): TxCUD<Doc> {
  return factory.createTxCreateDoc(testClass, core.space.Workspace, {})
}

describe('TxValidatorMiddleware', () => {
  beforeEach(() => {
    validate.mockReset()
  })

  it('passes transactions through without document or ancestor lookups when no validators are registered', async () => {
    const { middleware, next, hierarchy } = await makeMiddleware()
    const tx = createTx()
    const getAncestors = jest.spyOn(hierarchy, 'getAncestors')

    await middleware.tx(makeCtx(), [tx])

    expect(next.tx).toHaveBeenCalledWith(expect.anything(), [tx])
    expect(next.findAll).not.toHaveBeenCalled()
    expect(getAncestors).not.toHaveBeenCalled()
  })

  it('rejects with the validator status without storing the transaction', async () => {
    const status = new Status(Severity.ERROR, platform.status.Forbidden, {})
    validate.mockRejectedValueOnce(new PlatformError(status))
    const { middleware, next } = await makeMiddleware([makeValidator()])

    await expect(middleware.tx(makeCtx(), [createTx()])).rejects.toMatchObject({ status })
    expect(next.tx).not.toHaveBeenCalled()
  })

  it('passes deeply frozen transaction copies to validators', async () => {
    const { middleware, next } = await makeMiddleware([makeValidator()])
    const tx = factory.createTxCreateDoc(testClass, core.space.Workspace, { name: 'original' })
    validate.mockImplementationOnce(async (txes) => {
      const create = txes[0] as TxCreateDoc<TestDoc>
      expect(Object.isFrozen(create)).toBe(true)
      expect(Object.isFrozen(create.attributes)).toBe(true)
      expect(() => {
        create.attributes.name = 'changed'
      }).toThrow()
    })

    await middleware.tx(makeCtx(), [tx])

    expect(tx.attributes.name).toBe('original')
    expect(next.tx).toHaveBeenCalledWith(expect.anything(), [tx])
  })

  it('rejects the whole apply batch before storing any of it', async () => {
    validate.mockImplementationOnce(async (txes) => {
      if (txes.some((tx) => tx._class === core.class.TxUpdateDoc)) {
        throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      }
    })
    const { middleware, next } = await makeMiddleware([makeValidator()])
    const update = factory.createTxUpdateDoc(testClass, core.space.Workspace, createTx().objectId, {})
    const apply = factory.createTxApplyIf(core.space.Tx, undefined, [], [], [createTx(), update], undefined)

    await expect(middleware.tx(makeCtx(), [apply])).rejects.toBeInstanceOf(PlatformError)
    expect(next.tx).not.toHaveBeenCalled()
  })

  it('skips system transactions', async () => {
    const { middleware, next } = await makeMiddleware([makeValidator()])
    const tx = createTx()

    await middleware.tx(makeCtx(systemAccount), [tx])

    expect(validate).not.toHaveBeenCalled()
    expect(next.tx).toHaveBeenCalledWith(expect.anything(), [tx])
  })

  it('validates system transactions when requested by the validator', async () => {
    const { middleware, next } = await makeMiddleware([makeValidator(undefined, { includeSystem: true })])
    const tx = createTx()

    await middleware.tx(makeCtx(systemAccount), [tx])

    expect(validate).toHaveBeenCalledWith([tx], expect.objectContaining({ account: systemAccount }))
    expect(next.tx).toHaveBeenCalledWith(expect.anything(), [tx])
  })

  it('runs includeDerived validators through the derived pipeline entry', async () => {
    const validator = makeValidator(undefined, { includeDerived: true })
    const client = await makeMiddleware([validator])
    await client.middleware.tx(makeCtx(), [createTx()])
    expect(validate).not.toHaveBeenCalled()

    const { context } = await makeMiddleware([validator], true)
    const storage = { tx: jest.fn(async () => ({})), findAll: jest.fn(async () => []) }
    const pipeline = await createPipeline(
      makeCtx(),
      [
        async (ctx, pipelineContext, next) => await MarkDerivedEntryMiddleware.create(ctx, pipelineContext, next),
        async (ctx, pipelineContext, next) => await TxValidatorMiddleware.createDerived(ctx, pipelineContext, next),
        async () => storage as unknown as Middleware
      ],
      context
    )
    const tx = createTx()
    await (pipeline.context.derived as Middleware).tx(makeCtx(), [tx])

    expect(validate).toHaveBeenCalledWith([tx], expect.anything())
    expect(storage.tx).toHaveBeenCalledWith(expect.anything(), [tx])
  })

  it('keeps includeDerived validators inside ApplyTx scope serialization', async () => {
    const validator = makeValidator(undefined, { includeDerived: true })
    const { context } = await makeMiddleware([validator], true)
    jest.spyOn(context.hierarchy, 'isDerived').mockImplementation((_class, from) => _class === from)
    const storage = { tx: jest.fn(async () => ({})), findAll: jest.fn(async () => []) }
    const pipeline = await createPipeline(
      makeCtx(),
      [
        async (ctx, pipelineContext, next) => await ApplyTxMiddleware.create(ctx, pipelineContext, next),
        async (ctx, pipelineContext, next) => await TxValidatorMiddleware.createDerived(ctx, pipelineContext, next),
        async () => storage as unknown as Middleware
      ],
      context
    )
    let releaseFirst: () => void = () => {}
    let markStarted: () => void = () => {}
    const firstStarted = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    validate.mockImplementationOnce(async () => {
      markStarted()
      await gate
    })
    const apply = factory.createTxApplyIf(core.space.Tx, 'rating-scope', [], [], [createTx()], undefined)

    const first = pipeline.tx(makeCtx(), [apply])
    await firstStarted
    const second = pipeline.tx(makeCtx(), [apply])
    await Promise.resolve()
    expect(validate).toHaveBeenCalledTimes(1)
    releaseFirst()
    await Promise.all([first, second])

    expect(validate).toHaveBeenCalledTimes(2)
    expect(storage.tx).toHaveBeenCalledTimes(2)
  })

  it('honors txMatch and exposes earlier batch changes through current', async () => {
    let current: Doc | undefined
    validate.mockImplementationOnce(async (txes, control) => {
      expect(control.account).toBe(account)
      expect(txes).toHaveLength(2)
      current = await control.current(txes[1])
    })
    const txMatch = { _class: { $in: [core.class.TxCreateDoc, core.class.TxUpdateDoc] } }
    const { middleware, next, hierarchy } = await makeMiddleware([makeValidator(txMatch)])
    jest.spyOn(hierarchy, 'getBaseClass').mockReturnValue(core.class.Tx)
    jest.spyOn(hierarchy, 'isDerived').mockImplementation((_class, from) => from === core.class.Tx)
    const create = factory.createTxCreateDoc(testClass, core.space.Workspace, {
      name: 'created'
    })
    const update = factory.createTxUpdateDoc(testClass, core.space.Workspace, create.objectId, {
      name: 'updated'
    })
    const apply = factory.createTxApplyIf(core.space.Tx, undefined, [], [], [create, update], undefined)

    await middleware.tx(makeCtx(), [apply])

    expect(validate).toHaveBeenCalledTimes(1)
    expect(current).toMatchObject({ name: 'created' })
    expect(next.tx).toHaveBeenCalled()
  })

  it.each(['create', 'update', 'remove'] as const)('rejects client %s of validator documents', async (operation) => {
    const { middleware, next } = await makeMiddleware()
    const validator = makeValidator()
    const tx =
      operation === 'create'
        ? factory.createTxCreateDoc(serverCore.class.TxValidator, core.space.Model, {
            validator: validatorResource,
            objectClass: testClass
          })
        : operation === 'update'
          ? factory.createTxUpdateDoc(serverCore.class.TxValidator, core.space.Model, validator._id, {})
          : factory.createTxRemoveDoc(serverCore.class.TxValidator, core.space.Model, validator._id)

    await expect(middleware.tx(makeCtx(), [tx])).rejects.toMatchObject({
      status: expect.objectContaining({ code: platform.status.Forbidden })
    })
    expect(next.tx).not.toHaveBeenCalled()
    await middleware.tx(makeCtx(), [createTx()])
    expect(validate).not.toHaveBeenCalled()
  })

  it('rejects client writes to subclasses of the validator class', async () => {
    const { middleware, next, hierarchy } = await makeMiddleware()
    const subclass = 'test:class:ValidatorSubclass' as Ref<Class<TxValidator>>
    jest
      .spyOn(hierarchy, 'isDerived')
      .mockImplementation(
        (_class, from) => _class === from || (_class === subclass && from === serverCore.class.TxValidator)
      )
    const tx = factory.createTxCreateDoc(subclass, core.space.Model, {
      validator: validatorResource,
      objectClass: testClass
    })

    await expect(middleware.tx(makeCtx(), [tx])).rejects.toMatchObject({
      status: expect.objectContaining({ code: platform.status.Forbidden })
    })
    expect(next.tx).not.toHaveBeenCalled()
  })

  it('rejects client creation of subclasses of the validator class', async () => {
    const { middleware, next } = await makeMiddleware()
    const tx = factory.createTxCreateDoc(core.class.Class, core.space.Model, {
      extends: serverCore.class.TxValidator
    } as unknown as Data<Class<Doc>>)

    await expect(middleware.tx(makeCtx(), [tx])).rejects.toMatchObject({
      status: expect.objectContaining({ code: platform.status.Forbidden })
    })
    expect(next.tx).not.toHaveBeenCalled()
  })

  it('logs unexpected validator errors without exposing details to the client', async () => {
    const error = new Error('confidential adapter failure')
    validate.mockRejectedValueOnce(error)
    const { middleware, next } = await makeMiddleware([makeValidator()])
    const ctx = makeCtx()
    const log = jest.spyOn(ctx, 'error').mockImplementation(() => {})

    const expectation = expect(middleware.tx(ctx, [createTx()])).rejects
    await expectation.toMatchObject({
      status: expect.objectContaining({ code: platform.status.InternalServerError, params: {} })
    })
    await expectation.not.toThrow('confidential adapter failure')
    expect(log).toHaveBeenCalledWith(
      'Transaction validator failed',
      expect.objectContaining({ resource: validatorResource, objectClass: testClass, err: error })
    )
    expect(next.tx).not.toHaveBeenCalled()
  })

  it('allows system transactions to manage validator documents without runtime registration', async () => {
    const { middleware, next } = await makeMiddleware()
    const tx = factory.createTxCreateDoc(serverCore.class.TxValidator, core.space.Model, {
      validator: validatorResource,
      objectClass: testClass
    })

    await middleware.tx(makeCtx(systemAccount), [tx])

    expect(next.tx).toHaveBeenCalledWith(expect.anything(), [tx])
    expect(validate).not.toHaveBeenCalled()
  })

  it('ignores validators outside the system model', async () => {
    const { middleware, next } = await makeMiddleware([{ ...makeValidator(), modifiedBy: account.primarySocialId }])
    const tx = createTx()

    await middleware.tx(makeCtx(), [tx])

    expect(next.tx).toHaveBeenCalledWith(expect.anything(), [tx])
    expect(validate).not.toHaveBeenCalled()
  })

  it('limits a missing resource failure to its object class', async () => {
    const missing = {
      ...makeValidator(),
      validator: `${testPluginId}:validator:Missing` as TxValidator['validator']
    }
    const { middleware, next } = await makeMiddleware([missing])

    await expect(middleware.tx(makeCtx(), [createTx()])).rejects.toBeInstanceOf(PlatformError)
    const other = factory.createTxCreateDoc(core.class.Doc, core.space.Workspace, {})
    await middleware.tx(makeCtx(), [other])
    expect(next.tx).toHaveBeenCalledTimes(1)
    expect(next.tx).toHaveBeenCalledWith(expect.anything(), [other])
  })
  describe('classes created at runtime', () => {
    const root = 'test:class:Root' as Ref<Class<Doc>>

    function addClass (hierarchy: Hierarchy, _id: Ref<Class<Doc>>, extendsClass?: Ref<Class<Doc>>): void {
      hierarchy.tx(
        factory.createTxCreateDoc(
          core.class.Class,
          core.space.Model,
          { extends: extendsClass, kind: ClassifierKind.CLASS } as unknown as Data<Class<Doc>>,
          _id
        )
      )
    }

    function createIn (_class: Ref<Class<Doc>>): TxCUD<Doc> {
      return factory.createTxCreateDoc(_class, core.space.Workspace, {})
    }

    it('validates a subclass created after the middleware was built', async () => {
      const { middleware, next, hierarchy } = await makeMiddleware([makeValidator()])
      addClass(hierarchy, root)
      addClass(hierarchy, testClass, root)
      const subclass = 'test:class:RuntimeSub' as Ref<Class<Doc>>
      const before = createIn(testClass)
      await middleware.tx(makeCtx(), [before])
      expect(validate).toHaveBeenCalledTimes(1)

      addClass(hierarchy, subclass, testClass)
      const tx = createIn(subclass)
      await middleware.tx(makeCtx(), [tx])

      expect(validate).toHaveBeenCalledTimes(2)
      expect(validate).toHaveBeenLastCalledWith([tx], expect.anything())
      expect(next.tx).toHaveBeenCalledTimes(2)
    })

    it('does not cache a miss for a class that is created later', async () => {
      const { middleware, hierarchy } = await makeMiddleware([makeValidator()])
      addClass(hierarchy, root)
      addClass(hierarchy, testClass, root)
      const late = 'test:class:Late' as Ref<Class<Doc>>

      await middleware.tx(makeCtx(), [createIn(late)])
      expect(validate).not.toHaveBeenCalled()

      addClass(hierarchy, late, testClass)
      await middleware.tx(makeCtx(), [createIn(late)])
      expect(validate).toHaveBeenCalledTimes(1)
    })

    it('does not validate unrelated classes after other classes are created', async () => {
      const { middleware, hierarchy } = await makeMiddleware([makeValidator()])
      addClass(hierarchy, root)
      addClass(hierarchy, testClass, root)
      const unrelated = 'test:class:Unrelated' as Ref<Class<Doc>>
      addClass(hierarchy, unrelated, root)
      await middleware.tx(makeCtx(), [createIn(unrelated)])

      addClass(hierarchy, 'test:class:Another' as Ref<Class<Doc>>, testClass)
      await middleware.tx(makeCtx(), [createIn(unrelated)])

      expect(validate).not.toHaveBeenCalled()
    })

    it('follows a class that is moved below the validated class', async () => {
      const { middleware, hierarchy } = await makeMiddleware([makeValidator()])
      addClass(hierarchy, root)
      addClass(hierarchy, testClass, root)
      const moved = 'test:class:Moved' as Ref<Class<Doc>>
      addClass(hierarchy, moved, root)
      await middleware.tx(makeCtx(), [createIn(moved)])
      expect(validate).not.toHaveBeenCalled()

      const update = { extends: testClass } as unknown as DocumentUpdate<Doc>
      hierarchy.tx(factory.createTxUpdateDoc(core.class.Class, core.space.Model, moved, update))
      await middleware.tx(makeCtx(), [createIn(moved)])

      expect(validate).toHaveBeenCalledTimes(1)
    })
  })
})
