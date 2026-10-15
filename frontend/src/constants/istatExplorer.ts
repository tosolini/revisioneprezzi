export const EXPLORER_URLS = {
  PPI: "https://esploradati.istat.it/databrowser/#/it/dw/categories/IT1,Z0400PRI,1.0/DCSC_PREZZPIND_1",
  PPS: "https://esploradati.istat.it/databrowser/#/it/dw/categories/IT1,Z0400PRI,1.0/DCSC_PREZPRODSERV_1/",
  IR: "https://esploradati.istat.it/databrowser/#/it/dw/categories/IT1,Z0500LAB,1.0/LAB_EMPLWAGE/LAB_EMPL_NATLABCONT/DCSC_RETRATECO1/IT1,155_358_DF_DCSC_RETRATECO1_7,1.0",
  PC: "https://esploradati.istat.it/databrowser/#/it/dw/categories/IT1,Z0400PRI,1.0/PRI_CONWHONAT/DCSP_NIC1B2025/IT1,167_745_DF_DCSP_NIC1B2025_6,1.0",
} as const
export const EXPLORER_LEAF_URLS = {
  PPI: "https://esploradati.istat.it/databrowser/#/it/dw/categories/IT1,Z0400PRI,1.0/DCSC_PREZZPIND_1/IT1,145_360_DF_DCSC_PREZZPIND_1_4,1.0",
  PPS: "https://esploradati.istat.it/databrowser/#/it/dw/categories/IT1,Z0400PRI,1.0/DCSC_PREZPRODSERV_1/IT1,145_376_DF_DCSC_PREZPRODSERV_1_7,1.0",
  IR: EXPLORER_URLS.IR,
  PC: EXPLORER_URLS.PC,
} as const
export type ExplorerIndexType = "PPI" | "PPS" | "IR" | "PC"
export const EXPLORER_LABELS: Record<ExplorerIndexType, string> = {
  PPI: "PPI — Prezzi produzione industria",
  PPS: "PPS — Prezzi produzione servizi (BtoB)",
  IR: "IR — Retribuzioni contrattuali",
  PC: "PC/NIC — Prezzi al consumo",
}
export const DATAFLOW_BY_TYPE: Record<ExplorerIndexType, string> = {
  PPI: "145_360_DF_DCSC_PREZZPIND_1_4",
  PPS: "145_376_DF_DCSC_PREZPRODSERV_1_7",
  IR: "155_358_DF_DCSC_RETRATECO1_7",
  PC: "167_745_DF_DCSP_NIC1B2025_6",
}
export function sdmxTemplateFor(indexType: ExplorerIndexType, code: string, freq: "M" | "Q" = indexType === "PPS" ? "Q" : "M"): string {
  const df = DATAFLOW_BY_TYPE[indexType]
  const prefix = indexType === "PPS" ? "Q" : "M"
  // NIC/PC: set nuovo base 2025 (ECOICOP 2) dal 2026-01 — DATA_TYPE 85, MEASURE 4
  const start = indexType === "PC" ? "2026-01-01" : "2024-01-01"
  const key =
    indexType === "IR"
      ? `${prefix}.IT.N.${code.trim()}`
      : indexType === "PPS"
        ? `${prefix}.IT.N.${code.trim()}`
        : indexType === "PC"
          ? `${prefix}.IT.85.4.${code.trim()}`
          : `${prefix}.IT.${code.trim()}`
  return `https://esploradati.istat.it/SDMXWS/rest/data/IT1,${df},1.0/${key}/ALL/?detail=full&startPeriod=${start}&endPeriod=2026-03-31&dimensionAtObservation=TIME_PERIOD`
}
