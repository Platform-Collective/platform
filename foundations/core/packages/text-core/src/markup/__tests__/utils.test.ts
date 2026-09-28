import { hashAttrs, isEmptyMarkup, jsonToMarkup, stripHash } from '../utils'
import { MarkupNodeType } from '../model'
import { nodeDoc, nodeGif, nodeParagraph, nodeText } from '../dsl'

describe('hashAttrs', () => {
  it('should return a hash of length 8', () => {
    const attrs = { a: 1 }
    const hash = hashAttrs(attrs)
    expect(hash.length).toEqual(8)
  })
  it('should return the same hash for the same attrs', () => {
    const attrs = { a: 1, b: 2 }
    const hash1 = hashAttrs(attrs)
    const hash2 = hashAttrs(attrs)
    expect(hash1).toEqual(hash2)
  })

  it('should return different hashes for different attrs', () => {
    const attrs1 = { a: 1, b: 2 }
    const attrs2 = { a: 1, b: 3 }
    const hash1 = hashAttrs(attrs1)
    const hash2 = hashAttrs(attrs2)
    expect(hash1).not.toEqual(hash2)
  })
})

describe('stripHash', () => {
  it('should return the name without the hash', () => {
    const name = 'bold--c0decafe'
    const result = stripHash(name)
    expect(result).toEqual('bold')
  })

  it('should return the original name if no hash is present', () => {
    const name = 'bold'
    const result = stripHash(name)
    expect(result).toEqual(name)
  })

  it('should return the original name if the hash is not 8 characters long', () => {
    const name = 'bold--1234567'
    const result = stripHash(name)
    expect(result).toEqual(name)
  })

  it('should return the original name if the hash is not a valid base64 string', () => {
    const name = 'bold--invalid!'
    const result = stripHash(name)
    expect(result).toEqual(name)
  })
})

describe('isEmptyMarkup with a gif node', () => {
  // the enum entry must exist, or every serializer case for gif is unreachable.
  it('should define MarkupNodeType.gif', () => {
    expect(MarkupNodeType.gif).toBe('gif')
  })

  // a gif-only message must not read as empty, or the composer's send button never
  // enables (ReferenceInput.svelte binds canSubmit to !isEmptyMarkup). emoji is already on
  // the nonEmptyNodes allowlist for exactly this reason.
  it('should not report a document containing only a gif as empty', () => {
    const doc = nodeDoc(nodeParagraph(nodeGif({ 'file-id': 'blob-1', width: 320, height: 240 })))
    expect(isEmptyMarkup(jsonToMarkup(doc))).toBe(false)
  })

  it('should still report a document with an empty paragraph as empty', () => {
    expect(isEmptyMarkup(jsonToMarkup(nodeDoc(nodeParagraph())))).toBe(true)
  })

  it('should still report a document with text as not empty', () => {
    expect(isEmptyMarkup(jsonToMarkup(nodeDoc(nodeParagraph(nodeText('hi')))))).toBe(false)
  })

  it('should report undefined and the empty string as empty', () => {
    expect(isEmptyMarkup(undefined)).toBe(true)
    expect(isEmptyMarkup('')).toBe(true)
  })
})
