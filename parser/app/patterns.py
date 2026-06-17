import re

PATTERNS: dict[str, list[re.Pattern]] = {
    "ente": [
        re.compile(r"(?:Stazione appaltante|Ente|Amministrazione)\s*(?:aggiudicatrice|appaltante)?\s*:?\s*(.+?)(?:\n|$)", re.IGNORECASE),
        re.compile(r"((?:COMUNE DI|PROVINCIA DI|REGIONE|MINISTERO|AZIENDA|SOCIETÀ|S\.?p\.?a\.?)\s*[A-Z][A-Z\s]+)", re.IGNORECASE),
    ],
    "cig": [
        re.compile(r"CIG\s*:?\s*(\d{6,15})", re.IGNORECASE),
        re.compile(r"Codice Identificativo Gara\s*:?\s*(\d{6,15})", re.IGNORECASE),
    ],
    "cup": [
        re.compile(r"CUP\s*:?\s*([A-Z0-9]{15})", re.IGNORECASE),
        re.compile(r"Codice Unico di Progetto\s*:?\s*([A-Z0-9]{15})", re.IGNORECASE),
    ],
    "oggetto": [
        re.compile(r"(?:Oggetto|Oggetto del contratto|Prestazione)\s*:?\s*(.+?)(?:\n|$)", re.IGNORECASE),
        re.compile(r"(?:APPALTO|FORNITURA|SERVIZIO)\s+(?:DI|PER)\s+(.+?)(?:\n|$)", re.IGNORECASE),
    ],
    "cpv": [
        re.compile(r"CPV\s*:?\s*(\d{8}-\d)", re.IGNORECASE),
        re.compile(r"Codice CPV\s*:?\s*(\d{8}-\d)", re.IGNORECASE),
        re.compile(r"(\d{8}-\d)"),
    ],
    "importo_complessivo": [
        re.compile(r"(?:Importo\s*(?:complessivo|totale|a base d'asta|contrattuale))\s*:?\s*(?:€|EUR|euro)?\s*([\d.,]+)", re.IGNORECASE),
        re.compile(r"(?:Valore|Ammontare)\s*(?:complessivo|totale)?\s*:?\s*(?:€|EUR|euro)?\s*([\d.,]+)", re.IGNORECASE),
    ],
    "durata_mesi": [
        re.compile(r"(?:Durata|Periodo)\s*(?:contrattuale)?\s*:?\s*(\d+)\s*(?:mesi|m\.)", re.IGNORECASE),
        re.compile(r"(\d+)\s*(?:mesi|m\.)\s*(?:di|da|a\s*decorrere)", re.IGNORECASE),
    ],
    "natura": [
        re.compile(r"(?:Tipologia|Natura|Tipo)\s*(?:contratto|contrattuale)?\s*:?\s*(servizio|fornitura|misto|lavori)", re.IGNORECASE),
    ],
    "data_stipula": [
        re.compile(r"(?:Data|Data stipula|Data del contratto)\s*:?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})", re.IGNORECASE),
    ],
    "operatore_economico": [
        re.compile(r"(?:Aggiudicatario|Operatore economico|Impresa|Ditta|Aggiudicazione)\s*(?:a favore di)?\s*:?\s*(.+?)(?:\n|$)", re.IGNORECASE),
    ],
}
