// SPDX-License-Identifier: EPL-2.0

interface WordList {
  id: string
  level: number
  tag: 'ul' | 'ol'
  element: HTMLElement
  item: HTMLElement
}

/** Convert Word clipboard structures into HTML understood by the editor schema. */
export function normalizeWordPastedHTML (html: string): string {
  if (!/mso-list\s*:|\bMsoTitle\b/i.test(html)) return html

  // Parse into an inert document. ProseMirror still applies the editor schema afterwards.
  const doc = new DOMParser().parseFromString(html, 'text/html')
  let changed = false

  for (const paragraph of Array.from(doc.querySelectorAll('p'))) {
    if (!Array.from(paragraph.classList).some((name) => name.toLowerCase() === 'msotitle')) continue

    const heading = doc.createElement('h1')
    for (const attribute of Array.from(paragraph.attributes)) {
      try {
        heading.setAttribute(attribute.name, attribute.value)
      } catch {
        // The HTML parser accepts some attribute names (e.g. "=x") that setAttribute rejects; skip them.
      }
    }
    heading.append(...Array.from(paragraph.childNodes))
    paragraph.replaceWith(heading)
    changed = true
  }

  const normalizeLists = (parent: HTMLElement): void => {
    const lists: WordList[] = []

    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType !== Node.ELEMENT_NODE) {
        if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '') lists.length = 0
        continue
      }

      const paragraph = node as HTMLElement
      const match =
        paragraph.tagName === 'P'
          ? /(?:^|;)\s*mso-list\s*:\s*(l\d+)\s+level(\d+)\s+(lfo\d+)/i.exec(paragraph.getAttribute('style') ?? '')
          : null

      if (match === null || parent.tagName === 'LI') {
        lists.length = 0
        normalizeLists(paragraph)
        continue
      }

      const markerSpan = Array.from(paragraph.querySelectorAll('span[style]')).find((span) =>
        /(?:^|;)\s*mso-list\s*:\s*ignore\b/i.test(span.getAttribute('style') ?? '')
      )
      let marker = markerSpan?.textContent?.trim() ?? ''
      if (markerSpan !== undefined) {
        let wrapper = markerSpan.parentElement
        markerSpan.remove()
        // Desktop Word can wrap the marker in an otherwise empty Symbol-font span.
        while (
          wrapper?.tagName === 'SPAN' &&
          Array.from(wrapper.childNodes).every(
            (child) =>
              child.nodeType === Node.COMMENT_NODE ||
              (child.nodeType === Node.TEXT_NODE && child.textContent?.trim() === '')
          )
        ) {
          const outer: HTMLElement | null = wrapper.parentElement
          wrapper.remove()
          wrapper = outer
        }
      } else {
        // Some clipboard producers emit the marker as text rather than an mso-list:Ignore span.
        // Keep ambiguous o/dash bullets without that explicit marker metadata. Letter markers
        // such as A. remain indistinguishable from content in these mso-list paragraphs.
        const walker = doc.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
        let text = walker.nextNode()
        while (text !== null && text.textContent?.trim() === '') text = walker.nextNode()
        const prefix = /^\s*([·•\uf0b7○▪■]|(?:\d+|[a-z])[.)])(?:\s+|$)/i.exec(text?.textContent ?? '')
        if (text !== null && prefix !== null) {
          marker = prefix[1]
          text.textContent = (text.textContent ?? '').slice(prefix[0].length)
        }
      }

      const id = `${match[1]}:${match[3]}`
      const level = Number(match[2])
      // Ordered markers: 1. 1) (1) a. (a) iii) and multi-level decimal markers such as 2.1. or 1.2.
      const tag = /^\(?(?:\d+|[a-z]+)[.)]/i.test(marker) ? 'ol' : 'ul'

      while (lists.length > 0) {
        const previous = lists[lists.length - 1]
        if (previous.id === id && previous.level <= level && (previous.level < level || previous.tag === tag)) break
        // A type change closes this level; its replacement is a sibling under the retained parent.
        lists.pop()
      }

      const item = doc.createElement('li')
      let list = lists[lists.length - 1]
      if (list === undefined || list.level < level) {
        const element = doc.createElement(tag)
        // Only decimal markers have an unambiguous start without Word's list definitions.
        // Alphabetic/Roman lists use the schema's default start of 1. In multi-level markers
        // such as 2.1. the last number belongs to this level.
        const decimal = tag === 'ol' ? /^\(?(?:\d+\.)*(\d+)[.)]?$/.exec(marker) : null
        if (decimal !== null) {
          element.setAttribute('start', String(parseInt(decimal[1], 10)))
        }
        if (list === undefined) {
          parent.insertBefore(element, paragraph)
        } else {
          list.item.appendChild(element)
        }
        list = { id, level, tag, element, item }
        lists.push(list)
      }

      list.element.appendChild(item)
      item.appendChild(paragraph)
      list.item = item
      changed = true
    }
  }

  normalizeLists(doc.body)
  // A converted clipboard fragment is serialized from the body, omitting head metadata and its styles.
  // Preserve the original bytes when the fast-path matched only text or unsupported structures.
  return changed ? doc.body.innerHTML : html
}
