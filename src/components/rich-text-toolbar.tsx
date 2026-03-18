'use client'

import type { Editor } from '@tiptap/react'
import {
  Bold, Underline, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const FONT_FAMILIES = [
  { label: 'Arial', value: 'Arial, sans-serif' },
  { label: 'Times New Roman', value: 'Times New Roman, serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Calibri', value: 'Calibri, sans-serif' },
  { label: 'Courier New', value: 'Courier New, monospace' },
]

const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36']

const LINE_SPACINGS = [
  { label: '1.0', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '2.0', value: '2' },
]

interface Props {
  editor: Editor
  disabled?: boolean
}

export function RichTextToolbar({ editor, disabled }: Props) {
  const btn = (active: boolean) =>
    `h-7 w-7 p-0 ${active ? 'bg-accent text-accent-foreground' : ''}`

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-zinc-50 px-2 py-1.5 dark:bg-zinc-900/50">
      {/* Font Family */}
      <Select
        value={editor.getAttributes('textStyle').fontFamily ?? ''}
        onValueChange={v => editor.chain().focus().setFontFamily(v).run()}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="h-7 w-[110px] text-xs">
          <SelectValue placeholder="Font" />
        </SelectTrigger>
        <SelectContent>
          {FONT_FAMILIES.map(f => (
            <SelectItem key={f.value} value={f.value} className="text-xs">
              <span style={{ fontFamily: f.value }}>{f.label}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Font Size */}
      <Select
        value={editor.getAttributes('textStyle').fontSize?.replace('px', '') ?? ''}
        onValueChange={v => (editor.commands as any).setFontSize(`${v}px`)}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="h-7 w-[62px] text-xs">
          <SelectValue placeholder="Size" />
        </SelectTrigger>
        <SelectContent>
          {FONT_SIZES.map(s => (
            <SelectItem key={s} value={s} className="text-xs">{s}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="mx-0.5 h-5 w-px bg-border" />

      {/* Bold */}
      <Button
        type="button" variant="ghost" size="sm"
        className={btn(editor.isActive('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={disabled}
        title="Bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </Button>

      {/* Underline */}
      <Button
        type="button" variant="ghost" size="sm"
        className={btn(editor.isActive('underline'))}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        disabled={disabled}
        title="Underline"
      >
        <Underline className="h-3.5 w-3.5" />
      </Button>

      <div className="mx-0.5 h-5 w-px bg-border" />

      {/* Bullet List */}
      <Button
        type="button" variant="ghost" size="sm"
        className={btn(editor.isActive('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        disabled={disabled}
        title="Bullet list"
      >
        <List className="h-3.5 w-3.5" />
      </Button>

      {/* Ordered List */}
      <Button
        type="button" variant="ghost" size="sm"
        className={btn(editor.isActive('orderedList'))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        disabled={disabled}
        title="Numbered list"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </Button>

      <div className="mx-0.5 h-5 w-px bg-border" />

      {/* Alignment */}
      {([
        ['left', AlignLeft],
        ['center', AlignCenter],
        ['right', AlignRight],
        ['justify', AlignJustify],
      ] as const).map(([align, Icon]) => (
        <Button
          key={align}
          type="button" variant="ghost" size="sm"
          className={btn(editor.isActive({ textAlign: align }))}
          onClick={() => editor.chain().focus().setTextAlign(align).run()}
          disabled={disabled}
          title={`Align ${align}`}
        >
          <Icon className="h-3.5 w-3.5" />
        </Button>
      ))}

      <div className="mx-0.5 h-5 w-px bg-border" />

      {/* Line Spacing */}
      <Select
        value={editor.getAttributes('paragraph').lineHeight ?? ''}
        onValueChange={v => (editor.commands as any).setLineHeight(v)}
        disabled={disabled}
      >
        <SelectTrigger size="sm" className="h-7 w-[62px] text-xs">
          <SelectValue placeholder="Line" />
        </SelectTrigger>
        <SelectContent>
          {LINE_SPACINGS.map(s => (
            <SelectItem key={s.value} value={s.value} className="text-xs">
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
