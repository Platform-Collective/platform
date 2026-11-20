// SPDX-License-Identifier: EPL-2.0

import { type Data, type PluginConfiguration } from '@hcengineering/core'
import { type Builder, type MigrateOperation } from '@hcengineering/model'
import { type Plugin } from '@hcengineering/platform'

export interface ConfigurablePlugin extends Omit<Data<PluginConfiguration>, 'pluginId' | 'transactions'> {}

export type BuilderConfig =
  | [(b: Builder) => void, Plugin]
  | [(b: Builder) => void, Plugin, ConfigurablePlugin | undefined]

export const extraModelBuilders: BuilderConfig[] = []
export const extraMigrateOperations: [string, MigrateOperation][] = []
