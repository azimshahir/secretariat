import { Extension, mergeAttributes, Node } from '@tiptap/core'
import type { Editor } from '@tiptap/core'
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model'
import {
  RESOLUTION_PATH_PLACEHOLDER,
} from '@/lib/meeting-generation/minute-template'

export const RESOLUTION_PLACEHOLDER_NODE_NAME = 'resolutionPlaceholder'
export const RESOLUTION_PLACEHOLDER_DATA_ATTRIBUTE = 'data-resolution-placeholder'
export const RESOLUTION_PLACEHOLDER_TOKEN_CLASSES =
  'inline-flex select-none items-center rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold tracking-[0.02em] text-emerald-800'
export const MINUTE_SOURCE_DATA_ATTRIBUTE = 'data-minute-source'
export const MINUTE_SOURCE_BUNDLE_DATA_ATTRIBUTE = 'data-minute-source-bundle'
export const MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE = 'data-minute-source-note'
export const MINUTE_SOURCE_LABEL_DATA_ATTRIBUTE = 'data-minute-source-label'
export const MINUTE_SOURCE_PAPER_VALUE = 'paper'
export const MINUTE_SOURCE_PAPER_LABEL = 'From the Paper'
export const MINUTE_SOURCE_PAPER_CLASS = 'minute-source-paper-block'
export const MINUTE_SOURCE_BUNDLE_NODE_NAME = 'minuteSourceBundle'

const RESOLUTION_PLACEHOLDER_TEXT_PATTERN = /(?:\[\s*RESOLUTION_PATH\s*\]|\{\{\s*RESOLUTION_PATH\s*\}\})/g
const RESOLUTION_PLACEHOLDER_MARKER_PATTERN = new RegExp(
  `<span[^>]*${RESOLUTION_PLACEHOLDER_DATA_ATTRIBUTE}(?:=(?:"true"|'true'|true))?[^>]*>.*?<\\/span>`,
  'gi',
)

function createResolutionPlaceholderElement(ownerDocument: Document) {
  const element = ownerDocument.createElement('span')
  element.setAttribute(RESOLUTION_PLACEHOLDER_DATA_ATTRIBUTE, 'true')
  element.setAttribute('contenteditable', 'false')
  element.className = RESOLUTION_PLACEHOLDER_TOKEN_CLASSES
  element.textContent = RESOLUTION_PATH_PLACEHOLDER
  return element
}

function buildResolutionPlaceholderTokenHtml() {
  return `<span ${RESOLUTION_PLACEHOLDER_DATA_ATTRIBUTE}="true" contenteditable="false" class="${RESOLUTION_PLACEHOLDER_TOKEN_CLASSES}">${RESOLUTION_PATH_PLACEHOLDER}</span>`
}

export function buildResolutionPlaceholderBlockHtml() {
  return `<p>${buildResolutionPlaceholderTokenHtml()}</p><p></p>`
}

function replaceResolutionPlaceholderTextNode(textNode: Text) {
  const value = textNode.nodeValue ?? ''
  if (!RESOLUTION_PLACEHOLDER_TEXT_PATTERN.test(value)) return

  RESOLUTION_PLACEHOLDER_TEXT_PATTERN.lastIndex = 0
  const fragment = textNode.ownerDocument.createDocumentFragment()
  let lastIndex = 0

  value.replace(RESOLUTION_PLACEHOLDER_TEXT_PATTERN, (match, offset) => {
    const startIndex = Number(offset)
    if (startIndex > lastIndex) {
      fragment.append(value.slice(lastIndex, startIndex))
    }
    fragment.append(createResolutionPlaceholderElement(textNode.ownerDocument))
    lastIndex = startIndex + match.length
    return match
  })

  if (lastIndex < value.length) {
    fragment.append(value.slice(lastIndex))
  }

  textNode.parentNode?.replaceChild(fragment, textNode)
}

export function normalizeResolutionPlaceholderEditorHtml(value: string) {
  if (!value.trim()) return value

  if (typeof window === 'undefined') {
    return value
      .replace(RESOLUTION_PLACEHOLDER_MARKER_PATTERN, buildResolutionPlaceholderTokenHtml())
      .replace(RESOLUTION_PLACEHOLDER_TEXT_PATTERN, buildResolutionPlaceholderTokenHtml())
  }

  const container = window.document.createElement('div')
  container.innerHTML = value

  container.querySelectorAll(`[${RESOLUTION_PLACEHOLDER_DATA_ATTRIBUTE}]`).forEach(node => {
    node.replaceWith(createResolutionPlaceholderElement(container.ownerDocument))
  })

  const walker = window.document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode as Text)
  }

  for (const textNode of textNodes) {
    if (textNode.parentElement?.closest(`[${RESOLUTION_PLACEHOLDER_DATA_ATTRIBUTE}]`)) continue
    replaceResolutionPlaceholderTextNode(textNode)
  }

  return container.innerHTML
}

function isMinuteSourceSupportedElement(node: Element | null | undefined): node is HTMLElement {
  if (!node || !(node instanceof HTMLElement)) return false
  const tagName = node.tagName.toLowerCase()
  return tagName === 'p' || /^h[1-6]$/.test(tagName) || tagName === 'ul' || tagName === 'ol'
}

function stripMinuteSourcePresentationAttributes(element: HTMLElement) {
  element.removeAttribute(MINUTE_SOURCE_DATA_ATTRIBUTE)
  element.removeAttribute(MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE)
  element.removeAttribute(MINUTE_SOURCE_LABEL_DATA_ATTRIBUTE)
  element.removeAttribute('title')
  element.removeAttribute(MINUTE_SOURCE_BUNDLE_DATA_ATTRIBUTE)
  element.classList.remove(MINUTE_SOURCE_PAPER_CLASS)
  if (!element.getAttribute('class')?.trim()) {
    element.removeAttribute('class')
  }
}

function buildMinuteSourceBundleElement(ownerDocument: Document, params: { note: string }) {
  const element = ownerDocument.createElement('div')
  element.setAttribute(MINUTE_SOURCE_BUNDLE_DATA_ATTRIBUTE, 'true')
  element.setAttribute(MINUTE_SOURCE_DATA_ATTRIBUTE, MINUTE_SOURCE_PAPER_VALUE)
  element.setAttribute(MINUTE_SOURCE_LABEL_DATA_ATTRIBUTE, MINUTE_SOURCE_PAPER_LABEL)
  element.className = MINUTE_SOURCE_PAPER_CLASS

  const note = params.note.trim()
  if (note) {
    element.setAttribute(MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE, note)
    element.setAttribute('title', `${MINUTE_SOURCE_PAPER_LABEL}: ${note}`)
  }

  return element
}

function wrapLegacyMinuteSourceBlocksIntoBundles(container: HTMLElement) {
  const children = Array.from(container.children) as HTMLElement[]

  for (let index = 0; index < children.length; index += 1) {
    const child = children[index]
    if (!isMinuteSourceSupportedElement(child)) continue
    if (!child.hasAttribute(MINUTE_SOURCE_DATA_ATTRIBUTE)) continue

    const source = normalizeMinuteSourceValue(child.getAttribute(MINUTE_SOURCE_DATA_ATTRIBUTE))
    if (!source) continue
    const note = (child.getAttribute(MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE) ?? '').trim()
    const grouped: HTMLElement[] = []
    let cursor = index

    while (cursor < children.length) {
      const candidate = children[cursor]
      if (!isMinuteSourceSupportedElement(candidate)) break
      if (normalizeMinuteSourceValue(candidate.getAttribute(MINUTE_SOURCE_DATA_ATTRIBUTE)) !== source) break
      if ((candidate.getAttribute(MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE) ?? '').trim() !== note) break

      grouped.push(candidate)
      cursor += 1
    }

    if (grouped.length === 0) continue

    const bundle = buildMinuteSourceBundleElement(container.ownerDocument, { note })
    const firstNode = grouped[0]
    if (!firstNode?.parentNode) continue

    firstNode.parentNode.insertBefore(bundle, firstNode)
    for (const element of grouped) {
      stripMinuteSourcePresentationAttributes(element)
      bundle.appendChild(element)
    }

    index = cursor - 1
  }
}

export function normalizeMinuteSourceBundleEditorHtml(value: string) {
  if (!value.trim() || typeof window === 'undefined') return value

  const container = window.document.createElement('div')
  container.innerHTML = value
  wrapLegacyMinuteSourceBlocksIntoBundles(container)
  return container.innerHTML
}

export function flattenMinuteSourceBundleEditorHtml(value: string) {
  if (!value.trim() || typeof window === 'undefined') return value

  const container = window.document.createElement('div')
  container.innerHTML = value

  container.querySelectorAll(`[${MINUTE_SOURCE_BUNDLE_DATA_ATTRIBUTE}="true"][${MINUTE_SOURCE_DATA_ATTRIBUTE}="${MINUTE_SOURCE_PAPER_VALUE}"]`)
    .forEach(node => {
      if (!(node instanceof HTMLElement)) return
      const note = (node.getAttribute(MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE) ?? '').trim()
      const fragment = node.ownerDocument.createDocumentFragment()
      const children = Array.from(node.children) as HTMLElement[]

      for (const child of children) {
        if (!(child instanceof HTMLElement)) continue
        if (!isMinuteSourceSupportedElement(child)) continue

        child.setAttribute(MINUTE_SOURCE_DATA_ATTRIBUTE, MINUTE_SOURCE_PAPER_VALUE)
        child.setAttribute(MINUTE_SOURCE_LABEL_DATA_ATTRIBUTE, MINUTE_SOURCE_PAPER_LABEL)
        child.classList.add(MINUTE_SOURCE_PAPER_CLASS)
        if (note) {
          child.setAttribute(MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE, note)
          child.setAttribute('title', `${MINUTE_SOURCE_PAPER_LABEL}: ${note}`)
        } else {
          child.removeAttribute(MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE)
          child.removeAttribute('title')
        }
        child.removeAttribute(MINUTE_SOURCE_BUNDLE_DATA_ATTRIBUTE)
        fragment.appendChild(child)
      }

      node.replaceWith(fragment)
    })

  return container.innerHTML
}

export function countResolutionPlaceholderNodes(editor: Editor | null | undefined) {
  if (!editor) return 0

  let count = 0
  editor.state.doc.descendants(node => {
    if (node.type.name === RESOLUTION_PLACEHOLDER_NODE_NAME) {
      count += 1
    }
  })
  return count
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (size: string) => ReturnType
      unsetFontSize: () => ReturnType
    }
    lineHeight: {
      setLineHeight: (height: string) => ReturnType
      unsetLineHeight: () => ReturnType
    }
    resolutionPlaceholder: {
      insertResolutionPlaceholder: () => ReturnType
    }
  }
}

export const ResolutionPlaceholder = Node.create({
  name: RESOLUTION_PLACEHOLDER_NODE_NAME,
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  parseHTML() {
    return [{ tag: `span[${RESOLUTION_PLACEHOLDER_DATA_ATTRIBUTE}]` }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        [RESOLUTION_PLACEHOLDER_DATA_ATTRIBUTE]: 'true',
        contenteditable: 'false',
        class: RESOLUTION_PLACEHOLDER_TOKEN_CLASSES,
      }),
      RESOLUTION_PATH_PLACEHOLDER,
    ]
  },

  renderText() {
    return RESOLUTION_PATH_PLACEHOLDER
  },

  addCommands() {
    return {
      insertResolutionPlaceholder: () => ({ commands }) => commands.insertContent({
        type: this.name,
      }),
    }
  },
})

type ChainContext = { chain: Editor['chain'] }
type CommandsContext = { commands: Editor['commands'] }

export type MinuteSourceValue = typeof MINUTE_SOURCE_PAPER_VALUE

export interface MinuteSourceBlockState {
  nodeType: 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'minuteSourceBundle' | null
  source: MinuteSourceValue | null
  note: string
}

const MINUTE_SOURCE_SUPPORTED_NODE_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList'] as const
type MinuteSourceSupportedNodeType = (typeof MINUTE_SOURCE_SUPPORTED_NODE_TYPES)[number]

function isMinuteSourceSupportedNodeType(value: string): value is MinuteSourceSupportedNodeType {
  return (MINUTE_SOURCE_SUPPORTED_NODE_TYPES as readonly string[]).includes(value)
}

function normalizeMinuteSourceValue(value: string | null | undefined): MinuteSourceValue | null {
  return value === MINUTE_SOURCE_PAPER_VALUE ? MINUTE_SOURCE_PAPER_VALUE : null
}

interface MinuteSourceSelectionBlock {
  pos: number
  nodeType: MinuteSourceSupportedNodeType | typeof MINUTE_SOURCE_BUNDLE_NODE_NAME
  source: MinuteSourceValue | null
  note: string
  node: ProseMirrorNode
}

function getMinuteSourceSelectionBlocks(editor: Editor | null | undefined): MinuteSourceSelectionBlock[] {
  if (!editor) return []

  const { from, to, empty, $from } = editor.state.selection

  const getTopLevelSegments = () => {
    const segments: MinuteSourceSelectionBlock[] = []
    editor.state.doc.forEach((node, offset) => {
      const nodeType = node.type.name
      if (
        nodeType !== MINUTE_SOURCE_BUNDLE_NODE_NAME
        && !isMinuteSourceSupportedNodeType(nodeType)
      ) {
        return
      }

      const source = nodeType === MINUTE_SOURCE_BUNDLE_NODE_NAME
        ? normalizeMinuteSourceValue(node.attrs.minuteSource)
        : normalizeMinuteSourceValue(node.attrs.minuteSource)
      const note = typeof node.attrs.minuteSourceNote === 'string' ? node.attrs.minuteSourceNote : ''

      segments.push({
        pos: offset,
        nodeType: nodeType === MINUTE_SOURCE_BUNDLE_NODE_NAME ? MINUTE_SOURCE_BUNDLE_NODE_NAME : nodeType,
        source,
        note,
        node,
      })
    })
    return segments
  }

  if (empty) {
    const bundleDepth = (() => {
      for (let depth = $from.depth; depth >= 0; depth -= 1) {
        if ($from.node(depth).type.name === MINUTE_SOURCE_BUNDLE_NODE_NAME) {
          return depth
        }
      }
      return null
    })()

    if (bundleDepth !== null) {
      return [{
        pos: $from.before(bundleDepth),
        nodeType: MINUTE_SOURCE_BUNDLE_NODE_NAME,
        source: normalizeMinuteSourceValue($from.node(bundleDepth).attrs.minuteSource),
        note: typeof $from.node(bundleDepth).attrs.minuteSourceNote === 'string'
          ? $from.node(bundleDepth).attrs.minuteSourceNote
          : '',
        node: $from.node(bundleDepth),
      }]
    }

    const blocks: MinuteSourceSelectionBlock[] = []
    for (let depth = $from.depth; depth >= 0; depth -= 1) {
      const node = $from.node(depth)
      if (!isMinuteSourceSupportedNodeType(node.type.name)) continue

      blocks.push({
        pos: $from.before(depth),
        nodeType: node.type.name,
        source: normalizeMinuteSourceValue(node.attrs.minuteSource),
        note: typeof node.attrs.minuteSourceNote === 'string' ? node.attrs.minuteSourceNote : '',
        node,
      })
      break
    }
    return blocks
  }

  return getTopLevelSegments().filter(segment => (
    segment.pos < to && (segment.pos + segment.node.nodeSize) > from
  ))
}

export function getActiveMinuteSourceBlockState(editor: Editor | null | undefined): MinuteSourceBlockState {
  const selectedBlocks = getMinuteSourceSelectionBlocks(editor)
  if (selectedBlocks.length === 0) {
    return {
      nodeType: null,
      source: null,
      note: '',
    }
  }

  const firstBlock = selectedBlocks[0]
  const allSameNodeType = selectedBlocks.every(block => block.nodeType === firstBlock.nodeType)
  const allSameSource = selectedBlocks.every(block => block.source === firstBlock.source)
  const allSameNote = selectedBlocks.every(block => block.note === firstBlock.note)

  return {
    nodeType: allSameNodeType ? firstBlock.nodeType : null,
    source: allSameSource ? firstBlock.source : null,
    note: allSameSource && allSameNote ? firstBlock.note : '',
  }
}

export function updateActiveMinuteSourceBlock(
  editor: Editor,
  params: {
    source: MinuteSourceValue | null
    note?: string | null
    focus?: boolean
  },
) {
  const selectedBlocks = getMinuteSourceSelectionBlocks(editor)
  const targetBlocks = selectedBlocks
  const chain = params.focus === false ? editor.chain() : editor.chain().focus()
  const nextNote = params.source ? (params.note ?? '').trim() : null

  const transaction = chain.command(({ tr, state }) => {
    let changed = false

    if (targetBlocks.length === 0) return false

    const bundleNodeType = state.schema.nodes[MINUTE_SOURCE_BUNDLE_NODE_NAME]
    if (!bundleNodeType) return false

    if (params.source === null) {
      for (const block of [...targetBlocks].reverse()) {
        if (block.nodeType !== MINUTE_SOURCE_BUNDLE_NODE_NAME) continue
        const node = state.doc.nodeAt(block.pos)
        if (!node) continue
        tr.replaceWith(block.pos, block.pos + node.nodeSize, node.content)
        changed = true
      }
      return changed
    }

    if (
      targetBlocks.length === 1
      && targetBlocks[0]?.nodeType === MINUTE_SOURCE_BUNDLE_NODE_NAME
    ) {
      const activeBundle = targetBlocks[0]
      const node = state.doc.nodeAt(activeBundle.pos)
      if (!node) return false

      tr.setNodeMarkup(activeBundle.pos, undefined, {
        ...node.attrs,
        minuteSource: params.source,
        minuteSourceNote: nextNote || null,
      })
      return true
    }

    const firstBlock = targetBlocks[0]
    const lastBlock = targetBlocks[targetBlocks.length - 1]
    if (!firstBlock || !lastBlock) return false

    const mergedNodes = targetBlocks.flatMap(block => {
      const node = state.doc.nodeAt(block.pos)
      if (!node) return []
      if (block.nodeType === MINUTE_SOURCE_BUNDLE_NODE_NAME) {
        const children: ProseMirrorNode[] = []
        node.content.forEach(child => {
          children.push(child)
        })
        return children
      }
      if (isMinuteSourceSupportedNodeType(block.nodeType)) {
        return [node]
      }
      return []
    })

    if (mergedNodes.length === 0) return false

    const bundleNode = bundleNodeType.create(
      {
        minuteSource: params.source,
        minuteSourceNote: nextNote || null,
      },
      Fragment.fromArray(mergedNodes),
    )

    tr.replaceWith(
      firstBlock.pos,
      lastBlock.pos + lastBlock.node.nodeSize,
      bundleNode,
    )
    changed = true

    return changed
  })

  return transaction.run()
}

export const MinuteSourceBundle = Node.create({
  name: MINUTE_SOURCE_BUNDLE_NODE_NAME,
  group: 'block',
  content: '(paragraph|heading|bulletList|orderedList)+',
  defining: true,
  isolating: true,

  parseHTML() {
    return [{
      tag: `div[${MINUTE_SOURCE_BUNDLE_DATA_ATTRIBUTE}="true"][${MINUTE_SOURCE_DATA_ATTRIBUTE}="${MINUTE_SOURCE_PAPER_VALUE}"]`,
    }]
  },

  addAttributes() {
    return {
      minuteSource: {
        default: MINUTE_SOURCE_PAPER_VALUE,
        parseHTML: element => normalizeMinuteSourceValue(
          (element as HTMLElement).getAttribute(MINUTE_SOURCE_DATA_ATTRIBUTE),
        ),
        renderHTML: attributes => {
          const source = normalizeMinuteSourceValue(attributes.minuteSource)
          if (!source) return {}

          return {
            [MINUTE_SOURCE_BUNDLE_DATA_ATTRIBUTE]: 'true',
            [MINUTE_SOURCE_DATA_ATTRIBUTE]: source,
            [MINUTE_SOURCE_LABEL_DATA_ATTRIBUTE]: MINUTE_SOURCE_PAPER_LABEL,
            class: MINUTE_SOURCE_PAPER_CLASS,
          }
        },
      },
      minuteSourceNote: {
        default: null,
        parseHTML: element => (element as HTMLElement).getAttribute(MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE),
        renderHTML: attributes => {
          const source = normalizeMinuteSourceValue(attributes.minuteSource)
          const note = typeof attributes.minuteSourceNote === 'string'
            ? attributes.minuteSourceNote.trim()
            : ''
          if (!source || !note) return {}

          return {
            [MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE]: note,
            title: `${MINUTE_SOURCE_PAPER_LABEL}: ${note}`,
          }
        },
      },
    }
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), 0]
  },
})

/**
 * FontSize extension — applies font-size via the TextStyle mark.
 * Usage: editor.commands.setFontSize('14px')
 */
export const FontSize = Extension.create({
  name: 'fontSize',

  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: el => (el as HTMLElement).style.fontSize || null,
          renderHTML: attrs => {
            if (!attrs.fontSize) return {}
            return { style: `font-size: ${attrs.fontSize}` }
          },
        },
      },
    }]
  },

  addCommands() {
    return {
      setFontSize: (size: string) => ({ chain }: ChainContext) =>
        chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }: ChainContext) =>
        chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run(),
    }
  },
})

/**
 * LineHeight extension — applies line-height on paragraph & heading nodes.
 * Usage: editor.commands.setLineHeight('1.5')
 */
export const LineHeight = Extension.create({
  name: 'lineHeight',

  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: el => (el as HTMLElement).style.lineHeight || null,
          renderHTML: attrs => {
            if (!attrs.lineHeight) return {}
            return { style: `line-height: ${attrs.lineHeight}` }
          },
        },
      },
    }]
  },

  addCommands() {
    return {
      setLineHeight: (height: string) => ({ commands }: CommandsContext) =>
        commands.updateAttributes('paragraph', { lineHeight: height }) &&
        commands.updateAttributes('heading', { lineHeight: height }),
      unsetLineHeight: () => ({ commands }: CommandsContext) =>
        commands.updateAttributes('paragraph', { lineHeight: null }) &&
        commands.updateAttributes('heading', { lineHeight: null }),
    }
  },
})

export const MinuteSourceTag = Extension.create({
  name: 'minuteSourceTag',

  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading', 'bulletList', 'orderedList'],
      attributes: {
        minuteSource: {
          default: null,
          parseHTML: element => normalizeMinuteSourceValue(
            (element as HTMLElement).getAttribute(MINUTE_SOURCE_DATA_ATTRIBUTE),
          ),
          renderHTML: attributes => {
            const source = normalizeMinuteSourceValue(attributes.minuteSource)
            if (!source) return {}

            return {
              [MINUTE_SOURCE_DATA_ATTRIBUTE]: source,
              [MINUTE_SOURCE_LABEL_DATA_ATTRIBUTE]: MINUTE_SOURCE_PAPER_LABEL,
              class: MINUTE_SOURCE_PAPER_CLASS,
            }
          },
        },
        minuteSourceNote: {
          default: null,
          parseHTML: element => (element as HTMLElement).getAttribute(MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE),
          renderHTML: attributes => {
            const source = normalizeMinuteSourceValue(attributes.minuteSource)
            const note = typeof attributes.minuteSourceNote === 'string'
              ? attributes.minuteSourceNote.trim()
              : ''
            if (!source || !note) return {}

            return {
              [MINUTE_SOURCE_NOTE_DATA_ATTRIBUTE]: note,
              title: `${MINUTE_SOURCE_PAPER_LABEL}: ${note}`,
            }
          },
        },
      },
    }]
  },
})
