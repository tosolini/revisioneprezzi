// Stampa 1:1 dell'area report (window.print).
// Regole anti-taglio per le tabelle: i wrapper con overflow-x:auto dello
// schermo diventano visibili, la testata si ripete a ogni pagina, le righe
// non si spezzano e le celle vanno a capo invece di sforare dal foglio.

export function printArea(areaId: string): void {
  const styleId = `__print_style_${areaId}`;
  document.getElementById(styleId)?.remove();
  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @media print {
      body * { visibility: hidden !important; }
      #${areaId}, #${areaId} * { visibility: visible !important; }
      #${areaId} { position: absolute; left: 0; top: 0; width: 100%; }
      #root > div > nav { display: none !important; }
      button, .no-print { display: none !important; }
      #${areaId} div { overflow: visible !important; }
      #${areaId} table { page-break-inside: auto; border-collapse: collapse; width: 100% !important; font-size: 10px; }
      #${areaId} thead { display: table-header-group; }
      #${areaId} tfoot { display: table-footer-group; }
      #${areaId} tr { page-break-inside: avoid; }
      #${areaId} th, #${areaId} td { overflow: visible !important; white-space: normal !important; overflow-wrap: anywhere; padding: 4px 6px !important; }
      #${areaId} td > div { display: block !important; }
      #${areaId} td span { min-width: 0 !important; }
      @page { margin: 12mm; }
    }
  `;
  document.head.appendChild(style);
  window.print();
  const cleanup = () => {
    document.getElementById(styleId)?.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
}
