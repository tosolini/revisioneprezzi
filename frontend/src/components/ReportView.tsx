import type { JSX } from 'react'

interface CalcResult {
  series_id?: string
  base_value?: number
  comparison_value?: number
  variation_percent?: number
  threshold_percent?: number
  excess_percent?: number
  recognition_percent?: number
  revision_amount?: number
  formula_detail?: string
  steps?: { step: number; description: string; formula: string; result: string }[]
  is_applicable?: boolean
}

interface Props {
  report: string
  calcResult: CalcResult | null
}

type LineType = 'h2' | 'h3' | 'table' | 'code' | 'list' | 'hr' | 'bold_line' | 'text'

function detectLine(line: string): LineType {
  if (line.startsWith('## ')) return 'h2'
  if (line.startsWith('### ')) return 'h3'
  if (line.startsWith('|')) return 'table'
  if (line.startsWith('```')) return 'code'
  if (line.startsWith('- ') || line.startsWith('* ')) return 'list'
  if (line.startsWith('---')) return 'hr'
  if (line.startsWith('**') && line.endsWith('**')) return 'bold_line'
  return 'text'
}

function parseTableRow(row: string): string[] {
  return row.split('|').filter(c => c.trim()).map(c => c.trim())
}

function renderBoldInline(text: string): (string | JSX.Element)[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i}>{p.slice(2, -2)}</strong>
    }
    return p
  })
}

const sectionIcons: Record<string, string> = {
  '1': '📋',
  '2': '📄',
  '3': '🏷️',
  '4': '📊',
  '5': '🧮',
  '6': '✅',
  '7': '📝',
  '8': '📜',
}

function ReportView({ report, calcResult }: Props) {
  if (!report) return null

  // Split into sections by ## headers
  const sections = report.split(/\n(?=## )/g)

  // Extract key data from latest calculation (section 5)
  const latestCalc = calcResult
  const revisionAmount = latestCalc?.revision_amount ?? 0
  const isApplicable = latestCalc?.is_applicable ?? false

  const lines = report.split('\n')

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Summary banner */}
      <div style={{
        background: isApplicable ? 'var(--color-threshold-exceeded-bg)' : 'var(--color-threshold-ok-bg)',
        border: `1px solid ${isApplicable ? 'var(--color-border-error)' : 'var(--color-border-success)'}`,
        borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>ESITO REVISIONE</div>
          <div style={{
            fontSize: 24, fontWeight: 700,
            color: isApplicable ? 'var(--color-text-revision-up)' : 'var(--color-text-revision-down)',
          }}>
            {isApplicable ? 'Revisione applicabile' : 'Nessuna revisione'}
          </div>
          {latestCalc && (
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 4 }}>
              Variazione {latestCalc.variation_percent?.toFixed(2)}% · Soglia {latestCalc.threshold_percent?.toFixed(1)}%
            </div>
          )}
        </div>
        {latestCalc && (
          <div style={{ textAlign: 'right', minWidth: 160 }}>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 2 }}>IMPORTO REVISIONE</div>
            <div style={{
              fontSize: 28, fontWeight: 700,
              color: isApplicable ? 'var(--color-text-revision-up)' : 'var(--color-text-revision-down)',
            }}>
              € {revisionAmount.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {/* Report sections */}
      {sections.map((section, idx) => {
        const sectionLines = section.split('\n').filter(l => l.trim())
        if (sectionLines.length === 0) return null

        let title = ''
        // Find the ## header
        const headerIdx = sectionLines.findIndex(l => l.startsWith('## '))
        if (headerIdx >= 0) {
          title = sectionLines[headerIdx].replace(/^##\s+/, '')
          sectionLines.splice(headerIdx, 1)
        }

        // Get section number
        const sectionNum = title.match(/^(\d+)/)?.[1] || ''
        const icon = sectionIcons[sectionNum] || ''

        return (
          <div key={idx} style={{
            background: 'var(--color-bg-card)',
            borderRadius: 12, padding: 20, marginBottom: 16,
            border: '1px solid var(--color-border-light)',
          }}>
            {title && (
              <div style={{
                fontSize: 15, fontWeight: 700, marginBottom: 16,
                color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 8,
              }}>
                {icon && <span>{icon}</span>}
                {title}
              </div>
            )}
            {renderSectionContent(sectionLines.join('\n'))}
          </div>
        )
      })}
    </div>
  )
}

function renderSectionContent(text: string): JSX.Element {
  const lines = text.split('\n').filter(l => l.trim())
  const elements: JSX.Element[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    const type = detectLine(line)

    if (type === 'code') {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++
      elements.push(
        <pre key={elements.length} style={{
          background: 'var(--color-bg-code)', color: '#e2e8f0', padding: '12px 16px',
          borderRadius: 8, fontSize: 12, lineHeight: 1.6, overflow: 'auto',
          margin: '8px 0',
        }}>
          {codeLines.join('\n')}
        </pre>
      )
      continue
    }

    if (type === 'table') {
      const rows: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        rows.push(lines[i])
        i++
      }
      if (rows.length > 1) {
        elements.push(renderTable(rows, elements.length))
      }
      continue
    }

    if (type === 'h3') {
      elements.push(
        <div key={elements.length} style={{
          fontSize: 14, fontWeight: 600, color: 'var(--color-text-secondary)',
          marginTop: 12, marginBottom: 8,
        }}>
          {renderBoldInline(line.replace(/^###\s+/, ''))}
        </div>
      )
      i++
      continue
    }

    if (type === 'list') {
      const items: string[] = []
      while (i < lines.length && (lines[i].startsWith('- ') || lines[i].startsWith('* '))) {
        items.push(lines[i].replace(/^[-*]\s+/, ''))
        i++
      }
      elements.push(
        <div key={elements.length} style={{ margin: '4px 0' }}>
          {items.map((item, j) => (
            <div key={j} style={{
              display: 'flex', gap: 8, padding: '2px 0', fontSize: 13,
              color: 'var(--color-text-secondary)',
            }}>
              <span style={{ color: 'var(--color-text-light)', flexShrink: 0 }}>•</span>
              <span>{renderBoldInline(item)}</span>
            </div>
          ))}
        </div>
      )
      continue
    }

    if (type === 'hr') {
      elements.push(
        <div key={elements.length} style={{
          borderTop: '1px solid var(--color-border-light)', margin: '12px 0',
        }} />
      )
      i++
      continue
    }

    if (line.trim()) {
      if (line.startsWith('## ')) {
        i++
        continue
      }
      elements.push(
        <div key={elements.length} style={{
          fontSize: 13, lineHeight: 1.7, color: 'var(--color-text-secondary)',
          padding: '2px 0',
        }}>
          {renderBoldInline(line)}
        </div>
      )
    }
    i++
  }

  return <div>{elements}</div>
}

function renderTable(rows: string[], key: number): JSX.Element {
  const data = rows.map(r => parseTableRow(r))
  const header = data[0] || []
  const body = data.slice(2)

  return (
    <div key={key} style={{ overflow: 'auto', margin: '8px 0' }}>
      <table style={{
        width: '100%', borderCollapse: 'collapse', fontSize: 13,
      }}>
        <thead>
          <tr>
            {header.map((h, i) => (
              <th key={i} style={{
                textAlign: 'left', padding: '8px 10px', fontWeight: 600,
                background: 'var(--color-table-header-bg)', borderBottom: '2px solid var(--color-table-border)',
                color: 'var(--color-text-secondary)', fontSize: 12, textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {renderBoldInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, ri) => (
            <tr key={ri} style={{
              background: ri % 2 === 0 ? 'var(--color-bg-card)' : 'var(--color-table-stripe)',
            }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '8px 10px', borderBottom: '1px solid var(--color-border-lighter)',
                  color: 'var(--color-text-secondary)', fontWeight: cell.includes('Importo revisione') ? 700 : 400,
                }}>
                  {renderBoldInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default ReportView
