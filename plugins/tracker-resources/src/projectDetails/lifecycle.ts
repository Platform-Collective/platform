//
// Copyright © 2026 Hardcore Engineering Inc.
// SPDX-License-Identifier: EPL-2.0
//

import type { TxOperations } from '@hcengineering/core'
import { canMakeProjectPrivate, isDeleteConfirmed, type Project } from '@hcengineering/tracker'

// The settings of a project that GitHub keeps in its danger zone, mapped on what Huly has:
//  - "Close project" is the archive of the space (hidden from the lists, not offered when creating issues), "Reopen
//    project" restores it;
//  - visibility private / public is `Space.private`;
//  - "Make template" is the `isTemplate` flag;
//  - deleting a project asks for its name.

export class ProjectSettingsError extends Error {
  constructor (readonly code: 'nameMismatch' | 'noMembers', message: string) {
    super(message)
    this.name = 'ProjectSettingsError'
  }
}

type Writer = Pick<TxOperations, 'update' | 'remove'>

/** Closes the project (archives the space). */
export async function closeProject (client: Writer, project: Project): Promise<void> {
  if (project.archived) return
  await client.update(project, { archived: true })
}

/** Reopens a closed project. */
export async function reopenProject (client: Writer, project: Project): Promise<void> {
  if (!project.archived) return
  await client.update(project, { archived: false })
}

/** Makes the project private or public. A private project must keep an owner among its members. */
export async function setProjectVisibility (client: Writer, project: Project, isPrivate: boolean): Promise<void> {
  if (project.private === isPrivate) return
  if (isPrivate && !canMakeProjectPrivate(project)) {
    throw new ProjectSettingsError('noMembers', 'A private project needs an owner among its members')
  }
  await client.update(project, { private: isPrivate })
}

/** Marks the project as a template or takes the mark away. */
export async function setProjectTemplate (client: Writer, project: Project, isTemplate: boolean): Promise<void> {
  if ((project.isTemplate ?? false) === isTemplate) return
  await client.update(project, { isTemplate })
}

/** Deletes the project for good, after the name was typed. The server removes everything that belongs to it. */
export async function deleteProjectConfirmed (client: Writer, project: Project, typedName: string): Promise<void> {
  if (!isDeleteConfirmed(project.name, typedName)) {
    throw new ProjectSettingsError('nameMismatch', 'The typed name is not the name of the project')
  }
  await client.remove(project)
}
