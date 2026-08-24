# Revisione Prezzi — Price Revision Calculator for Italian Public Contracts

This project is an MVP web application for calculating **price revision (revisione prezzi)** under **D.Lgs. 36/2023 (Codice dei contratti pubblici)**, Article 60 and Annex II.2-bis. It is designed for Italian contracting authorities, RUP, civil servants, and consultants. The interface and documentation are entirely in Italian.

---

## Panoramica

Il sistema guida l'utente nella compilazione di un dossier di revisione prezzi per appalti pubblici di **servizi, forniture e lavori**, seguendo le regole dell'Allegato II.2-bis del D.Lgs. 36/2023. Supporta sia il wizard classico a 7 passi (V1) sia il wizard semplificato a 5 passi (V2) con supporto TOL per i lavori.

### Funzionalità principali

- **Wizard guidato** — raccolta strutturata dei dati di input (pratica, contratto, CPV, indici ISTAT)
- **Motore di classificazione** — mapping CPV → famiglia di revisione basato su regole YAML
- **Motore di calcolo** — applicazione della formula legale (soglia 5%, coefficiente 80% per servizi/forniture; 3%/90% per lavori)
- **Indice sintetico** — ponderazione multi-TOL per contratti di lavori
- **Calcolo multi-componente** — contratti con prestazioni di natura diversa (Art. 13)
- **Report in Markdown** — dossier di revisione completo e tracciabile
- **Audit logging** — ogni operazione significativa è tracciata (import, svuotamenti)
- **Catalogo ISTAT** — gestione indici: import da query SDMX del databrowser (asincrono), sincronizzazione via API SDMX ISTAT, svuotamento con doppia conferma
- **Catalogo CPV e ATECO** — consultazione e ricerca
- **Parser documentale** (V2) — estrazione automatica dei dati da DOCX/PDF

### Stack tecnologico

| Layer | Tecnologia |
|-------|-----------|
| Backend | Python 3.12 + FastAPI + SQLAlchemy 2.0 |
| Frontend | React 18 + TypeScript + Vite |
| Database | PostgreSQL 16 (containerizzata) |
| Parser | Python + python-docx + pdfplumber |
| Container | Docker Compose (4 servizi) |
| Linting | ruff |

---

## Immagini Docker (GitHub Container Registry)

Le immagini Docker sono pubblicate automaticamente su GitHub Container Registry per ogni push su `main` e per ogni tag `v*`:

| Servizio | Immagine |
|----------|----------|
| backend | `ghcr.io/tosolini/revisioneprezzi/backend` |
| frontend | `ghcr.io/tosolini/revisioneprezzi/frontend` |
| parser | `ghcr.io/tosolini/revisioneprezzi/parser` |

### Con immagini pre-built (consigliato)

```bash
git clone https://github.com/tosolini/revisioneprezzi.git && cd revprezzi
cp .env.example .env
docker compose up -d
make migrate
make seed
open http://localhost:3000
```

### Build locale per sviluppo

```bash
git clone https://github.com/tosolini/revisioneprezzi.git && cd revprezzi
cp .env.example .env
docker compose -f docker-compose-build.yml build
docker compose -f docker-compose-build.yml up -d
make migrate
make seed
open http://localhost:3000
```

**Nota:** L'applicazione è progettata per reti locali private. I container Docker espongono le porte solo su `127.0.0.1`. Non esporre su reti pubbliche o Internet.

### Comandi disponibili

| Comando | Descrizione |
|---------|------------|
| `make up` | Avvia i servizi in background |
| `make down` | Ferma i servizi |
| `make migrate` | Applica le migrazioni Alembic |
| `make seed` | Popola i cataloghi |
| `make test` | Esegue i test |
| `make lint` | Esegue ruff linter |
| `make logs` | Log del backend |
| `make build` | Build locale con `docker-compose-build.yml` |

---

## Struttura del progetto

```
revprezzi/
├── backend/          # API FastAPI (Python)
│   ├── app/
│   │   ├── api/v1/   # Endpoint REST
│   │   ├── core/     # Configurazione, database, health
│   │   ├── models/   # ORM SQLAlchemy (25 tabelle)
│   │   ├── schemas/  # Pydantic request/response
│   │   ├── services/ # Business logic
│   │   ├── rules/    # Regole YAML (classificazione, indici, parametri)
│   │   └── wizard/   # Configurazione wizard
│   ├── seeds/        # CSV e SQL per inizializzazione dati
│   ├── scripts/      # Utility (sync indici, import CPV, seed)
│   ├── migrations/   # Alembic versioni
│   └── tests/        # Test pytest
├── frontend/         # SPA React + TypeScript
│   └── src/
│       ├── pages/    # 11 pagine (wizard, cataloghi, report, etc.)
│       └── components/ # Componenti riutilizzabili
├── parser/           # Servizio parsing documenti (V2)
│   └── app/
│       ├── extractors/  # DOCX e PDF
│       └── patterns.py  # Regex per contratti pubblici
├── docs/             # Documentazione e piani di sviluppo
├── source/           # Documenti normativi originali
├── docker-compose.yml
├── Makefile
└── .env.example
```

### Servizi Docker

| Servizio | Porta | Ruolo |
|----------|-------|-------|
| `backend` | `:8000` | API FastAPI + documentazione Swagger |
| `frontend` | `:3000` | SPA React servita da nginx |
| `parser` | `:8002` | Parsing documentale (V2) |
| `db` | `:5433` | PostgreSQL 16 |

Tutti i servizi sono vincolati a `127.0.0.1`.

---

## API

Una volta avviato, esplora la documentazione interattiva:

- **Swagger UI:** http://localhost:8000/docs
- **OpenAPI JSON:** http://localhost:8000/openapi.json

Endpoint principali:

| Metodo | Path | Descrizione |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/api/v1/cases` | Crea nuova pratica |
| POST | `/api/v1/cases/{id}/wizard/{step}` | Salva risposte wizard |
| POST | `/api/v1/classify` | Classifica CPV → famiglia |
| POST | `/api/v1/calculate` | Calcola revisione |
| POST | `/api/v1/cases/{id}/report` | Genera report Markdown |
| GET | `/api/v1/indices` | Elenco serie ISTAT |
| POST | `/api/v1/indices/import-csv` | Importa osservazioni da CSV ISTAT |
| POST | `/api/v1/indices/import-sdmx` | Avvia import da query SDMX (asincrono, ritorna `job_id`) |
| GET | `/api/v1/indices/import-jobs/{id}` | Stato dell'import SDMX (esito al termine) |
| DELETE | `/api/v1/indices/{series_id}/observations` | Svuota un indice (osservazioni, serie conservata) |
| GET | `/api/v1/tol/list` | Elenco TOL |

---

## Import da query SDMX (databrowser ISTAT)

Dalla pagina **Indici ISTAT** → **“Importa Query SDMX”** si incolla l'URL *Data* della sezione
**Query SDMX** di `esploradati.istat.it/databrowser` e l'app importa le osservazioni nel catalogo.

- **Asincrono**: Istat può impiegare anche 5-10 minuti sulle query con dimensioni non filtrate;
  l'import gira in background (tetto 10 minuti) e la pagina mostra lo stato fino all'esito.
- **Rate limit Istat**: 5 query/minuto per IP con blocco 1-2 giorni oltre soglia. L'app lo rispetta
  con un limiter condiviso tra interfaccia e script CLI (`sync_indices.py`).
- **Correzione automatica frequenza**: se la frequenza richiesta non ha dati (es. annuale), l'app
  verifica le alternative e importa da sola quella disponibile (es. `A→M`), segnalandolo.
- **Guardie di integrità**: query che mescolerebbero più popolazioni nella stessa serie
  (dimensioni non filtrate, frequenze miste) vengono rifiutate con un messaggio esplicativo.

**Svuotamento indice**: espandendo un indice compare **“Svuota indice”** — un modal a doppia
conferma elimina tutte le osservazioni della serie (la serie resta vuota e re-importabile) e
l'operazione viene registrata nell'audit log.

---

## Licenza

Uso interno per pubbliche amministrazioni e professionisti del settore.

## Contributi

Segnala bug o proponi nuove funzionalità via [GitHub Issues](.github/ISSUE_TEMPLATE/).

Autore: [Walter Tosolini](https://www.tosolini.info)
