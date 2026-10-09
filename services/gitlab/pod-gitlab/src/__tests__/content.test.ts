// SPDX-License-Identifier: EPL-2.0
/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles */
import attachment from '@hcengineering/attachment'
import gitlab from '@hcengineering/gitlab'
import { GitlabApiError, GitlabReadonlyError } from '../gitlab/api'
import { createMarkdownConverter } from '../markdown'
import { ContentConverter, MAX_IMAGE_BYTES } from '../sync/content'
import { seedRepository, setImageMode } from './helpers/fixtures'
import { createMemoryClient, asTxOperations, type MemoryClient } from './helpers/memory'
import { asApi, ctx, fakeApi, fakeImages, type FakeApi, type FakeImages } from './helpers/provider'

const S = '0123456789abcdef0123456789abcdef'
const PATH = `/uploads/${S}/shot.png`
const IMAGE_URL = 'http://front/files?file='
const markdown = createMarkdownConverter({ refUrl: 'ref://', imageUrl: IMAGE_URL })

interface Env {
  memory: MemoryClient
  api: FakeApi
  images: FakeImages
  content: ContentConverter
  repo: any
}

// A Huly file attached to a document of the repository's project, as a pasted image is
function projectAttachment (memory: MemoryClient, file: string, space = 'prj-1'): void {
  memory.docs.push({
    _id: `att-${file}`,
    _class: attachment.class.Attachment,
    space,
    attachedTo: 'issue-1',
    attachedToClass: 'tracker:class:Issue',
    collection: 'attachments',
    file,
    name: file,
    type: 'image/png',
    size: 1
  })
}

function setup (options: { storage?: boolean, apiAvailable?: boolean } = {}): Env {
  const memory = createMemoryClient()
  const repo = seedRepository(memory)
  // The existing content tests cover copy mode; link mode is tested separately
  setImageMode(repo, 'copy')
  // The Huly test images are pasted into the project; files without an attachment there are tested separately
  projectAttachment(memory, 'huly-1')
  const api = fakeApi({
    downloadUpload: async () => ({ data: Buffer.from('png-bytes'), contentType: 'image/png' }),
    uploadFile: async (_id: number, name: string) => ({
      alt: name,
      url: `/uploads/${S}/${name}`,
      full_path: '',
      markdown: ''
    })
  })
  const images = fakeImages()
  const content = new ContentConverter({
    ctx,
    markdown,
    images: options.storage === false ? undefined : images,
    derived: asTxOperations(memory),
    integrationApi: async () => (options.apiAvailable === false ? undefined : asApi(api))
  })
  return { memory, api, images, content, repo }
}

const uploads = (memory: MemoryClient): any[] => memory.docs.filter((d) => d._class === gitlab.class.GitlabUpload)

describe('ContentConverter: GitLab to Huly', () => {
  it('copies a GitLab image into Huly once and records the pair', async () => {
    const env = setup()
    const first = await env.content.toMarkup(env.repo, `![shot](${PATH})`)
    const second = await env.content.toMarkup(env.repo, `Again ![shot](${PATH})`)
    expect(env.api.downloadUpload).toHaveBeenCalledTimes(1)
    expect(env.api.downloadUpload).toHaveBeenCalledWith(42, S, 'shot.png', MAX_IMAGE_BYTES)
    expect(env.images.blobs.get('blob-1')).toEqual({ data: Buffer.from('png-bytes'), contentType: 'image/png' })
    expect(uploads(env.memory)).toEqual([expect.objectContaining({ repository: 'repo-1', path: PATH, file: 'blob-1' })])
    expect(first).toBe(markdown.toMarkup(`![shot](${IMAGE_URL}blob-1)`))
    expect(second).toBe(markdown.toMarkup(`Again ![shot](${IMAGE_URL}blob-1)`))
  })

  it('links to GitLab when the download fails, without failing', async () => {
    const env = setup()
    env.api.downloadUpload.mockRejectedValue(new GitlabApiError(404, 'not found'))
    const markup = await env.content.toMarkup(env.repo, `![shot](${PATH})`)
    expect(markup).toBe(markdown.toMarkup(`[shot](https://gitlab.example.com/-/project/42${PATH}#gitlab-image)`))
    expect(uploads(env.memory)).toHaveLength(0)
  })

  it('links to GitLab without blob storage', async () => {
    const env = setup({ storage: false })
    const markup = await env.content.toMarkup(env.repo, `![shot](${PATH})`)
    expect(env.api.downloadUpload).not.toHaveBeenCalled()
    expect(markup).toBe(markdown.toMarkup(`[shot](https://gitlab.example.com/-/project/42${PATH}#gitlab-image)`))
  })

  it('maps empty and missing markdown to empty markup', async () => {
    const env = setup()
    expect(await env.content.toMarkup(env.repo, null)).toBe('')
    expect(await env.content.toMarkup(env.repo, '')).toBe('')
  })
})

describe('ContentConverter: Huly to GitLab', () => {
  it('uploads a Huly image once, named after its alt text, and records the pair', async () => {
    const env = setup()
    env.images.blobs.set('huly-1', { data: Buffer.from('jpg-bytes'), contentType: 'image/jpeg' })
    const markup = markdown.toMarkup(`![photo](${IMAGE_URL}huly-1)`)
    expect(await env.content.toMarkdown(env.repo, markup)).toBe(`![photo](/uploads/${S}/photo.jpg)`)
    expect(await env.content.toMarkdown(env.repo, markup)).toBe(`![photo](/uploads/${S}/photo.jpg)`)
    expect(env.api.uploadFile).toHaveBeenCalledTimes(1)
    expect(env.api.uploadFile).toHaveBeenCalledWith(42, 'photo.jpg', Buffer.from('jpg-bytes'), 'image/jpeg')
    expect(uploads(env.memory)).toEqual([
      expect.objectContaining({ repository: 'repo-1', path: `/uploads/${S}/photo.jpg`, file: 'huly-1' })
    ])
  })

  it('reuses the GitLab upload an image was copied from', async () => {
    const env = setup()
    const markup = await env.content.toMarkup(env.repo, `![shot](${PATH})`)
    expect(await env.content.toMarkdown(env.repo, markup)).toBe(`![shot](${PATH})`)
    expect(env.api.uploadFile).not.toHaveBeenCalled()
  })

  it('keeps the Huly link when the upload is refused (read-only mode)', async () => {
    const env = setup()
    env.images.blobs.set('huly-1', { data: Buffer.from('x'), contentType: 'image/png' })
    env.api.uploadFile.mockRejectedValue(new GitlabReadonlyError('POST', '/projects/42/uploads'))
    expect(await env.content.toMarkdown(env.repo, markdown.toMarkup(`![a](${IMAGE_URL}huly-1)`))).toBe(
      `![a](${IMAGE_URL}huly-1)`
    )
  })

  it('does not copy a file larger than the limit', async () => {
    const env = setup()
    env.images.blobs.set('huly-1', { data: Buffer.alloc(MAX_IMAGE_BYTES + 1), contentType: 'image/png' })
    const read = jest.spyOn(env.images, 'read')
    expect(await env.content.uploadFile(env.repo, 'huly-1', 'big.png')).toBeUndefined()
    expect(read).not.toHaveBeenCalled()
    expect(env.api.uploadFile).not.toHaveBeenCalled()
  })

  it('copies nothing without blob storage', async () => {
    const env = setup({ storage: false })
    expect(await env.content.uploadFile(env.repo, 'huly-1', 'a.png')).toBeUndefined()
    expect(env.api.uploadFile).not.toHaveBeenCalled()
  })

  it('keeps the Huly link when the file cannot be read, while uploadFile rejects', async () => {
    const env = setup()
    env.images.blobs.set('huly-1', { data: Buffer.from('x'), contentType: 'image/png' })
    jest.spyOn(env.images, 'read').mockRejectedValue(new Error('gone'))
    expect(await env.content.toMarkdown(env.repo, markdown.toMarkup(`![a](${IMAGE_URL}huly-1)`))).toBe(
      `![a](${IMAGE_URL}huly-1)`
    )
    await expect(env.content.uploadFile(env.repo, 'huly-1', 'a.png')).rejects.toThrow('gone')
  })

  it('uploads a Huly file that appears twice once and rewrites both links', async () => {
    const env = setup()
    env.images.blobs.set('huly-1', { data: Buffer.from('x'), contentType: 'image/png' })
    const markup = markdown.toMarkup(`![a](${IMAGE_URL}huly-1) and ![b](${IMAGE_URL}huly-1)`)
    expect(await env.content.toMarkdown(env.repo, markup)).toBe(
      `![a](/uploads/${S}/a.png) and ![b](/uploads/${S}/a.png)`
    )
    expect(env.api.uploadFile).toHaveBeenCalledTimes(1)
  })

  it('throws from uploadFile when GitLab refuses, so an attachment is retried', async () => {
    const env = setup()
    env.images.blobs.set('huly-1', { data: Buffer.from('x'), contentType: 'image/png' })
    env.api.uploadFile.mockRejectedValue(new GitlabApiError(500, 'boom'))
    await expect(env.content.uploadFile(env.repo, 'huly-1', 'a.png')).rejects.toBeInstanceOf(GitlabApiError)
  })

  it('throws from uploadFile when the GitLab authorization expired', async () => {
    const env = setup({ apiAvailable: false })
    env.images.blobs.set('huly-1', { data: Buffer.from('x'), contentType: 'image/png' })
    await expect(env.content.uploadFile(env.repo, 'huly-1', 'a.png')).rejects.toThrow('GitLab authorization expired')
  })

  it('does not upload a Huly file that is not attached in the project, keeping its link', async () => {
    const env = setup()
    env.images.blobs.set('stranger', { data: Buffer.from('secret'), contentType: 'image/png' })
    const markup = markdown.toMarkup(`![x](${IMAGE_URL}stranger)`)
    expect(await env.content.toMarkdown(env.repo, markup)).toBe(`![x](${IMAGE_URL}stranger)`)
    expect(await env.content.uploadFile(env.repo, 'stranger', 'x')).toBeUndefined()
    expect(env.api.uploadFile).not.toHaveBeenCalled()
  })

  it('does not upload a stored merge request diff', async () => {
    const env = setup()
    env.images.blobs.set('patch-blob', { data: Buffer.from('diff'), contentType: 'text/x-patch' })
    env.memory.docs.push({
      _id: 'patch-1',
      _class: gitlab.class.GitlabPatch,
      space: 'prj-1',
      attachedTo: 'mr-1',
      attachedToClass: gitlab.class.GitlabMergeRequest,
      collection: 'patch',
      file: 'patch-blob',
      size: 4,
      lastModified: 0
    })
    expect(await env.content.uploadFile(env.repo, 'patch-blob', 'x')).toBeUndefined()
    expect(env.api.uploadFile).not.toHaveBeenCalled()
  })

  it('does not upload a Huly file attached in another project', async () => {
    const env = setup()
    env.images.blobs.set('elsewhere', { data: Buffer.from('secret'), contentType: 'image/png' })
    projectAttachment(env.memory, 'elsewhere', 'prj-other')
    expect(await env.content.uploadFile(env.repo, 'elsewhere', 'x')).toBeUndefined()
    expect(env.api.uploadFile).not.toHaveBeenCalled()
  })

  it('uploads a Huly file attached in the project', async () => {
    const env = setup()
    env.images.blobs.set('pasted', { data: Buffer.from('png'), contentType: 'image/png' })
    projectAttachment(env.memory, 'pasted')
    expect(await env.content.uploadFile(env.repo, 'pasted', 'p')).toBe(`/uploads/${S}/p.png`)
    expect(env.api.uploadFile).toHaveBeenCalledTimes(1)
  })

  it('finds Huly image links in GitLab text', () => {
    const env = setup()
    expect(env.content.hasHulyImages(`![a](${IMAGE_URL}huly-1)`)).toBe(true)
    expect(env.content.hasHulyImages(`![a](${PATH})`)).toBe(false)
  })
})

describe('ContentConverter: image mode', () => {
  const linked = markdown.toMarkup(`[shot](https://gitlab.example.com/-/project/42${PATH}#gitlab-image)`)

  it('links GitLab images without downloading them in link mode', async () => {
    const env = setup()
    setImageMode(env.repo, 'link')
    const markup = await env.content.toMarkup(env.repo, `![shot](${PATH})`)
    expect(env.api.downloadUpload).not.toHaveBeenCalled()
    expect(markup).toBe(linked)
    expect(uploads(env.memory)).toHaveLength(0)
  })

  it('records the origin of each copy', async () => {
    const env = setup()
    await env.content.toMarkup(env.repo, `![shot](${PATH})`)
    env.images.blobs.set('huly-1', { data: Buffer.from('jpg'), contentType: 'image/jpeg' })
    await env.content.toMarkdown(env.repo, markdown.toMarkup(`![photo](${IMAGE_URL}huly-1)`))
    expect(uploads(env.memory).map((it) => [it.file, it.origin])).toEqual([
      ['blob-1', 'gitlab'],
      ['huly-1', 'huly']
    ])
  })

  it('stops using downloaded copies after a switch to link mode', async () => {
    const env = setup()
    await env.content.toMarkup(env.repo, `![shot](${PATH})`)
    setImageMode(env.repo, 'link')
    expect(await env.content.toMarkup(env.repo, `![shot](${PATH})`)).toBe(linked)
    expect(env.api.downloadUpload).toHaveBeenCalledTimes(1)
  })

  it('keeps a Huly image uploaded from Huly in link mode', async () => {
    const env = setup()
    setImageMode(env.repo, 'link')
    env.images.blobs.set('huly-1', { data: Buffer.from('jpg'), contentType: 'image/jpeg' })
    const gitlabText = await env.content.toMarkdown(env.repo, markdown.toMarkup(`![photo](${IMAGE_URL}huly-1)`))
    expect(gitlabText).toBe(`![photo](/uploads/${S}/photo.jpg)`)
    expect(await env.content.toMarkup(env.repo, gitlabText)).toBe(markdown.toMarkup(`![photo](${IMAGE_URL}huly-1)`))
  })
})
