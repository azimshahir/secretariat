'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import UnderlineExt from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef } from 'react'
import {
  flattenMinuteSourceBundleEditorHtml,
  FontSize,
  LineHeight,
  MinuteSourceBundle,
  MinuteSourceTag,
  normalizeMinuteSourceBundleEditorHtml,
  normalizeResolutionPlaceholderEditorHtml,
  ResolutionPlaceholder,
} from './rich-text-extensions'
import { RichTextToolbar } from './rich-text-toolbar'

interface Props {
  content: string
  onChange: (html: string) => void
  disabled?: boolean
  placeholder?: string
  onEditorReady?: (editor: Editor | null) => void
  enableResolutionPlaceholderToken?: boolean
  enableMinuteSourceTagging?: boolean
}

export function RichTextEditor({
  content,
  onChange,
  disabled,
  placeholder,
  onEditorReady,
  enableResolutionPlaceholderToken = false,
  enableMinuteSourceTagging = false,
}: Props) {
  const onChangeRef = useRef(onChange)
  const normalizedContent = (() => {
    let next = content
    if (enableMinuteSourceTagging) {
      next = normalizeMinuteSourceBundleEditorHtml(next)
    }
    if (enableResolutionPlaceholderToken) {
      next = normalizeResolutionPlaceholderEditorHtml(next)
    }
    return next
  })()

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  const editor = useEditor({
    extensions: [
      StarterKit,
      UnderlineExt,
      TextStyle,
      FontFamily,
      FontSize,
      LineHeight,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      ...(enableResolutionPlaceholderToken ? [ResolutionPlaceholder] : []),
      ...(enableMinuteSourceTagging ? [MinuteSourceBundle] : []),
      ...(enableMinuteSourceTagging ? [MinuteSourceTag] : []),
    ],
    content: normalizedContent,
    immediatelyRender: false,
    editable: !disabled,
    onUpdate: ({ editor: e }) => {
      const nextHtml = enableMinuteSourceTagging
        ? flattenMinuteSourceBundleEditorHtml(e.getHTML())
        : e.getHTML()
      onChangeRef.current(nextHtml)
    },
    editorProps: {
      attributes: {
        class:
          'min-h-[300px] max-h-[50vh] overflow-y-auto rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      },
      transformPastedHTML: html => {
        let next = html
        if (enableMinuteSourceTagging) {
          next = normalizeMinuteSourceBundleEditorHtml(next)
        }
        if (enableResolutionPlaceholderToken) {
          next = normalizeResolutionPlaceholderEditorHtml(next)
        }
        return next
      },
    },
  })

  // Sync content from parent (e.g., when dialog reopens with saved data)
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (!editor) return
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    const currentHtml = editor.getHTML()
    // Only update if content actually differs (avoid cursor jumps)
    if (normalizedContent !== currentHtml) {
      editor.commands.setContent(normalizedContent, { emitUpdate: false })
    }
  }, [editor, normalizedContent])

  // Sync editable state
  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [disabled, editor])

  useEffect(() => {
    onEditorReady?.(editor ?? null)
  }, [editor, onEditorReady])

  if (!editor) return null

  return (
    <div className="space-y-2">
      <RichTextToolbar editor={editor} disabled={disabled} enableMinuteSourceTagging={enableMinuteSourceTagging} />
      <EditorContent editor={editor} />
    </div>
  )
}
