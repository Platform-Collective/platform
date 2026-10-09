// SPDX-License-Identifier: EPL-2.0

import attachment from '@hcengineering/attachment'
import core, { type Blob, type Markup, type MeasureContext, type Ref, type TxOperations } from '@hcengineering/core'
import gitlab, {
  imageModeOf,
  type GitlabIntegration,
  type GitlabUpload,
  type GitlabUploadOrigin
} from '@hcengineering/gitlab'
import type { GitlabApi } from '../gitlab/api'
import type { MarkdownConverter } from '../markdown'
import { errorMessage } from './errors'
import {
  hasHulyImages,
  inboundImagePaths,
  outboundImages,
  rewriteInbound,
  rewriteOutbound,
  uploadName,
  type UploadTarget
} from './image-links'
import type { ImageStore, RepositoryContext } from './types'

// Larger files are linked, not copied
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export interface ContentDeps {
  ctx: MeasureContext
  markdown: MarkdownConverter
  // Undefined without blob storage: nothing is copied
  images?: ImageStore
  // GitlabUpload records (System)
  derived: TxOperations
  integrationApi: (integration: GitlabIntegration) => Promise<GitlabApi | undefined>
}

function targetOf (repo: RepositoryContext): UploadTarget {
  return { host: repo.integration.host, webUrl: repo.repository.webUrl, projectId: repo.repository.projectId }
}

/**
 * GitLab markdown and Huly markup of one repository, with images linked or copied between them.
 * Copy failures degrade to links and never fail the caller, except `uploadFile` for attachments.
 */
export class ContentConverter {
  constructor (private readonly deps: ContentDeps) {}

  private get imageUrl (): string {
    return this.deps.markdown.urls.imageUrl
  }

  async toMarkup (repo: RepositoryContext, markdown: string | null | undefined): Promise<Markup> {
    if (markdown == null || markdown === '') return ''
    const target = targetOf(repo)
    const files = new Map<string, string>()
    for (const path of inboundImagePaths(markdown, target)) {
      const file = await this.importUpload(repo, path)
      if (file !== undefined) files.set(path, file)
    }
    return this.deps.markdown.toMarkup(rewriteInbound(markdown, target, files, this.imageUrl))
  }

  async toMarkdown (repo: RepositoryContext, markup: Markup): Promise<string> {
    const markdown = this.deps.markdown.toMarkdown(markup)
    const paths = new Map<string, string>()
    for (const image of outboundImages(markdown, this.imageUrl)) {
      if (paths.has(image.file)) continue
      try {
        const path = await this.uploadFile(repo, image.file, image.alt)
        if (path !== undefined) paths.set(image.file, path)
      } catch (err: unknown) {
        // The Huly link stays; the description repair or the next change sends it again
        this.deps.ctx.warn('gitlab image not uploaded, Huly link kept', { file: image.file, error: errorMessage(err) })
      }
    }
    return rewriteOutbound(markdown, targetOf(repo), paths, this.imageUrl)
  }

  hasHulyImages (markdown: string | null | undefined): boolean {
    return hasHulyImages(markdown, this.imageUrl)
  }

  /**
   * The GitLab path of a Huly file, uploaded once. Undefined when it cannot be copied (no storage, not attached in the
   * repository's project, no such file, too large). Throws when GitLab refuses the upload.
   */
  async uploadFile (repo: RepositoryContext, file: string, name: string | undefined): Promise<string | undefined> {
    const known = await this.deps.derived.findOne(gitlab.class.GitlabUpload, {
      repository: repo.repository._id,
      file: file as Ref<Blob>
    })
    if (known !== undefined) return known.path
    const { images, ctx } = this.deps
    if (images === undefined) return undefined
    // Only files Huly ties to this repository's project: a link typed into GitLab text must not copy any file out
    if (!(await this.isProjectFile(repo, file))) {
      ctx.warn('gitlab: Huly file not copied, not attached in the project', { file, project: repo.project._id })
      return undefined
    }
    // Check the size first: a large file is never loaded
    const stat = await images.stat(ctx, file)
    if (stat === undefined || stat.size > MAX_IMAGE_BYTES) {
      ctx.warn('gitlab: Huly file not copied, missing or too large', { file, size: stat?.size })
      return undefined
    }
    const blob = await images.read(ctx, file)
    if (blob === undefined || blob.data.length > MAX_IMAGE_BYTES) {
      ctx.warn('gitlab: Huly file not copied, missing or too large', { file, size: blob?.data.length })
      return undefined
    }
    const api = await this.deps.integrationApi(repo.integration)
    if (api === undefined) throw new Error('GitLab authorization expired')
    const uploaded = await api.uploadFile(
      repo.repository.projectId,
      uploadName(name, blob.contentType),
      blob.data,
      blob.contentType
    )
    await this.record(repo, uploaded.url, file, 'huly')
    return uploaded.url
  }

  // The Huly copy of a GitLab upload: recorded, downloaded now, or undefined when it cannot be copied
  private async importUpload (repo: RepositoryContext, path: string): Promise<string | undefined> {
    const known = await this.deps.derived.findOne(gitlab.class.GitlabUpload, { repository: repo.repository._id, path })
    const copy = imageModeOf(repo.integration) === 'copy'
    // In link mode only Huly's own files stay; downloaded copies give way to GitLab links
    if (known !== undefined && (copy || known.origin === 'huly')) return known.file
    if (!copy) return undefined
    const { images, ctx } = this.deps
    if (images === undefined) return undefined
    try {
      const api = await this.deps.integrationApi(repo.integration)
      if (api === undefined) return undefined
      // '/uploads/<secret>/<name>'
      const [, , secret, name] = path.split('/')
      const { data, contentType } = await api.downloadUpload(repo.repository.projectId, secret, name, MAX_IMAGE_BYTES)
      const file = await images.put(ctx, data, contentType)
      await this.record(repo, path, file, 'gitlab')
      return file
    } catch (err: unknown) {
      ctx.warn('gitlab image not copied to Huly, linked to GitLab instead', { path, error: errorMessage(err) })
      return undefined
    }
  }

  // A file attached to a document of the repository's Huly project, as a pasted image or a comment attachment is
  private async isProjectFile (repo: RepositoryContext, file: string): Promise<boolean> {
    const found = await this.deps.derived.findOne(attachment.class.Attachment, {
      space: repo.project._id,
      file: file as Ref<Blob>
    })
    return found !== undefined
  }

  private async record (repo: RepositoryContext, path: string, file: string, origin: GitlabUploadOrigin): Promise<void> {
    await this.deps.derived.createDoc<GitlabUpload>(gitlab.class.GitlabUpload, core.space.Workspace, {
      repository: repo.repository._id,
      path,
      file: file as Ref<Blob>,
      origin
    })
  }
}
