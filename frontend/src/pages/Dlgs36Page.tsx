import { useEffect, useState, useMemo } from 'react'

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightHtmlText(html: string, query: string) {
  const trimmed = query.trim()
  if (!trimmed) return html

  const regex = new RegExp(escapeRegExp(trimmed), 'ig')

  return html
    .split(/(<[^>]+>)/g)
    .map((segment) => {
      if (segment.startsWith('<') && segment.endsWith('>')) {
        return segment
      }

      return segment.replace(regex, '<mark>$&</mark>')
    })
    .join('')
}

function getSearchMatches(md: string, query: string) {
  const trimmed = query.trim()
  if (!trimmed || !md) return []

  const regex = new RegExp(escapeRegExp(trimmed), 'gi')
  const snippets: string[] = []
  let match

  while ((match = regex.exec(md)) !== null) {
    const start = Math.max(0, match.index - 80)
    const end = Math.min(md.length, match.index + trimmed.length + 160)
    const snippet = md.slice(start, end).replace(/\s+/g, ' ').trim()

    if (snippet && !snippets.includes(snippet)) {
      snippets.push(snippet)
    }

    if (snippets.length >= 6) break
  }

  return snippets
}

function renderMarkdown(md: string, query = ''): string {
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
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>')
    t = t.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    return t
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.trim() === '') {
      if (inTable) { inTable = false; flushTable() }
      continue
    }

    if (/^\|[\s:-]+\|$/.test(line.trim()) && inTable) {
      tableAligns = line.split('|').filter((s, idx, arr) => idx > 0 && idx < arr.length - 1).map(s => s.trim())
      continue
    }

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
      inTable = false
      flushTable()
    }

    if (/^#{1,4}\s/.test(line)) {
      const level = line.match(/^(#+)/)![1].length
      const text = line.replace(/^#+\s*/, '')
      const renderedText = query.trim() ? highlightHtmlText(inlineFormat(text), query) : inlineFormat(text)
      html.push(`<h${level} style="margin-top:1.2em;margin-bottom:0.4em;color:var(--color-text-primary)">${renderedText}</h${level}>`)
      continue
    }

    if (/^---+\s*$/.test(line.trim())) {
      html.push('<hr style="margin:1em 0;border:none;border-top:2px solid var(--color-border-light)">')
      continue
    }

    if (/^\s*[-*]\s/.test(line)) {
      const text = line.replace(/^\s*[-*]\s+/, '')
      const renderedText = query.trim() ? highlightHtmlText(inlineFormat(text), query) : inlineFormat(text)
      html.push(`<li style="margin:2px 0;color:var(--color-text-secondary)">${renderedText}</li>`)
      continue
    }

    if (/^\s*\d+\.\s/.test(line)) {
      const text = line.replace(/^\s*\d+\.\s+/, '')
      const renderedText = query.trim() ? highlightHtmlText(inlineFormat(text), query) : inlineFormat(text)
      html.push(`<li style="margin:2px 0;color:var(--color-text-secondary)">${renderedText}</li>`)
      continue
    }

    if (line.trimStart().startsWith('> ')) {
      const text = line.replace(/^>\s*/, '')
      const renderedText = query.trim() ? highlightHtmlText(inlineFormat(text), query) : inlineFormat(text)
      html.push(`<blockquote style="margin:0.5em 0;padding:8px 14px;border-left:3px solid var(--color-primary);color:var(--color-text-secondary);font-size:13px">${renderedText}</blockquote>`)
      continue
    }

    if (line.trim().startsWith('```')) {
      continue
    }

    const renderedText = query.trim() ? highlightHtmlText(inlineFormat(line), query) : inlineFormat(line)
    html.push(`<p style="margin:0.4em 0;line-height:1.8;color:var(--color-text-secondary);font-size:13px">${renderedText}</p>`)
  }

  if (inTable) flushTable()

  const finalHtml = html.join('\n')
  return finalHtml
    .replace(/((?:<li[^>]*>.*?<\/li>\n?)+)/g, '<ul style="margin:0.4em 0;padding-left:24px;color:var(--color-text-secondary);font-size:13px">$1</ul>')
    .replace(/<p[^>]*>\s*<\/p>/g, '')
}

export default function Dlgs36Page() {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')

  useEffect(() => {
    fetch('/dlgs36-2023.md')
      .then(r => r.text())
      .then(text => {
        setContent(text)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  const normalizedQuery = query.trim()

  const rendered = useMemo(() => {
    if (!content) return ''
    return renderMarkdown(content, normalizedQuery)
  }, [content, normalizedQuery])

  const searchMatches = useMemo(() => {
    return getSearchMatches(content, normalizedQuery)
  }, [content, normalizedQuery])

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
        table { width: 100%; border-collapse: collapse; margin: 0.6em 0; font-size: 12px; color: var(--color-text-secondary); }
        table th, table td { border: 1px solid var(--color-border); padding: 6px 10px; text-align: left; vertical-align: top; }
        table th { background: var(--color-table-header-bg); font-weight: 600; color: var(--color-text-secondary); }
        table tr:nth-child(even) { background: var(--color-table-stripe); }
        a { color: var(--color-primary); }
        mark { background: rgba(255, 204, 0, 0.45); color: inherit; padding: 0 2px; border-radius: 3px; }
        .search-shell { display: flex; gap: 10px; align-items: center; margin-bottom: 18px; }
        .search-input { flex: 1; border: 1px solid var(--color-border); border-radius: 8px; padding: 10px 12px; background: var(--color-bg-page); color: var(--color-text-primary); font-size: 14px; }
        .search-button { border: 1px solid var(--color-border); background: transparent; color: var(--color-text-secondary); border-radius: 8px; padding: 10px 12px; cursor: pointer; }
        .search-summary { margin-bottom: 14px; color: var(--color-text-secondary); font-size: 13px; }
        .search-snippets { display: grid; gap: 10px; margin-bottom: 20px; }
        .search-snippet { background: var(--color-bg-page); border: 1px solid var(--color-border); border-radius: 8px; padding: 10px 12px; font-size: 12px; color: var(--color-text-secondary); line-height: 1.7; }
      `}</style>

      <div className="search-shell">
        <input
          className="search-input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Cerca nel testo della legge..."
          aria-label="Cerca nel testo della legge"
        />
        {query && (
          <button className="search-button" type="button" onClick={() => setQuery('')}>
            Cancella
          </button>
        )}
      </div>

      {normalizedQuery && (
        <div className="search-summary">
          {searchMatches.length > 0
            ? `${searchMatches.length} risultato${searchMatches.length === 1 ? '' : 'i'} trovato${searchMatches.length === 1 ? '' : 'i'} per “${normalizedQuery}”`
            : `Nessun risultato trovato per “${normalizedQuery}”`}
        </div>
      )}

      {normalizedQuery && searchMatches.length > 0 && (
        <div className="search-snippets">
          {searchMatches.map((snippet, index) => (
            <div className="search-snippet" key={`${snippet}-${index}`}>
              <strong style={{ color: 'var(--color-text-primary)' }}>Risultato {index + 1}</strong><br />
              {snippet}
            </div>
          ))}
        </div>
      )}

      <div dangerouslySetInnerHTML={{ __html: rendered }} />
    </div>
  )
}
