// SPDX-License-Identifier: EPL-2.0

import { generateId } from '@hcengineering/core'
import gitlab, { gitlabMergeRequestStates } from '@hcengineering/gitlab'
import type { TaskTypeWithFactory } from '@hcengineering/task'
import tracker, { createStatesData } from '@hcengineering/tracker'

/** The merge request task type the pod adds to a project type that has none. */
export function mergeRequestTaskTypeData (): TaskTypeWithFactory {
  return {
    _id: generateId(),
    descriptor: gitlab.descriptors.MergeRequest,
    kind: 'both',
    // A model name, not shown translated; the descriptor's IntlString labels the type in the UI
    name: 'Merge request',
    ofClass: gitlab.class.GitlabMergeRequest,
    statusCategories: gitlabMergeRequestStates.map((it) => it.category),
    statusClass: tracker.class.IssueStatus,
    icon: gitlab.icon.MergeRequest,
    color: 0,
    allowedAsChildOf: [],
    factory: createStatesData(gitlabMergeRequestStates)
  }
}
