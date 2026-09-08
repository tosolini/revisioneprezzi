import { useEffect } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

export function isEmptyHtml(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, '').trim() === ''
}

export default function NotesEditor({ value, onChange, placeholder }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Placeholder.configure({ placeholder: placeholder || 'Scrivi le note…' }),
    ],
    content: value || '',
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
  })

  // Sincronizza il contenuto quando il valore esterno cambia
  // (es. reset form): evita loop confrontando con l'HTML corrente.
  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const next = value || ''
    if (current !== next && (next === '' ? !editor.isEmpty : true)) {
      editor.commands.setContent(next)
    }
  }, [editor, value])

  if (!editor) return null

  const btn = (active: boolean): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    border: '1px solid var(--color-border)',
    background: active ? 'var(--color-primary)' : 'var(--color-bg-card)',
    color: active ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
  })

  return (
    <div>
      <EditorStyle />
      <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} style={btn(editor.isActive('bold'))} title="Grassetto"><b>B</b></button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} style={btn(editor.isActive('italic'))} title="Corsivo"><i>I</i></button>
        <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} style={btn(editor.isActive('underline'))} title="Sottolineato"><u>U</u></button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} style={btn(editor.isActive('bulletList'))} title="Elenco puntato">• Lista</button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} style={btn(editor.isActive('orderedList'))} title="Elenco numerato">1. Lista</button>
      </div>
      <div style={{
        border: '1px solid var(--color-border)', borderRadius: 6,
        background: 'var(--color-bg-input)', color: 'var(--color-text-primary)',
        fontSize: 14, minHeight: 76, padding: '8px 12px',
      }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}


const RICH_CSS = `
.tiptap:focus { outline: none; }
.tiptap p { margin: 0 0 6px; }
.tiptap ul, .tiptap ol { padding-left: 22px; margin: 4px 0; }
.tiptap p.is-editor-empty:first-child::before {
  content: attr(data-placeholder); float: left; height: 0; pointer-events: none;
  color: var(--color-text-light);
}
.rich-notes p { margin: 0 0 6px; }
.rich-notes ul, .rich-notes ol { padding-left: 22px; margin: 4px 0; }
`

export function EditorStyle() {
  return <style>{RICH_CSS}</style>
}

// Rendering HTML prodotto dall'editor (solo contenuto utente, niente script).
export function RichNotes({ html }: { html: string }) {
  return (
    <>
      <EditorStyle />
      <div className="rich-notes" dangerouslySetInnerHTML={{ __html: html }} />
    </>
  )
}