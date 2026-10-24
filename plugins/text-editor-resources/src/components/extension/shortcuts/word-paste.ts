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

  const document = new DOMParser().parseFromString(html, 'text/html')

  for (const paragraph of Array.from(document.querySelectorAll('p'))) {
    if (!Array.from(paragraph.classList).some((name) => name.toLowerCase() === 'msotitle')) continue

    const heading = document.createElement('h1')
    for (const attribute of Array.from(paragraph.attributes)) {
      heading.setAttribute(attribute.name, attribute.value)
    }
    heading.append(...Array.from(paragraph.childNodes))
    paragraph.replaceWith(heading)
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
        markerSpan.remove()
      } else {
        // Some clipboard producers emit the marker as text rather than an mso-list:Ignore span.
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
        let text = walker.nextNode()
        while (text !== null && text.textContent?.trim() === '') text = walker.nextNode()
        const prefix = /^\s*([·•\uf0b7○▪■o-]|(?:\d+|[a-z])[.)])(?:\s+|$)/i.exec(text?.textContent ?? '')
        if (text !== null && prefix !== null) {
          marker = prefix[1]
          text.textContent = (text.textContent ?? '').slice(prefix[0].length)
        }
      }

      const id = `${match[1]}:${match[3]}`
      const level = Number(match[2])
      const tag = /^(?:\d+|[a-z]+)[.)]/i.test(marker) ? 'ol' : 'ul'

      while (lists.length > 0) {
        const previous = lists[lists.length - 1]
        if (previous.id === id && previous.level <= level && (previous.level < level || previous.tag === tag)) break
        lists.pop()
      }

      const item = document.createElement('li')
      let list = lists[lists.length - 1]
      if (list === undefined || list.level < level) {
        const element = document.createElement(tag)
        if (tag === 'ol' && /^\d+[.)]/.test(marker)) {
          element.setAttribute('start', String(parseInt(marker, 10)))
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
    }
  }

  normalizeLists(document.body)
  return document.body.innerHTML
}
