// SPDX-License-Identifier: EPL-2.0

import core, {
  type AnyAttribute,
  type Class,
  type Client,
  type Doc,
  type PersonId,
  type Ref,
  type RefTo,
  type Status,
  getCurrentAccount
} from '@hcengineering/core'
import { getName, getPersonByPersonId } from '@hcengineering/contact'
import { ATTRIBUTE_FIELD_PREFIX, type BuiltinField, type FieldValues, extractFields } from '@hcengineering/branding'
import { getMetadata, type IntlString, translate } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'
import { getDocIdentifier, getDocTitle } from '@hcengineering/view-resources'
import { languageStore } from '@hcengineering/ui'
import { get } from 'svelte/store'
import { Analytics } from '@hcengineering/analytics'

import branding from './plugin'

export interface FieldInfo {
  key: string
  label: IntlString
}

export const BUILTIN_FIELD_LABELS: Record<BuiltinField, IntlString> = {
  title: branding.string.FieldTitle,
  identifier: branding.string.FieldIdentifier,
  version: branding.string.FieldVersion,
  status: branding.string.FieldStatus,
  author: branding.string.FieldAuthor,
  modifiedBy: branding.string.FieldModifiedBy,
  createdOn: branding.string.FieldCreatedOn,
  modifiedOn: branding.string.FieldModifiedOn,
  space: branding.string.FieldSpace,
  className: branding.string.FieldClassName,
  workspace: branding.string.FieldWorkspace,
  printedBy: branding.string.FieldPrintedBy,
  printDate: branding.string.FieldPrintDate
}

export const PAGE_FIELD_LABELS: Record<string, IntlString> = {
  pageNumber: branding.string.FieldPageNumber,
  totalPages: branding.string.FieldTotalPages
}

export function getFieldInfos (withPageFields: boolean): FieldInfo[] {
  const result: FieldInfo[] = Object.entries(BUILTIN_FIELD_LABELS).map(([key, label]) => ({ key, label }))
  if (withPageFields) {
    result.push(...Object.entries(PAGE_FIELD_LABELS).map(([key, label]) => ({ key, label })))
  }
  return result
}

function formatDate (value: number | Date | undefined): string {
  if (value === undefined || value === null) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(get(languageStore) ?? undefined, { year: 'numeric', month: 'long', day: 'numeric' })
}

async function personName (client: Client, personId: PersonId | undefined): Promise<string> {
  if (personId === undefined) return ''
  const person = await getPersonByPersonId(client, personId)
  return person != null ? getName(client.getHierarchy(), person) : ''
}

async function resolveVersion (doc: Doc): Promise<string> {
  const value = doc as unknown as Record<string, unknown>
  if (typeof value.major === 'number' && typeof value.minor === 'number') {
    return `${value.major}.${value.minor}`
  }
  if (typeof value.version === 'number' || typeof value.version === 'string') {
    return String(value.version)
  }
  return ''
}

async function resolveStatus (client: Client, doc: Doc): Promise<string> {
  const value = doc as unknown as Record<string, unknown>
  if (typeof value.status === 'string' && value.status !== '') {
    const status = await client.findOne(core.class.Status, { _id: value.status as Ref<Status> })
    if (status !== undefined) return status.name
  }
  if (typeof value.state === 'string') {
    return value.state
  }
  return ''
}

async function formatAttribute (client: Client, doc: Doc, attr: AnyAttribute): Promise<string> {
  const value = (doc as unknown as Record<string, unknown>)[attr.name]
  if (value === undefined || value === null) return ''
  const typeClass = attr.type._class
  if (typeClass === core.class.TypeDate || typeClass === core.class.TypeTimestamp) {
    return formatDate(value as number)
  }
  if (typeClass === core.class.RefTo && typeof value === 'string') {
    const to = (attr.type as RefTo<Doc>).to
    return (await getDocTitle(client, value as Ref<Doc>, to)) ?? ''
  }
  if (typeClass === core.class.TypeBoolean) {
    return value === true ? '✓' : ''
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value)
  }
  return ''
}

/**
 * Resolve values for every field used by the template texts.
 */
export async function resolveFieldValues (client: Client, doc: Doc, texts: string[]): Promise<FieldValues> {
  const used = new Set(texts.flatMap((t) => extractFields(t)))
  const hierarchy = client.getHierarchy()
  const language = get(languageStore)
  const values: FieldValues = {}

  const resolvers: Record<BuiltinField, () => Promise<string>> = {
    title: async () => (await getDocTitle(client, doc._id, doc._class, doc)) ?? '',
    identifier: async () => (await getDocIdentifier(client, doc._id, doc._class, doc)) ?? '',
    version: async () => await resolveVersion(doc),
    status: async () => await resolveStatus(client, doc),
    author: async () => await personName(client, doc.createdBy ?? doc.modifiedBy),
    modifiedBy: async () => await personName(client, doc.modifiedBy),
    createdOn: async () => formatDate(doc.createdOn),
    modifiedOn: async () => formatDate(doc.modifiedOn),
    space: async () => (await client.findOne(core.class.Space, { _id: doc.space }))?.name ?? '',
    className: async () => await translate(hierarchy.getClass(doc._class).label, {}, language),
    workspace: async () => getMetadata(presentation.metadata.WorkspaceName) ?? '',
    printedBy: async () => await personName(client, getCurrentAccount().primarySocialId),
    printDate: async () => formatDate(Date.now())
  }

  const attributes = hierarchy.getAllAttributes(doc._class)

  await Promise.all(
    Array.from(used).map(async (key) => {
      try {
        if (key in resolvers) {
          values[key] = await resolvers[key as BuiltinField]()
        } else if (key.startsWith(ATTRIBUTE_FIELD_PREFIX)) {
          const attr = attributes.get(key.slice(ATTRIBUTE_FIELD_PREFIX.length))
          values[key] = attr !== undefined ? await formatAttribute(client, doc, attr) : ''
        }
      } catch (err: unknown) {
        Analytics.handleError(err instanceof Error ? err : new Error(String(err)))
        values[key] = ''
      }
    })
  )
  return values
}

/**
 * Attributes of the class that can be referenced with `{{attr:<key>}}`.
 */
export function getAttributeFields (client: Client, _class: Ref<Class<Doc>>): FieldInfo[] {
  const hierarchy = client.getHierarchy()
  const supported = [
    core.class.TypeString,
    core.class.TypeNumber,
    core.class.TypeBoolean,
    core.class.TypeDate,
    core.class.TypeTimestamp,
    core.class.RefTo
  ]
  return Array.from(hierarchy.getAllAttributes(_class).values())
    .filter((attr) => attr.hidden !== true && attr.label !== undefined && supported.includes(attr.type._class))
    .map((attr) => ({ key: `${ATTRIBUTE_FIELD_PREFIX}${attr.name}`, label: attr.label }))
}
