'use client'

import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import UnderlineExt from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import FontFamily from '@tiptap/extension-font-family'
import Placeholder from '@tiptap/extension-placeholder'
import { useEffect, useRef } from 'react'
import { FontSize, LineHeight } from './rich-text-extensions'
import { RichTextToolbar } from './rich-text-toolbar'

interface Props {
  content: string
  onChange: (html: string) => void
  disabled?: boolean
  placeholder?: string
}

export function RichTextEditor({ content, onChange, disabled, placeholder }: Props) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

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
    ],
    content,
    immediatelyRender: false,
    editable: !disabled,
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(e.getHTML())
    },
    editorProps: {
      attributes: {
        class:
          'min-h-[300px] max-h-[50vh] overflow-y-auto rounded-md border bg-background px-3 py-2 text-sm leading-6 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
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
    if (content !== currentHtml) {
      editor.commands.setContent(content, { emitUpdate: false })
    }
  }, [content, editor])

  // Sync editable state
  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [disabled, editor])

  if (!editor) return null

  return (
    <div className="space-y-2">
      <RichTextToolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  )
}
