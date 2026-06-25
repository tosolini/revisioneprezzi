import { useEffect, useState, useMemo } from 'react'

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const html: string[] = []
  let inTable = false
  let tableRows: string[] = []
  let tableHeaders: string[] = []
  let tableAligns: string[] = []

  function flushTable() {
    if (!tableRows.length) return
    html.push('<table><thead><tr>')
    for (let i = 0; i < tableHeaders.length; i++) {
      const align = tableAligns[i]?.trim()
      const style = align === '---:' ? ' style="text-align:right"' : align === ':---' ? ' style="text-align:left"' : align === ':---:' ? ' style="text-align:center"' : ''
      html.push(`<th${style}>${inlineFormat(tableHeaders[i])}</th>`)
    }
    html.push('</tr></thead><tbody>')
    for (const row of tableRows) {
      const cells = row.split('|').slice(1, -1)
      html.push('<tr>')
      for (let i = 0; i < cells.length; i++) {
        const align = tableAligns[i]?.trim()
        const style = align === '---:' ? ' style="text-align:right"' : align === ':---' ? ' style="text-align:left"' : align === ':---:' ? ' style="text-align:center"' : ''
        html.push(`<td${style}>${inlineFormat(cells[i].trim())}</td>`)
      }
      html.push('</tr>')
    }
    html.push('</tbody></table>')
    tableRows = []
    tableHeaders = []
    tableAligns = []
  }

  function inlineFormat(text: string): string {
    let t = escapeHtml(text)
    // Bold
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Italic
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>')
    // Links
    t = t.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    return t
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Empty line
    if (line.trim() === '') {
      if (inTable) { inTable = false; flushTable() }
      continue
    }

    // Table separator row
    if (/^\|[\s:-]+\|$/.test(line.trim()) && inTable) {
      tableAligns = line.split('|').filter((s, idx, arr) => idx > 0 && idx < arr.length - 1).map(s => s.trim())
      continue
    }

    // Table row
    if (line.trimStart().startsWith('|') && line.trimEnd().endsWith('|')) {
      if (!inTable) {
        inTable = true
        tableHeaders = line.split('|').slice(1, -1).map(s => s.trim())
        continue
      }
      tableRows.push(line)
      continue
    }

    if (inTable) {
      // If we were in a table and line doesn't look like table, flush and process normally
      inTable = false
      flushTable()
    }

    // Headers
    if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^(#+)/)![1].length
      const text = line.replace(/^#+\s*/, '')
      html.push(`<h${level} style="margin-top:1.2em;margin-bottom:0.4em;color:#1a1a2e">${inlineFormat(text)}</h${level}>`)
      continue
    }

    // Horizontal rule
    if (/^---+\s*$/.test(line.trim())) {
      html.push('<hr style="margin:1em 0;border:none;border-top:2px solid #e5e7eb">')
      continue
    }

    // Unordered list
    if (/^\s*[-*]\s/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, '')
      html.push(`<li style="margin:2px 0">${inlineFormat(text)}</li>`)
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s/.test(line)) {
      const text = line.replace(/^\s*\d+\.\s+/, '')
      html.push(`<li style="margin:2px 0">${inlineFormat(text)}</li>`)
      continue
    }

    // Blockquote
    if (line.trimStart().startsWith('> ')) {
      const text = line.replace(/^>\s*/, '')
      html.push(`<blockquote style="margin:0.5em 0;padding:8px 14px;border-left:3px solid #1a1a2e;color:#374151;font-size:13px">${inlineFormat(text)}</blockquote>`)
      continue
    }

    // Code block markers
    if (line.trim().startsWith('```')) {
      // skip code block markers
      continue
    }

    // Regular paragraph
    html.push(`<p style="margin:0.4em 0;line-height:1.8;color:#374151;font-size:13px">${inlineFormat(line)}</p>`)
  }

  if (inTable) flushTable()

  // Wrap consecutive <li> in <ul> or <ol>
  const finalHtml = html.join('\n')
  return finalHtml
    .replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, '<ul style="margin:0.4em 0;padding-left:24px;color:#374151;font-size:13px">$1</ul>')
    .replace(/<p[^>]*>\s*<\/p>/g, '')
}

export default function Dlgs36Page() {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/dlgs36-2023.md')
      .then(r => r.text())
      .then(text => {
        setContent(text)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const rendered = useMemo(() => {
    if (!content) return ''
    return renderMarkdown(content)
  }, [content])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 48, color: 'var(--color-text-muted)' }}>Caricamento...</div>
  }

  return (
    <div style={{
      background: 'var(--color-bg-card)', borderRadius: 12, padding: '24px 32px',
      boxShadow: '0 1px 3px var(--color-shadow)',
      overflowX: 'auto',
    }}>
      <style>{`
        table { width: 100%; border-collapse: collapse; margin: 0.6em 0; font-size: 12px; }
        table th, table td { border: 1px solid #d1d5db; padding: 6px 10px; text-align: left; vertical-align: top; }
        table th { background: #f3f4f6; font-weight: 600; color: #374151; }
        table tr:nth-child(even) { background: #fafafa; }
      `}</style>
      <div dangerouslySetInnerHTML={{ __html: rendered }} />
    </div>
  )
}
