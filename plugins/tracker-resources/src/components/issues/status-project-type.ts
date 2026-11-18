// SPDX-License-Identifier: EPL-2.0

import type { IdMap, Ref, Status } from '@hcengineering/core'
import type { ProjectType } from '@hcengineering/task'

export function getStatusProjectType (
  status: Ref<Status>,
  selectedProjectType: Ref<ProjectType> | undefined,
  projectTypes: IdMap<ProjectType>,
  joinedProjectTypes: Array<Ref<ProjectType>>
): Ref<ProjectType> | undefined {
  if (selectedProjectType !== undefined) return selectedProjectType
  let fallback: Ref<ProjectType> | undefined
  for (const typeId of joinedProjectTypes) {
    const projectStatus = projectTypes.get(typeId)?.statuses?.find((it) => it._id === status)
    if (projectStatus === undefined) continue
    if (projectStatus.color !== undefined || projectStatus.icon !== undefined) return typeId
    fallback = fallback ?? typeId
  }
  return fallback
}
