import { Extension } from '@tiptap/core'

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
      setFontSize: (size: string) => ({ chain }: any) =>
        chain().setMark('textStyle', { fontSize: size }).run(),
      unsetFontSize: () => ({ chain }: any) =>
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
      setLineHeight: (height: string) => ({ commands }: any) =>
        commands.updateAttributes('paragraph', { lineHeight: height }) &&
        commands.updateAttributes('heading', { lineHeight: height }),
      unsetLineHeight: () => ({ commands }: any) =>
        commands.updateAttributes('paragraph', { lineHeight: null }) &&
        commands.updateAttributes('heading', { lineHeight: null }),
    }
  },
})
