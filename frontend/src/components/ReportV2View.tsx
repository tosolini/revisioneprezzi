import React from 'react';

interface ReportSection {
  title: string;
  data: any;
  order: number;
}

interface ReportData {
  case_id: string;
  sections: ReportSection[];
  calculation_result?: any;
  generated_at: string;
}

interface ReportV2ViewProps {
  reportData: ReportData;
}

const sectionStyle: React.CSSProperties = {
  background: 'var(--color-bg-card)',
  borderRadius: 12,
  padding: 24,
  marginBottom: 16,
  boxShadow: '0 1px 3px var(--color-shadow)',
};

const headerRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  marginBottom: 16,
};

const iconStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  marginRight: 8,
  color: 'var(--color-primary)',
  flexShrink: 0,
};

const hrStyle: React.CSSProperties = {
  border: 'none',
  borderTop: '1px solid #e5e7eb',
  marginBottom: 16,
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
  gap: 16,
};

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--color-text-muted)',
  marginBottom: 4,
};

const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 10px',
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 600,
  background: color === 'blue' ? 'var(--color-bg-info)' : color === 'purple' ? 'var(--color-bg-card)' : color === 'green' ? 'var(--color-bg-success)' : color === 'red' ? 'var(--color-bg-error)' : 'var(--color-border-lighter)',
  color: color === 'blue' ? 'var(--color-text-info)' : color === 'purple' ? 'var(--color-text-info)' : color === 'green' ? 'var(--color-text-success)' : color === 'red' ? 'var(--color-text-error)' : 'var(--color-text-secondary)',
});

const ReportV2View: React.FC<ReportV2ViewProps> = ({ reportData }) => {
  const getSectionByTitle = (title: string): ReportSection | undefined => {
    return reportData.sections.find(s => s.title === title);
  };

  const renderContractData = () => {
    const section = getSectionByTitle('Dati Contratto');
    if (!section) return null;

    const data = section.data;

    return (
      <div style={sectionStyle}>
        <div style={headerRowStyle}>
          <svg style={iconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{section.title}</h3>
        </div>
        <hr style={hrStyle} />
        
        <div style={gridStyle}>
          <div>
            <p style={labelStyle}>Numero Pratica</p>
            <p style={{ fontWeight: 700 }}>{data.case_number || 'N/A'}</p>
          </div>
          
          <div>
            <p style={labelStyle}>Tipo Contratto</p>
            <span style={badgeStyle(data.contract_type === 'works' ? 'blue' : 'purple')}>
              {data.contract_type_label || 'Non specificato'}
            </span>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <p style={labelStyle}>Oggetto</p>
            <p>{data.title || 'Senza titolo'}</p>
          </div>

          {data.cig && (
            <div>
              <p style={labelStyle}>CIG</p>
              <p>{data.cig}</p>
            </div>
          )}

          {data.cup && (
            <div>
              <p style={labelStyle}>CUP</p>
              <p>{data.cup}</p>
            </div>
          )}

          {data.station && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Stazione Appaltante</p>
              <p>{data.station}</p>
            </div>
          )}

          {data.operatore_economico && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Operatore Economico</p>
              <p>{data.operatore_economico}</p>
            </div>
          )}

          {data.object_description && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Descrizione oggetto del contratto</p>
              <p>{data.object_description}</p>
            </div>
          )}

          {data.notes && (
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={labelStyle}>Note iniziali</p>
              <p style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: 'var(--color-text-muted)' }}>{data.notes}</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderClassification = () => {
    const section = getSectionByTitle('Classificazione');
    if (!section) return null;

    const data = section.data;

    return (
      <div style={sectionStyle}>
        <div style={headerRowStyle}>
          <svg style={iconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
          </svg>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{section.title}</h3>
          <span style={{ marginLeft: 12, ...badgeStyle(data.type === 'TOL' ? 'blue' : 'green') }}>
            {data.type}
          </span>
        </div>
        <hr style={hrStyle} />

        {data.type === 'TOL' ? (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-offset)' }}>
                    <th style={thStyle}>Codice TOL</th>
                    <th style={thStyle}>Descrizione</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Peso %</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Importo &euro;</th>
                    <th style={thStyle}>Serie ISTAT</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items?.map((item: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={tdStyle}><strong>{item.code}</strong></td>
                      <td style={tdStyle}>{item.description}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={badgeStyle('blue')}>{item.weight_percent}%</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                        {item.amount != null ? item.amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{item.series_id || 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginRight: 8 }}>Peso Totale:</span>
                <span style={badgeStyle(data.total_weight === 100 ? 'green' : 'red')}>
                  {data.total_weight || 0}%
                </span>
              </div>
              {data.total_amount != null && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginRight: 8 }}>Importo Totale:</span>
                  <span style={{ ...badgeStyle('blue'), fontFamily: 'monospace' }}>
                    &euro; {Number(data.total_amount).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-offset)' }}>
                    <th style={thStyle}>Codice CPV</th>
                    <th style={thStyle}>Descrizione</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Peso %</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Importo &euro;</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items?.map((item: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={tdStyle}><strong>{item.code}</strong></td>
                      <td style={tdStyle}>{item.description}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <span style={badgeStyle('green')}>{item.weight_percent}%</span>
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>
                        {item.amount != null ? item.amount.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginRight: 8 }}>Peso Totale:</span>
                <span style={badgeStyle(data.total_weight === 100 ? 'green' : 'red')}>
                  {data.total_weight || 0}%
                </span>
              </div>
              {data.total_amount != null && (
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)', marginRight: 8 }}>Importo Totale:</span>
                  <span style={{ ...badgeStyle('blue'), fontFamily: 'monospace' }}>
                    &euro; {Number(data.total_amount).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderAmountsAndDates = () => {
    const section = getSectionByTitle('Importi e Date');
    if (!section) return null;

    const data = section.data;

    return (
      <div style={sectionStyle}>
        <div style={headerRowStyle}>
          <svg style={iconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{section.title}</h3>
        </div>
        <hr style={hrStyle} />

        <div style={gridStyle}>
          <div>
            <p style={labelStyle}>Importo Contratto</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-primary)', margin: 0 }}>
              {data.contract_amount 
                ? `€ ${Number(data.contract_amount).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`
                : 'N/A'
              }
            </p>
          </div>

          <div>
            <p style={labelStyle}>Importo Assoggettabile</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: 'var(--color-text-info)', margin: 0 }}>
              {data.revisable_amount 
                ? `€ ${Number(data.revisable_amount).toLocaleString('it-IT', { minimumFractionDigits: 2 })}`
                : 'N/A'
              }
            </p>
          </div>

          <div>
            <p style={labelStyle}>Periodo Base (Aggiudicazione)</p>
            <p style={{ margin: 0 }}>
              {data.base_period 
                ? new Date(data.base_period).toLocaleDateString('it-IT')
                : 'N/A'
              }
            </p>
          </div>

          <div>
            <p style={labelStyle}>Periodo Confronto (Rilevazione)</p>
            <p style={{ margin: 0 }}>
              {data.comparison_period 
                ? new Date(data.comparison_period).toLocaleDateString('it-IT')
                : 'N/A'
              }
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderIndices = () => {
    const section = getSectionByTitle('Indici ISTAT');
    if (!section) return null;

    const data = section.data;

    return (
      <div style={sectionStyle}>
        <div style={headerRowStyle}>
          <svg style={iconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{section.title}</h3>
        </div>
        <hr style={hrStyle} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <div>
            <p style={labelStyle}>Indice Sintetico Base</p>
            <p style={{ fontSize: 36, fontWeight: 700, color: 'var(--color-primary)', margin: 0 }}>
              {data.synthetic_index_base 
                ? Number(data.synthetic_index_base).toFixed(2)
                : 'N/A'
              }
            </p>
          </div>

          <div>
            <p style={labelStyle}>Indice Sintetico Confronto</p>
            <p style={{ fontSize: 36, fontWeight: 700, color: 'var(--color-text-info)', margin: 0 }}>
              {data.synthetic_index_comparison 
                ? Number(data.synthetic_index_comparison).toFixed(2)
                : 'N/A'
              }
            </p>
          </div>
        </div>
      </div>
    );
  };

  const renderNormativeParams = () => {
    const section = getSectionByTitle('Parametri Normativi');
    if (!section) return null;

    const data = section.data;

    return (
      <div style={sectionStyle}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 700 }}>{section.title}</h3>
        <hr style={hrStyle} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <div>
            <p style={labelStyle}>Soglia di Attivazione</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-text-warning)', margin: 0 }}>
              {data.threshold_percent ? `${data.threshold_percent}%` : 'N/A'}
            </p>
          </div>

          <div>
            <p style={labelStyle}>Coefficiente Riconoscimento</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: 'var(--color-primary)', margin: 0 }}>
              {data.recognition_rate_percent ? `${data.recognition_rate_percent}%` : 'N/A'}
            </p>
          </div>

          <div>
            <p style={labelStyle}>Riferimento Normativo</p>
            <p style={{ fontSize: 13, margin: 0 }}>{data.reference || 'N/A'}</p>
          </div>
        </div>
      </div>
    );
  };

  const renderCalculation = () => {
    const section = getSectionByTitle('Risultato Calcolo');
    if (!section) return null;

    const data = section.data;

    if (!data.variation_percent && data.variation_percent !== 0) {
      return (
        <div style={sectionStyle}>
          <div style={headerRowStyle}>
            <svg style={iconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 0v6m0-6L9 13" />
            </svg>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{section.title}</h3>
          </div>
          <hr style={hrStyle} />
          
          <div style={{ background: 'var(--color-bg-info)', border: '1px solid #bfdbfe', borderRadius: 8, padding: 16 }}>
            <p style={{ color: 'var(--color-text-info)', margin: 0, fontSize: 14 }}>
              Calcolo non ancora eseguito. Completare i passaggi precedenti per visualizzare il risultato.
            </p>
          </div>
        </div>
      );
    }

    return (
      <div style={sectionStyle}>
        <div style={headerRowStyle}>
          <svg style={iconStyle} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 0v6m0-6L9 13" />
          </svg>
          <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{section.title}</h3>
        </div>
        <hr style={hrStyle} />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: 24, marginBottom: 24 }}>
          <div>
            <p style={labelStyle}>Variazione</p>
            <p style={{
              fontSize: 36, fontWeight: 700, margin: 0,
              color: data.variation_percent >= 0 ? 'var(--color-text-revision-down)' : 'var(--color-text-revision-up)',
            }}>
              {data.variation_percent >= 0 ? '+' : ''}
              {Number(data.variation_percent).toFixed(2)}%
            </p>
          </div>

          <div>
            <p style={{ ...labelStyle, marginBottom: 8 }}>Soglia</p>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {data.threshold_exceeded ? (
                <svg style={{ width: 32, height: 32, color: 'var(--color-text-revision-down)' }} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg style={{ width: 32, height: 32, color: 'var(--color-text-revision-up)' }} fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              )}
              <span style={{ marginLeft: 8 }}>{data.threshold_exceeded ? 'Superata' : 'Non Superata'}</span>
            </div>
          </div>

          <div>
            <p style={labelStyle}>Importo Revisionale</p>
            <p style={{
              fontSize: 40, fontWeight: 700, margin: 0,
              color: data.revision_amount > 0 ? 'var(--color-text-revision-down)' : data.revision_amount < 0 ? 'var(--color-text-revision-up)' : 'var(--color-text-muted)',
            }}>
              {data.revision_amount >= 0 ? '+' : ''}
              € {Number(data.revision_amount || 0).toLocaleString('it-IT', { minimumFractionDigits: 2 })}
            </p>
            {data.revision_type && (
              <span style={badgeStyle(data.revision_type === 'aumento' ? 'green' : 'red')}>
                {data.revision_type === 'aumento' ? 'AUMENTO' : 'DECURTAZIONE'}
              </span>
            )}
          </div>
        </div>

        {data.formula_steps && data.formula_steps.length > 0 && (
          <div style={{ marginTop: 24 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 12 }}>
              Dettaglio Calcolo Passo-Passo
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, border: '1px solid #e5e7eb' }}>
                <thead>
                  <tr style={{ background: 'var(--color-bg-offset)' }}>
                    <th style={{ ...thStyle, width: 60 }}>Step</th>
                    <th style={thStyle}>Descrizione</th>
                    <th style={thStyle}>Risultato</th>
                  </tr>
                </thead>
                <tbody>
                  {data.formula_steps.map((step: any, idx: number) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{step.step}</td>
                      <td style={tdStyle}>{step.description}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{step.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1152, margin: '0 auto' }}>
      <h2 style={{ fontSize: 28, fontWeight: 700, marginBottom: 24 }}>Report Revisione Prezzi</h2>
      
      {renderContractData()}
      {renderClassification()}
      {renderAmountsAndDates()}
      {renderIndices()}
      {renderNormativeParams()}
      {renderCalculation()}

      <div style={{ marginTop: 24, textAlign: 'right' }}>
        <p style={{ fontSize: 11, color: 'var(--color-text-light)' }}>
          Generato il: {new Date(reportData.generated_at).toLocaleString('it-IT')}
        </p>
      </div>
    </div>
  );
};

const thStyle: React.CSSProperties = {
  padding: '8px 16px',
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--color-text-muted)',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
};

export default ReportV2View;
