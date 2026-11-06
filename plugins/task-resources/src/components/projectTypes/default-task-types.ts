// SPDX-License-Identifier: EPL-2.0

import { generateId, type TxOperations } from '@hcengineering/core'
import type { ProjectTypeDescriptor, TaskType, TaskTypeWithFactory } from '@hcengineering/task'

export function getDefaultTaskTypes (client: TxOperations, descriptor: ProjectTypeDescriptor): TaskTypeWithFactory[] {
  if (descriptor.defaultTaskType === undefined) return []

  const model = client.getModel()
  const template = model.findObject(descriptor.defaultTaskType)
  if (template === undefined) {
    throw new Error(`Default task type not found: ${descriptor.defaultTaskType}`)
  }

  const factory = template.statuses.map((id) => {
    const status = model.findObject(id)
    if (status === undefined) {
      throw new Error(`Default task type status not found: ${id}`)
    }
    const { name, ofAttribute, category, color, description } = status
    return { name, ofAttribute, category, color, description }
  })
  const taskId = generateId<TaskType>()
  return [
    {
      _id: taskId,
      name: template.name,
      descriptor: template.descriptor,
      kind: template.kind,
      ofClass: template.ofClass,
      statusClass: template.statusClass,
      statusCategories: [...template.statusCategories],
      allowedAsChildOf: template.allowedAsChildOf?.map((id) => (id === template._id ? taskId : id)),
      color: template.color,
      factory
    }
  ]
}
