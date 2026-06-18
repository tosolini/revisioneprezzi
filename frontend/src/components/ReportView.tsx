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

const sectionColors: Record<string, string> = {
  '1': '#eef2ff',
  '2': '#f0fdf4',
  '3': '#fefce8',
  '4': '#faf5ff',
  '5': '#fff1f2',
  '6': '#f0f9ff',
  '7': '#f8fafc',
  '8': '#f5f5f4',
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
        background: isApplicable ? '#fef2f2' : '#f0fdf4',
        border: `1px solid ${isApplicable ? '#fca5a5' : '#bbf7d0'}`,
        borderRadius: 12, padding: '16px 20px', marginBottom: 20,
        display: 'flex', alignItems: 'center', gap: 16,
        flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>ESITO REVISIONE</div>
          <div style={{
            fontSize: 24, fontWeight: 700,
            color: isApplicable ? '#dc2626' : '#16a34a',
          }}>
            {isApplicable ? 'Revisione applicabile' : 'Nessuna revisione'}
          </div>
          {latestCalc && (
            <div style={{ fontSize: 13, color: '#4b5563', marginTop: 4 }}>
              Variazione {latestCalc.variation_percent?.toFixed(2)}% · Soglia {latestCalc.threshold_percent?.toFixed(1)}%
            </div>
          )}
        </div>
        {latestCalc && (
          <div style={{ textAlign: 'right', minWidth: 160 }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 2 }}>IMPORTO REVISIONE</div>
            <div style={{
              fontSize: 28, fontWeight: 700,
              color: isApplicable ? '#dc2626' : '#16a34a',
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
        const bgColor = sectionColors[sectionNum] || '#fff'
        const icon = sectionIcons[sectionNum] || ''

        return (
          <div key={idx} style={{
            background: bgColor,
            borderRadius: 12, padding: 20, marginBottom: 16,
            border: `1px solid ${sectionNum ? '#e5e7eb' : 'transparent'}`,
          }}>
            {title && (
              <div style={{
                fontSize: 15, fontWeight: 700, marginBottom: 16,
                color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8,
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
      // Collect code block
      const codeLines: string[] = []
      i++ // skip opening ```
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      elements.push(
        <pre key={elements.length} style={{
          background: '#1e293b', color: '#e2e8f0', padding: '12px 16px',
          borderRadius: 8, fontSize: 12, lineHeight: 1.6, overflow: 'auto',
          margin: '8px 0',
        }}>
          {codeLines.join('\n')}
        </pre>
      )
      continue
    }

    if (type === 'table') {
      // Collect table rows
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
          fontSize: 14, fontWeight: 600, color: '#374151',
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
              color: '#374151',
            }}>
              <span style={{ color: '#9ca3af', flexShrink: 0 }}>•</span>
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
          borderTop: '1px solid #e5e7eb', margin: '12px 0',
        }} />
      )
      i++
      continue
    }

    // Plain text or bold line
    if (line.trim()) {
      // Skip the main ## header (already rendered as title)
      if (line.startsWith('## ')) {
        i++
        continue
      }
      elements.push(
        <div key={elements.length} style={{
          fontSize: 13, lineHeight: 1.7, color: '#374151',
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
  const body = data.slice(2) // skip header + separator row

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
                background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
                color: '#374151', fontSize: 12, textTransform: 'uppercase',
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
              background: ri % 2 === 0 ? '#fff' : '#f9fafb',
            }}>
              {row.map((cell, ci) => (
                <td key={ci} style={{
                  padding: '8px 10px', borderBottom: '1px solid #f3f4f6',
                  color: '#374151', fontWeight: cell.includes('Importo revisione') ? 700 : 400,
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
