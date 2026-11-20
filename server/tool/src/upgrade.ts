import {
  type Doc,
  type DocumentQuery,
  type Domain,
  type FindOptions,
  type Hierarchy,
  type LowLevelStorage,
  type MeasureContext,
  MeasureMetricsContext,
  type ModelDb,
  type Ref,
  type WorkspaceIds,
  type Class
} from '@hcengineering/core'
import {
  type MigrateMode,
  type MigrateUpdate,
  type MigrationClient,
  type MigrationFailure,
  type MigrationIterator,
  type ModelLogger
} from '@hcengineering/model'
import {
  type Pipeline,
  type StorageAdapter,
  workspaceEvents,
  type PlatformQueueProducer,
  type QueueWorkspaceMessage
} from '@hcengineering/server-core'
import { type AccountClient } from '@hcengineering/account-client'

/**
 * Operator allow list of migrations (`plugin/state`, comma separated) whose failure does not fail an upgrade.
 * Empty by default, so every failed migration fails the upgrade.
 */
export const TOLERATED_MIGRATION_FAILURES_ENV = 'UPGRADE_TOLERATED_MIGRATION_FAILURES'

function getToleratedMigrationFailures (): Set<string> {
  const value = process.env[TOLERATED_MIGRATION_FAILURES_ENV] ?? ''
  return new Set(
    value
      .split(',')
      .map((it) => it.trim())
      .filter((it) => it !== '')
  )
}

/**
 * Reports all migrations that failed during one upgrade run. They have no MigrationState, so they
 * run again next time. In upgrade mode the upgrade fails, so the workspace is not marked as upgraded
 * and the upgrade is retried, unless an operator listed every failed migration in
 * UPGRADE_TOLERATED_MIGRATION_FAILURES; on workspace creation the failures are only logged.
 */
export function reportMigrationFailures (
  ctx: MeasureContext,
  logger: ModelLogger,
  wsIds: WorkspaceIds,
  mode: MigrateMode,
  ...failureGroups: Array<readonly MigrationFailure[] | undefined>
): void {
  const failures = failureGroups.flatMap((it) => it ?? [])
  if (failures.length === 0) return
  const names = failures.map(({ plugin, state }) => `${plugin}/${state}`)
  const message = `Upgrade completed with ${names.length} failed migrations: ${names.join(', ')}`
  logger.error(message, { workspaceId: wsIds, failures: names })
  ctx.error(message, { workspaceId: wsIds, failures: names })
  if (mode !== 'upgrade') return
  const tolerated = getToleratedMigrationFailures()
  if (names.every((it) => tolerated.has(it))) {
    const warning = `Upgrade continues despite ${names.length} failed migrations tolerated by ${TOLERATED_MIGRATION_FAILURES_ENV}: ${names.join(', ')}`
    logger.log(warning, { workspaceId: wsIds, failures: names })
    ctx.warn(warning, { workspaceId: wsIds, failures: names })
    return
  }
  throw new Error(`${names.length} migrations failed and remain pending: ${names.join(', ')}`)
}

/**
 * Upgrade client implementation.
 */
export class MigrateClientImpl implements MigrationClient {
  private readonly lowLevel: LowLevelStorage
  readonly ctx: MeasureContext
  constructor (
    readonly pipeline: Pipeline,
    readonly hierarchy: Hierarchy,
    readonly model: ModelDb,
    readonly logger: ModelLogger,
    readonly storageAdapter: StorageAdapter,
    readonly accountClient: AccountClient,
    readonly wsIds: WorkspaceIds,
    readonly queue: PlatformQueueProducer<QueueWorkspaceMessage>,
    ctx?: MeasureContext
  ) {
    if (this.pipeline.context.lowLevelStorage === undefined) {
      throw new Error('lowLevelStorage is not defined')
    }
    this.lowLevel = this.pipeline.context.lowLevelStorage
    this.ctx = ctx ?? new MeasureMetricsContext('migrateClient', {})
  }

  migrateState = new Map<string, Set<string>>()
  migrationFailures: MigrationFailure[] = []

  async find<T extends Doc> (
    domain: Domain,
    query: DocumentQuery<T>,
    options?: FindOptions<T> | undefined
  ): Promise<T[]> {
    return await this.lowLevel.rawFindAll(domain, query, options)
  }

  async groupBy<T, P extends Doc> (domain: Domain, field: string, query?: DocumentQuery<P>): Promise<Map<T, number>> {
    return await this.lowLevel.groupBy(this.ctx, domain, field, query)
  }

  async traverse<T extends Doc> (
    domain: Domain,
    query: DocumentQuery<T>,
    options?: FindOptions<T> | undefined
  ): Promise<MigrationIterator<T>> {
    return await this.lowLevel.traverse(domain, query, options)
  }

  async update<T extends Doc> (domain: Domain, query: DocumentQuery<T>, operations: MigrateUpdate<T>): Promise<void> {
    const t = Date.now()
    try {
      await this.lowLevel.rawUpdate(domain, query, operations)
    } finally {
      if (Date.now() - t > 1000) {
        this.logger.log(`update${Date.now() - t > 5000 ? 'slow' : ''}`, { domain, query, time: Date.now() - t })
      }
    }
  }

  async bulk<T extends Doc> (
    domain: Domain,
    operations: { filter: DocumentQuery<T>, update: MigrateUpdate<T> }[]
  ): Promise<void> {
    for (const ops of operations) {
      await this.lowLevel.rawUpdate(domain, ops.filter, ops.update)
    }
  }

  async move<T extends Doc> (
    sourceDomain: Domain,
    query: DocumentQuery<T>,
    targetDomain: Domain,
    size = 500
  ): Promise<void> {
    const ctx = new MeasureMetricsContext('move', {})
    this.logger.log('move', { sourceDomain, query })
    while (true) {
      const source = await this.lowLevel.rawFindAll(sourceDomain, query, { limit: size })
      if (source.length === 0) break
      await this.lowLevel.upload(ctx, targetDomain, source)
      await this.lowLevel.clean(
        ctx,
        sourceDomain,
        source.map((p) => p._id)
      )
    }
  }

  async create<T extends Doc> (domain: Domain, doc: T | T[]): Promise<void> {
    const ctx = new MeasureMetricsContext('create', {})
    await this.lowLevel.upload(ctx, domain, Array.isArray(doc) ? doc : [doc])
  }

  async delete<T extends Doc> (domain: Domain, _id: Ref<T>): Promise<void> {
    const ctx = new MeasureMetricsContext('delete', {})
    await this.lowLevel.clean(ctx, domain, [_id])
  }

  async deleteMany<T extends Doc> (domain: Domain, query: DocumentQuery<T>): Promise<void> {
    await this.lowLevel.rawDeleteMany(domain, query)
  }

  async domainExists (domain: Domain): Promise<boolean> {
    const adapter = this.pipeline.context.adapterManager?.getAdapter(domain, false)
    const helper = adapter?.helper?.()
    return helper !== undefined ? await helper.exists(domain) : true
  }

  async fullReindex (): Promise<void> {
    await this.queue.send(this.ctx, this.wsIds.uuid, [workspaceEvents.fullReindex()])
  }

  async reindex (domain: Domain, classes: Ref<Class<Doc>>[]): Promise<void> {
    await this.queue.send(this.ctx, this.wsIds.uuid, [workspaceEvents.reindex(domain, classes)])
  }
}
