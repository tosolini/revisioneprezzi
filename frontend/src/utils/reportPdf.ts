import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import type { ReportData } from '../components/ReportV2View';

// Builder pdfmake per il dossier "Report Revisione Prezzi".
// Parità di contenuto con ReportV2View (6 sezioni + footer), layout
// ottimizzato carta: tabelle con testata ripetuta, sezioni indivisibili
// dove ha senso, header/footer e numeri di pagina.
// pdfmake è caricato con import() dinamico: resta fuori dal bundle principale.

interface AnyRecord {
  [key: string]: any;
}

const NA = '—';

function str(v: unknown): string {
  if (v == null) return NA;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function eur(v: unknown, decimals = 2): string {
  if (v == null || v === '') return NA;
  const n = Number(v);
  if (Number.isNaN(n)) return NA;
  return `€ ${n.toLocaleString('it-IT', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function itDate(v: unknown): string {
  if (typeof v !== 'string' || !v) return NA;
  const d = new Date(v.length === 7 ? `${v}-01` : v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('it-IT');
}

function stripHtml(html: unknown): string {
  if (typeof html !== 'string' || !html) return '';
  // Output destinato a testo PDF (mai HTML): rimuove tutti i tag, inclusi
  // frammenti non chiusi, e decodifica le entità in un'unica passata.
  const entities: Record<string, string> = {
    euro: '€', amp: '&', lt: '<', gt: '>', nbsp: ' ', quot: '"',
  };
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>?/g, '')
    .replace(/&(euro|amp|lt|gt|nbsp|quot);/g, (_m, e: string) => entities[e] ?? _m)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sectionOf(report: ReportData, title: string): AnyRecord | null {
  const s = report.sections.find(x => x.title === title);
  return s ? (s.data as AnyRecord) : null;
}

function pair(label: string, value: string): AnyRecord {
  return {
    stack: [
      { text: label, style: 'label' },
      { text: value || NA, style: 'value', margin: [0, 0, 0, 8] },
    ],
  };
}

function sectionHeader(title: string, badge?: string): AnyRecord[] {
  const row: AnyRecord[] = [{ text: title, style: 'h2', margin: [0, 0, 0, 6] }];
  if (badge) row.push({ text: badge, style: 'badge', margin: [0, 0, 0, 6] });
  return [{ columns: row, unbreakable: true }, { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: '#e5e7eb' }], margin: [0, 0, 0, 10] }];
}

function pdfTable(header: string[], rows: string[][], widths?: (string | number)[]): AnyRecord {
  return {
    table: {
      headerRows: 1,
      widths: widths || header.map(() => '*'),
      body: [
        header.map(h => ({ text: h, style: 'th' })),
        ...rows.map(r => r.map(c => ({ text: c, style: 'td' }))),
      ],
    },
    layout: 'lightHorizontalLines',
    fontSize: 8.5,
    margin: [0, 0, 0, 8],
  };
}

function calcStepExtras(step: AnyRecord): string[] {
  const details: AnyRecord = step.details ?? {};
  const lines: string[] = [];
  if (step.step === 0) {
    for (const k of ['tipo_contratto', 'soglia_attivazione', 'coefficiente_riconoscimento', 'riferimento']) {
      if (details[k] != null) lines.push(`${k}: ${str(details[k])}`);
    }
  }
  if (step.step === 1) {
    for (const k of ['serie', 'periodo_base', 'valore_base', 'periodo_confronto', 'valore_confronto', 'used_base_period', 'used_comparison_period']) {
      if (details[k] != null) lines.push(`${k}: ${str(details[k])}`);
    }
  }
  const calc = typeof details.calculation === 'string' && details.calculation
    ? details.calculation
    : (typeof step.calculation === 'string' ? step.calculation : '');
  if (calc) lines.push(calc);
  if (Array.isArray(details.component_details)) {
    for (const c of details.component_details as AnyRecord[]) {
      lines.push(
        `${c.series_id ?? ''}  ${c.weight ?? ''}%  I0 ${c.base_value ?? ''}${c.base_exact === false && c.used_base_period ? ` (usato ${c.used_base_period})` : ''}  ` +
        `It ${c.comparison_value ?? ''}${c.comparison_exact === false && c.used_comparison_period ? ` (usato ${c.used_comparison_period})` : ''}  ` +
        `Vi ${c.variation_percent ?? ''}%  → ${c.contribution_percent ?? ''}%`,
      );
    }
  }
  return lines;
}

function renderContract(d: AnyRecord): AnyRecord[] {
  const out = sectionHeader('Dati Contratto');
  const cols: AnyRecord[] = [
    pair('Numero Pratica', str(d.case_number ?? 'N/A')),
    pair('Tipo Contratto', str(d.contract_type_label ?? 'Non specificato')),
  ];
  if (d.title) cols.push(pair('Oggetto', str(d.title)));
  if (d.cig) cols.push(pair('CIG', str(d.cig)));
  if (d.cup) cols.push(pair('CUP', str(d.cup)));
  if (d.lotto) cols.push(pair('Lotto', str(d.lotto)));
  if (d.is_duration_contract != null) cols.push(pair('Contratto di durata', d.is_duration_contract === true ? 'Sì' : 'No'));
  if (d.instant_execution != null) cols.push(pair('Esecuzione istantanea', d.instant_execution === true ? 'Sì' : 'No'));
  if (d.operatore_economico) cols.push(pair('Operatore Economico', str(d.operatore_economico)));
  if (d.created_by) cols.push(pair('Creato da', str(d.created_by)));
  if (d.object_description) cols.push(pair('Descrizione oggetto del contratto', str(d.object_description)));
  const notes = stripHtml(d.notes);
  if (notes) cols.push(pair('Note iniziali', notes));
  const caseNotes = stripHtml(d.case_notes);
  if (caseNotes) cols.push(pair('Note della pratica', caseNotes));
  out.push({ columns: [{ stack: cols.slice(0, Math.ceil(cols.length / 2)) }, { stack: cols.slice(Math.ceil(cols.length / 2)) }], columnGap: 16, margin: [0, 0, 0, 4] });
  return out;
}

function renderClassification(d: AnyRecord): AnyRecord[] {
  const out = sectionHeader('Classificazione', str(d.type));
  const isTol = d.type === 'TOL';
  const header = isTol
    ? ['Codice TOL', 'Descrizione', 'Peso %', 'Importo €', 'Serie ISTAT']
    : ['Codice CPV', 'Descrizione', 'Peso %', 'Importo €'];
  const rows = ((d.items ?? []) as AnyRecord[]).map(it => {
    const base = [
      str(it.code),
      str(it.description),
      `${str(it.weight_percent)}%`,
      it.amount != null ? eur(it.amount) : NA,
    ];
    return isTol ? [...base, str(it.series_id ?? 'N/A')] : base;
  });
  out.push(pdfTable(header, rows, isTol ? ['auto', '*', 'auto', 'auto', 'auto'] : ['auto', '*', 'auto', 'auto']));
  const totals: string[] = [`Peso Totale: ${str(d.total_weight ?? 0)}%`];
  if (d.total_amount != null) totals.push(`Importo Totale: ${eur(d.total_amount)}`);
  out.push({ text: totals.join('    ·    '), style: 'totals', margin: [0, 2, 0, 4] });
  return out;
}

function renderAmounts(d: AnyRecord): AnyRecord[] {
  const out = sectionHeader('Importi e Date');
  const cols = [
    pair('Importo Contratto', d.contract_amount ? eur(d.contract_amount) : 'N/A'),
    pair('Importo Assoggettabile', d.revisable_amount ? eur(d.revisable_amount) : 'N/A'),
    pair('Periodo Base (Aggiudicazione)', d.base_period ? itDate(d.base_period) : 'N/A'),
    pair('Periodo Confronto (Rilevazione)', d.comparison_period ? itDate(d.comparison_period) : 'N/A'),
  ];
  if (d.stipulation_date) cols.push(pair('Data stipula', itDate(d.stipulation_date)));
  if (d.execution_start_date) cols.push(pair('Data avvio esecuzione', itDate(d.execution_start_date)));
  if (d.contract_end_date) cols.push(pair('Termine contratto', itDate(d.contract_end_date)));
  if (d.duration_months != null) cols.push(pair('Durata (mesi)', str(d.duration_months)));
  out.push({ columns: [{ stack: cols.filter((_, i) => i % 2 === 0) }, { stack: cols.filter((_, i) => i % 2 === 1) }], columnGap: 16, margin: [0, 0, 0, 4] });
  return out;
}

function renderIndices(d: AnyRecord): AnyRecord[] {
  const out = sectionHeader('Indici ISTAT');
  out.push({
    columns: [
      { stack: [{ text: 'Indice Sintetico Base', style: 'label' }, { text: d.synthetic_index_base ? Number(d.synthetic_index_base).toFixed(2) : 'N/A', style: 'big' }] },
      { stack: [{ text: 'Indice Sintetico Confronto', style: 'label' }, { text: d.synthetic_index_comparison ? Number(d.synthetic_index_comparison).toFixed(2) : 'N/A', style: 'big' }] },
    ],
    columnGap: 16,
    margin: [0, 0, 0, 8],
  });
  if (d.series_id) {
    out.push({ text: `Serie ISTAT utilizzata per il confronto: ${str(d.series_id)}`, style: 'box', margin: [0, 0, 0, 8] });
  }
  if (Array.isArray(d.components) && d.components.length > 0) {
    out.push({ text: 'Calcolo ponderato per componente (Tabella D punto 7)', style: 'sub', margin: [0, 4, 0, 4] });
    const rows = (d.components as AnyRecord[]).map(c => {
      const contrib = c.contribution_percent !== undefined && c.contribution_percent !== null
        ? `${(Number(c.contribution_percent) >= 0 ? '+' : '')}${Number(c.contribution_percent).toFixed(4)}%`
        : `${((((c.weight ?? 0) as number) / 100) * ((c.variation_percent ?? 0) as number) >= 0 ? '+' : '')}${Number((((c.weight ?? 0) as number) / 100) * ((c.variation_percent ?? 0) as number)).toFixed(4)}%`;
      return [
        str(c.series_id),
        `${str(c.weight)}%`,
        `${Number(c.base_value ?? 0).toFixed(2)}${c.base_exact === false ? ` (usato ${c.used_base_period})` : ''}`,
        `${Number(c.comparison_value ?? 0).toFixed(2)}${c.comparison_exact === false ? ` (usato ${c.used_comparison_period})` : ''}`,
        `${(Number(c.variation_percent ?? 0) >= 0 ? '+' : '')}${Number(c.variation_percent ?? 0).toFixed(4)}%`,
        contrib,
      ];
    });
    out.push(pdfTable(['Serie ISTAT', 'Peso %', 'Indice base', 'Indice confronto', 'Variazione Vi %', 'Contributo %'], rows));
    if (d.calc_math) out.push({ text: str(d.calc_math), style: 'mono', margin: [0, 0, 0, 8] });
  }
  if (Array.isArray(d.multi_components) && d.multi_components.length > 0) {
    out.push({ text: 'Serie ISTAT per componente (Art. 13 multi-oggetto)', style: 'sub', margin: [0, 4, 0, 4] });
    for (const [gi, g] of (d.multi_components as AnyRecord[]).entries()) {
      const lines = [
        `${str(g.description ?? `Componente ${gi + 1}`)}${g.amount != null ? ` — ${eur(g.amount)}` : ''}`,
        ...(g.series_id ? [`Serie ISTAT: ${str(g.series_id)}`] : []),
        ...((Array.isArray(g.components) ? g.components : []) as AnyRecord[]).map(
          c => `${str(c.series_id)}  ${str(c.weight)}%  I0 ${Number(c.base_value ?? 0).toFixed(2)}  It ${Number(c.comparison_value ?? 0).toFixed(2)}  Vi ${Number(c.variation_percent ?? 0).toFixed(4)}%`,
        ),
        ...(g.calc_math ? [str(g.calc_math)] : []),
      ];
      out.push({ text: lines.join('\n'), style: 'mono', margin: [0, 0, 0, 6] });
    }
  }
  return out;
}

function renderNormative(d: AnyRecord): AnyRecord[] {
  const out = sectionHeader('Parametri Normativi');
  out.push({
    columns: [
      { stack: [{ text: 'Soglia di Attivazione', style: 'label' }, { text: d.threshold_percent ? `${d.threshold_percent}%` : 'N/A', style: 'med' }] },
      { stack: [{ text: 'Coefficiente Riconoscimento', style: 'label' }, { text: d.recognition_rate_percent ? `${d.recognition_rate_percent}%` : 'N/A', style: 'med' }] },
      { stack: [{ text: 'Riferimento Normativo', style: 'label' }, { text: str(d.reference ?? 'N/A'), fontSize: 9 }] },
    ],
    columnGap: 16,
    margin: [0, 0, 0, 4],
  });
  return out;
}

function renderCalculation(d: AnyRecord): AnyRecord[] {
  const out = sectionHeader('Risultato Calcolo');
  if (d.variation_percent !== 0 && !d.variation_percent) {
    out.push({ text: 'Calcolo non ancora eseguito. Completare i passaggi precedenti per visualizzare il risultato.', style: 'info', margin: [0, 0, 0, 4] });
    return out;
  }
  out.push({
    columns: [
      { stack: [{ text: 'Variazione', style: 'label' }, { text: `${(Number(d.variation_percent) >= 0 ? '+' : '')}${Number(d.variation_percent).toFixed(2)}%`, style: 'big' }] },
      { stack: [{ text: 'Soglia', style: 'label' }, { text: d.threshold_exceeded ? 'Superata' : 'Non Superata', style: 'med' }] },
      { stack: [{ text: 'Importo Revisionale', style: 'label' }, { text: `${(Number(d.revision_amount || 0) >= 0 ? '+' : '')}${eur(d.revision_amount || 0)}`, style: 'big' }, ...((d.revision_type ? [{ text: d.revision_type === 'aumento' ? 'AUMENTO' : 'DECURTAZIONE', style: 'badge' }] : []) as AnyRecord[])] },
    ],
    columnGap: 16,
    margin: [0, 0, 0, 8],
  });
  if (Array.isArray(d.formula_steps) && d.formula_steps.length > 0) {
    out.push({ text: 'Dettaglio Calcolo Passo-Passo', style: 'sub', margin: [0, 4, 0, 4] });
    const rows = (d.formula_steps as AnyRecord[]).map(s => [
      str(s.step),
      [str(s.description), ...calcStepExtras(s)].join('\n'),
      typeof s.details?.formula === 'string' && s.details.formula ? str(s.details.formula) : str(s.formula ?? '—'),
      str(s.result),
    ]);
    out.push(pdfTable(['Step', 'Descrizione', 'Formula', 'Risultato'], rows, ['auto', '*', 'auto', 'auto']));
  }
  if (d.excess_percent != null || d.recognition_percent != null) {
    const cols = [];
    if (d.excess_percent != null) cols.push({ stack: [{ text: 'Quota eccedente', style: 'label' }, { text: `${Number(d.excess_percent).toFixed(4)}%`, style: 'med' }] });
    if (d.recognition_percent != null) cols.push({ stack: [{ text: 'Coefficiente riconoscimento', style: 'label' }, { text: `${Number(d.recognition_percent).toFixed(2)}%`, style: 'med' }] });
    out.push({ columns: cols, columnGap: 16, margin: [0, 0, 0, 4] });
  }
  if (Array.isArray(d.components) && d.components.length > 0) {
    out.push({ text: 'Dettaglio per componente (Art. 13 multi-oggetto)', style: 'sub', margin: [0, 4, 0, 4] });
    const rows = (d.components as AnyRecord[]).map((c, idx) => [
      str(c.description ?? `Componente ${idx + 1}`),
      c.variation_percent != null ? `${(Number(c.variation_percent) >= 0 ? '+' : '')}${Number(c.variation_percent).toFixed(4)}%` : NA,
      c.revision_amount != null ? eur(c.revision_amount) : NA,
    ]);
    out.push(pdfTable(['Descrizione', 'Variazione %', 'Importo €'], rows, ['*', 'auto', 'auto']));
  }
  return out;
}

export function buildReportDoc(report: ReportData, caseTitle?: string): TDocumentDefinitions {
  const content: AnyRecord[] = [
    { text: 'Report Revisione Prezzi', style: 'h1', margin: [0, 0, 0, 2] },
  ];
  if (caseTitle) content.push({ text: caseTitle, style: 'subtitle', margin: [0, 0, 0, 12] });
  else content.push({ text: '', margin: [0, 0, 0, 12] });

  const sections: Array<[string, (d: AnyRecord) => AnyRecord[]]> = [
    ['Dati Contratto', renderContract],
    ['Classificazione', renderClassification],
    ['Importi e Date', renderAmounts],
    ['Indici ISTAT', renderIndices],
    ['Parametri Normativi', renderNormative],
    ['Risultato Calcolo', renderCalculation],
  ];
  for (const [title, render] of sections) {
    const d = sectionOf(report, title);
    if (!d) continue;
    content.push(...render(d));
  }

  return {
    pageSize: 'A4',
    pageMargins: [40, 56, 40, 56],
    footer: (currentPage: number, pageCount: number) => ({
      columns: [
        { text: `Generato il: ${itDate(report.generated_at)}`, style: 'footer' },
        { text: `Pagina ${currentPage} di ${pageCount}`, style: 'footer', alignment: 'right' },
      ],
      margin: [40, 0, 40, 0],
    }),
    content,
    styles: {
      h1: { fontSize: 20, bold: true },
      subtitle: { fontSize: 11, color: '#6b7280' },
      h2: { fontSize: 13, bold: true },
      label: { fontSize: 8.5, color: '#6b7280', margin: [0, 0, 0, 1] },
      value: { fontSize: 10 },
      big: { fontSize: 17, bold: true },
      med: { fontSize: 14, bold: true },
      sub: { fontSize: 10, bold: true, color: '#374151' },
      badge: { fontSize: 9, bold: true, color: '#1d4ed8' },
      totals: { fontSize: 9, bold: true },
      th: { fontSize: 8.5, bold: true, color: '#4b5563' },
      td: { fontSize: 8.5 },
      mono: { fontSize: 8, font: 'Roboto' },
      box: { fontSize: 9, fillColor: '#f3f4f6', margin: [0, 4, 0, 4] },
      info: { fontSize: 10, color: '#1d4ed8' },
      footer: { fontSize: 8, color: '#9ca3af' },
    },
    defaultStyle: { fontSize: 9.5, lineHeight: 1.25 },
  } as unknown as TDocumentDefinitions;
}

export async function downloadReportPdf(report: ReportData, filename: string, caseTitle?: string): Promise<void> {
  const [pdfMakeMod, vfsMod] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  const pdfMake = ((pdfMakeMod as AnyRecord).default ?? pdfMakeMod) as AnyRecord;
  const vfs = ((vfsMod as AnyRecord).default ?? vfsMod) as AnyRecord;
  pdfMake.vfs = (vfs.vfs ?? vfs) as unknown;
  const doc = buildReportDoc(report, caseTitle);
  pdfMake.createPdf(doc).download(filename);
}
