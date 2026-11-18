import core, { type Class, type IdMap, type Ref, type Status } from '@hcengineering/core'
import type { Asset } from '@hcengineering/platform'
import task, {
  type ProjectStatus,
  type ProjectType,
  type ProjectTypeDescriptor,
  type TaskType
} from '@hcengineering/task'
import type { Project } from '@hcengineering/tracker'
import { getStatusProjectType } from '../components/issues/status-project-type'

const statusId = (id: string): Ref<Status> => id as Ref<Status>
const typeId = (id: string): Ref<ProjectType> => id as Ref<ProjectType>

function projectStatus (id: string, options: { color?: number, icon?: Asset } = {}): ProjectStatus {
  const value: ProjectStatus = {
    _id: statusId(id),
    taskType: 'test:taskType' as Ref<TaskType>,
    ...options
  }
  return value
}

function projectType (id: string, statuses: ProjectStatus[]): ProjectType {
  const value: ProjectType = {
    _id: typeId(id),
    _class: task.class.ProjectType,
    space: core.space.Model,
    modifiedOn: 0,
    modifiedBy: core.account.System,
    name: id,
    descriptor: 'test:projectTypeDescriptor' as Ref<ProjectTypeDescriptor>,
    tasks: [],
    description: '',
    statuses,
    targetClass: 'test:class:Project' as Ref<Class<Project>>,
    classic: false,
    roles: 0
  }
  return value
}

const plain = projectType('plain', [projectStatus('open')])
const colored = projectType('colored', [projectStatus('open', { color: 0 })])
const icon = projectType('icon', [projectStatus('open', { icon: 'custom' as Asset })])
const other = projectType('other', [projectStatus('closed', { color: 4 })])
const types: IdMap<ProjectType> = new Map([
  [plain._id, plain],
  [colored._id, colored],
  [icon._id, icon],
  [other._id, other]
])

describe('status colors in group and Kanban headers', () => {
  it('passes the selected project type even when it is not joined', () => {
    expect(getStatusProjectType(statusId('open'), typeId('selected'), types, [colored._id])).toBe(typeId('selected'))
  })

  it('prefers an explicit color, including color zero, over an unconfigured match', () => {
    expect(getStatusProjectType(statusId('open'), undefined, types, [plain._id, colored._id])).toBe(colored._id)
  })

  it('uses a configured icon when no earlier match configures a color', () => {
    expect(getStatusProjectType(statusId('open'), undefined, types, [plain._id, icon._id])).toBe(icon._id)
  })

  it('falls back to the first joined type containing the status', () => {
    expect(getStatusProjectType(statusId('open'), undefined, types, [typeId('missing'), other._id, plain._id])).toBe(
      plain._id
    )
  })

  it('does not select a type outside the joined projects', () => {
    expect(getStatusProjectType(statusId('open'), undefined, types, [other._id])).toBeUndefined()
    expect(getStatusProjectType(statusId('open'), undefined, types, [])).toBeUndefined()
  })
})
