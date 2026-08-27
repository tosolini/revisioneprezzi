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
    if (isFormulaTable(tableHeaders, tableRows)) {
      html.push(renderFormulaTable(tableHeaders, tableRows))
      tableRows = []
      tableHeaders = []
      tableAligns = []
      return
    }
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
    for (const [from, to] of FORMULA_MOJIBAKE) t = t.split(from).join(to)
    // Gli asterischi escape (\*) sono marcatori/footnote: li si protegge con
    // un sentinella senza asterisco (prima di bold/em) e li si ripristina.
    const ESC = '\u0001'
    t = t.replace(/\\\*/g, ESC + 'A')
    t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    t = t.replace(/\*(.+?)\*/g, '<em>$1</em>')
    t = t.split(ESC + 'A').join('*')
    t = t.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    return t
  }
  // Sostituzioni per il rendering delle formule (Allegato II.2-bis).
  const FORMULA_MOJIBAKE: Array<[string, string]> = [
    ['â‹¯', '…'],
    ['ð‘‰', 'V'],
    ['ð‘¤', 'w'],
  ]
  const FORMULA_SUBSCRIPTS: Array<[string, string]> = [
    ['ISSALpx', 'ISSAL<sub>px</sub>'],
    ['ISSALmo', 'ISSAL<sub>mo</sub>'],
    ['SALrpx', 'SAL<sub>rpx</sub>'],
    ['SALcpx', 'SAL<sub>cpx</sub>'],
    ['ISpx', 'IS<sub>px</sub>'],
    ['ISmo', 'IS<sub>mo</sub>'],
    ['ITOLi', 'ITOL<sub>i</sub>'],
  ]

  function formulaHtml(text: string): string {
    let t = escapeHtml(text)
    for (const [from, to] of FORMULA_MOJIBAKE) t = t.split(from).join(to)
    // Negli escape e nei contesti aritmetici \* significa "per"
    t = t.replace(/\\\*/g, '×')
    for (const [tok, sub] of FORMULA_SUBSCRIPTS) t = t.split(tok).join(sub)
    return t
  }

  function isEquationLine(text: string): boolean {
    // Righe di footnotes (\*, \*\*): non sono equazioni
    if (/^(?:\\\*){1,2}\s/.test(text.trim())) return false
    if (/\\\*/.test(text)) return true
    if (/∑/.test(text)) return true
    if (/=/.test(text) && (/\b(?:Is|SAL\w*|Vt)\s*=/.test(text) || /\(\(IS/.test(text))) return true
    return false
  }

  function isFormulaTable(headers: string[], rows: string[]): boolean {
    const joined = [...headers, ...rows].join(' ')
    if (/∑/.test(joined) && /Is\s*=/.test(joined)) return true
    if (/\\\*/.test(joined) && /Vt|It-Io|Io/.test(joined)) return true
    if (rows.length <= 2 && joined.includes('=') && joined.trim().length < 90) return true
    return false
  }

  function renderFormulaTable(headers: string[], rows: string[]): string {
    const joined = [...headers, ...rows].join(' ').replace(/\s+/g, ' ').trim()
    if (/∑/.test(joined)) {
      // Is = (Σ_{i=1}^{i=n} p_i × ITOL_i) / (Σ p_i)
      return '<div class="formula">Is = <span class="frac">' +
        '<span class="num"><span class="sigma">Σ<sup>i=n</sup><sub>i=1</sub></span> p<sub>i</sub> × ITOL<sub>i</sub></span>' +
        '<span class="den">Σ p<sub>i</sub></span></span></div>'
    }
    if (/\\\*/.test(joined)) {
      // Vt = (I_t − I_o) × 100 / I_o
      return '<div class="formula">Vt = <span class="frac">' +
        '<span class="num">(I<sub>t</sub> − I<sub>o</sub>) × 100</span>' +
        '<span class="den">I<sub>o</sub></span></span></div>'
    }
    return `<div class="formula">${formulaHtml(joined)}</div>`
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
    // Formule/equazioni: blocco dedicato
    if (isEquationLine(line)) {
      html.push(`<div class="formula">${formulaHtml(line.trim())}</div>`)
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
        .formula { text-align: center; margin: 0.8em 0; padding: 12px 18px; background: var(--color-bg-offset); border: 1px solid var(--color-border-light); border-radius: 10px; font-family: Georgia, 'Times New Roman', serif; font-style: italic; font-size: 15px; color: var(--color-text-primary); line-height: 1.6; }
        .formula .frac { display: inline-flex; flex-direction: column; align-items: center; vertical-align: middle; margin: 0 6px; }
        .formula .num { padding: 0 10px 4px; border-bottom: 1.5px solid var(--color-text-primary); }
        .formula .den { padding: 4px 10px 0; }
        .formula .sigma { position: relative; display: inline-block; margin-right: 0.5em; font-size: 1.35em; line-height: 1; }
        .formula .sigma sup { position: absolute; top: -0.7em; left: 0.35em; font-size: 0.55em; font-style: normal; }
        .formula .sigma sub { position: absolute; bottom: -0.7em; left: 0.35em; font-size: 0.55em; font-style: normal; }
        .formula sub, .formula sup { font-style: normal; }
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
