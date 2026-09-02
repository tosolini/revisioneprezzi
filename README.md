# Revisione Prezzi — Price Revision Calculator for Italian Public Contracts

This project is an MVP web application for calculating **price revision (revisione prezzi)** under **D.Lgs. 36/2023 (Codice dei contratti pubblici)**, Article 60 and Annex II.2-bis. It is designed for Italian contracting authorities, RUP, civil servants, and consultants. The interface and documentation are entirely in Italian.

---

## Panoramica

Il sistema guida l'utente nella compilazione di un dossier di revisione prezzi per appalti pubblici di **servizi, forniture e lavori**, seguendo le regole dell'Allegato II.2-bis del D.Lgs. 36/2023. Supporta sia il wizard classico a 7 passi (V1) sia il wizard semplificato a 5 passi (V2) con supporto TOL per i lavori.

### Funzionalità principali

- **Wizard guidato** — due percorsi: V1 a 7 passi (`/cases/:id/wizard/:step`) e V2 a 5 passi (`/cases/:id/wizard-v2`, con supporto TOL per i lavori)
- **Mapping CPV → Tabella D** — associazione CPV → indici ISTAT (serie singola o media ponderata, Art. 11 e Allegato II.2-bis), con fallback sui candidati di famiglia (Art. 11.4) e forzatura indice singolo motivata (Art. 11.5)
- **Motore di calcolo** — media ponderata delle variazioni (Tabella D) e indice sintetico (TOL), applicazione della formula legale (soglia 5%, coefficiente 80% per servizi/forniture; 3%/90% per lavori), calcolo multi-componente (Art. 13)
- **Trasparenza sui dati ISTAT** — i periodi richiesti senza dato vengono segnalati con i mesi non registrati e il periodo effettivamente usato (fallback)
- **Vincolo sull'ordine dei periodi** — il periodo base deve precedere il confronto; l'inversione è bloccata con messaggio esplicativo (override riservato, non esposto in UI)
- **Report V2 strutturato** — dossier di revisione completo (e report Markdown classico) con passaggi di calcolo, pronto per stampa/PDF
- **Audit logging** — ogni operazione significativa è tracciata (import, svuotamenti, eliminazione query SDMX)
- **Catalogo ISTAT** — gestione indici: import CSV, import da query SDMX asincrono con salvataggio automatico delle query, **strategie riscrittura `startPeriod`/`endPeriod`** (riscarica con `fixed`/`earliest`/`expand_1y`/`expand_5y` per inizio più vecchio e `fixed`/`last_month_end`/`today` per fine), riscarica e gestione provenienza per serie, ricerca per gruppo, svuotamento con doppia conferma; **guardie di integrità** con payload strutturato (`unfiltered_dimensions` + `example_url`) e box esplicativo che indica quali valori si mescolerebbero nella serie esistente; **tooltip ATECO** per `wages_ateco` — la tabella mostra su `ISTAT_WAGES_ATECO_*` (es. `951`) la descrizione ATECO (`[951] Riparazione di computer e di apparecchiature per le comunicazioni`) come `title` nativo su Codice/Nome e come etichetta inline, risolta via `ateco_catalog` con fallback `Tabella D` (`/api/v1/indices/by-group/{group}` e `/api/v1/indices/search` espongono `ateco_label`)
- **UX modali** — tutte le modali SDMX/CSV/svuotamento con `maxHeight:90vh`, scroll interno e header/footer sticky: mai bloccate fuori viewport anche con errori lunghi
- **Cataloghi CPV, ATECO, TOL** — consultazione e ricerca
- **Parser documentale (V2)** — estrazione su richiesta alla creazione pratica — preview e conferma admin prima di avviare il percorso rapido (carica PDF/DOCX opzionale in “Nuova pratica”, verifica i dati trovati e scegli se usare il rapido)
- **Backup del database** — esportazione e ripristino dal backend (`/api/v1/backup`)

#### Quale percorso scegliere?

| Percorso | Quando usarlo | Passi |
|----------|---------------|-------|
| **Percorso rapido (V2, 5 passi)** | Servizi/forniture standard con CPV noto; ideale dopo aver caricato determina/bando e confermato i dati estratti | 1. Tipo contratto → 2. CPV/ATECO → 3. Importo e periodi → 4. Pesi indici → 5. Calcolo |
| **Percorso completo (V1, 7 passi)** | Casi complessi, lavori con TOL, o quando l'estrazione non trova dati utili | 7 passi con classificazione fine e indici compositi |

### Stack tecnologico

| Layer | Tecnologia |
|-------|-----------|
| Backend | Python 3.14 + FastAPI + SQLAlchemy 2.0 |
| Frontend | React 19 + TypeScript + Vite |
| Database | PostgreSQL 16 (containerizzata) |
| Parser | Python 3.12 + python-docx + pdfplumber |
| Container | Docker Compose (4 servizi) |
| Linting | ruff (regole E/F) |

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
| `make build` | Build locale con `docker-compose-build.yml` |
| `make migrate` | Applica le migrazioni Alembic |
| `make migrate-new name="..."` | Genera una nuova migrazione Alembic (autogenerate) |
| `make seed` | Popola i cataloghi (`scripts/seed_catalogs.py`) |
| `make sync-indices csv=...` | Sincronizza gli indici da un CSV ISTAT via CLI |
| `make shell` | Shell dentro il container backend |
| `make db-shell` | `psql` sul database |
| `make test` | Esegue i test pytest |
| `make test-coverage` | Test con copertura (`--cov=app`) |
| `make lint` | Esegue ruff (regole E/F) |
| `make logs` | Log del backend |
| `make restart` | Riavvia il backend |
| `make trivy-scan` / `make trivy-scan-all` | Scan di sicurezza delle immagini |
| `make setup` | `up` + `seed` in un comando |

---

## Struttura del progetto

```
revprezzi/
├── backend/          # API FastAPI (Python)
│   ├── alembic/      # Migrazioni Alembic (versions/)
│   ├── app/
│   │   ├── api/v1/   # Endpoint REST
│   │   ├── core/     # Configurazione, database, health
│   │   ├── models/   # ORM SQLAlchemy (24 tabelle)
│   │   ├── schemas/  # Pydantic request/response
│   │   ├── services/ # Business logic
│   │   ├── rules/    # Regole YAML (classificazione, indici, parametri)
│   │   ├── reporting/# Template report
│   │   ├── data/     # Dati di runtime (cache SDMX, stato import)
│   │   └── wizard/   # Configurazione wizard
│   ├── seeds/        # Config dataflow ISTAT
│   ├── scripts/      # Utility (seed_catalogs, import_tabella_d, sync_indices, import_cpv)
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
| POST | `/api/v1/classify` | Classifica CPV → Tabella D |
| POST | `/api/v1/calculation/v2/calculate` | Calcola revisione (serie singola o composita) |
| POST | `/api/v1/calculation/v2/calculate/multi-component` | Calcolo multi-componente (Art. 13) |
| POST | `/api/v1/calculation/v2/coverage` | Copertura periodi per serie (periodo usato, mesi mancanti) |
| POST | `/api/v1/report/v2/cases/{id}/calculation` | Salva il risultato di calcolo per il report |
| GET | `/api/v1/report/v2/cases/{id}` | Report strutturato (V2) |
| GET | `/api/v1/indices` | Elenco serie ISTAT |
| GET | `/api/v1/indices/search` | Ricerca serie (nome/codice/gruppo) — per `wages_ateco` include `ateco_label` con descrizione ATECO |
| GET | `/api/v1/indices/by-group/{group}` | Serie di un gruppo — per `wages_ateco` ogni serie include `ateco_label` (tooltip `[951] …`) |
| POST | `/api/v1/indices/import-csv` | Importa osservazioni da CSV ISTAT |
| POST | `/api/v1/indices/import-sdmx` | Avvia import da query SDMX (asincrono, ritorna `job_id`; body: `url` + `end_period_strategy`[`fixed`/`last_month_end`/`today`] + `start_period_strategy`[`fixed`/`earliest`/`expand_1y`/`expand_5y`]) |
| GET | `/api/v1/indices/import-jobs/{id}` | Stato dell'import SDMX (esito al termine; `error` con `unfiltered_dimensions` + `example_url` se dimensioni non filtrate) |
| GET/PUT/DELETE | `/api/v1/indices/saved-queries/{id}` | Legge/aggiorna/elimina una query SDMX salvata (GET ritorna `end_period_strategy` + `start_period_strategy`; PUT valida entrambi) |
| POST | `/api/v1/indices/saved-queries/{id}/run` | Riesegue (riscarica) una query SDMX salvata applicando **entrambe** le strategie (`startPeriod` più vecchio + `endPeriod` aggiornato) e ritorna `resolved_meta` con `startPeriod`/`endPeriod` riscritti |
| DELETE | `/api/v1/indices/{series_id}/observations` | Svuota un indice (osservazioni, serie conservata) |
| GET | `/api/v1/tol/list` | Elenco TOL |
| GET/PUT | `/api/v1/settings` | Preferenze utente |
| GET/POST | `/api/v1/backup/export` · `/api/v1/backup/import` | Backup e ripristino del database |

---

## Import da query SDMX (databrowser ISTAT)

Dalla pagina **Indici ISTAT** → **“Importa Query SDMX”** si incolla l'URL *Data* della sezione
**Query SDMX** di `esploradati.istat.it/databrowser` e l'app importa le osservazioni nel catalogo.

- **Asincrono**: Istat può impiegare anche 5-10 minuti sulle query con dimensioni non filtrate;
  l'import gira in background (tetto 10 minuti) e la pagina mostra lo stato fino all'esito. Le modali restano usabili anche con errori lunghi (`maxHeight:90vh` + scroll interno, header/footer sticky).
- **Rate limit Istat**: 5 query/minuto per IP con blocco 1-2 giorni oltre soglia. L'app lo rispetta
  con un limiter condiviso tra interfaccia e script CLI (`sync_indices.py`).
- **Riscrittura automatica periodi**: `endPeriod` con strategie `fixed`/`last_month_end`/`today` (già esistente, invariata) e **nuovo** `startPeriod` con `fixed`/`earliest` (2000)/`expand_1y`/`expand_5y` per rendere l'inizio più vecchio senza toccare l'URL a mano; entrambe applicate su **Riscarica** e preservate alla creazione.
- **Correzione automatica frequenza**: se la frequenza richiesta non ha dati (es. annuale), l'app
  verifica le alternative e importa da sola quella disponibile (es. `A→M`), segnalandolo.
- **Guardie di integrità**: query che mescolerebbero più popolazioni nella stessa serie
  (dimensioni non filtrate es. `DATA_TYPE`, `SEX`, `PROF_STATUS_EMP` per ATECO 95.1, o frequenze miste) vengono rifiutate con **payload strutturato** (`message` + `unfiltered_dimensions` + `suggestion` + `example_url` + `truncated_values`) e **box rosso esplicativo** (“Query troppo ampia: filtri mancanti — ISTAT ha restituito dati con più valori per … che verrebbero mescolati nella serie esistente”) + URL filtrato d'esempio copiabile; se ISTAT risponde `NULL` per quel singolo filtro il box suggerisce di provare un altro valore.
**Svuotamento indice**: espandendo un indice compare **“Svuota indice”** — un modal a doppia
conferma elimina tutte le osservazioni della serie (la serie resta vuota e re-importabile) e
l'operazione viene registrata nell'audit log.

### Query SDMX salvate e provenienza dati

Ogni import SDMX riuscito **salva automaticamente la query** (URL normalizzata, dataflow, chiave, `end_period_strategy` + **nuovo** `start_period_strategy`) e la collega alle serie toccate: la provenienza del dato resta visibile nel catalogo. Sulla riga di una serie con query salvata compaiono:

- **Chip `SDMX`** accanto al nome, con il dataflow in tooltip;
- **`⟳` Riscarica dati** — riesegue la query salvata (job in background, banner di stato con contatori al termine) applicando **entrambe** le strategie: `endPeriod` (già `last_month_end`/`today`/`fixed`) e **nuovo** `startPeriod` (`earliest`→2000, `expand_1y`/`expand_5y` per inizio più vecchio, `fixed` per non toccare); se una frequenza richiesta non ha dati l'app la corregge da sola e la variante corretta viene salvata come query dedicata;
- **`✎` Aggiorna o elimina query** — modifica l'URL (ri-validato) e **le due strategie** (`end_period_strategy` + `start_period_strategy` con preview `startPeriod=2000-01-01`/`2019-01-01` e `endPeriod=2026-07-31`) oppure elimina la provenienza con doppia conferma; **la cancellazione non tocca serie né osservazioni** (l'evento è tracciato nell'audit log). La modale è scrollabile con header/footer sticky.

L'"Aggiorna" salva solo URL e strategie: per ri-scaricare i dati si usa il pulsante **Riscarica**. Una serie può mostrare la più recente tra più query che l'hanno popolata nel tempo (es. varianti di frequenza). Le nuove query ereditano `end_period_strategy=last_month_end` e `start_period_strategy=fixed` di default.
---

## Trasparenza del calcolo: copertura periodi e ordine base/confronto

- **Mesi non registrati da ISTAT**: quando un periodo richiesto non ha osservazioni definitive, il
  calcolo usa la più vicina disponibile (fallback). Nello step Calcolo (e nel report) viene
  segnalato chiaramente — es. *“Periodo di confronto (agosto 2026): il calcolo non ha registrato
  luglio 2026, agosto 2026; è partito dall'osservazione di giugno 2026”*. L'endpoint
  `/calculation/v2/coverage` espone la stessa informazione per ogni serie componente.
- **Ordine dei periodi**: il **periodo base** (data aggiudicazione) deve essere antecedente o uguale
  al **periodo di confronto** (data rilevazione); l'inversione restituirebbe una variazione col
  segno errato. Il wizard blocca il passaggio con un messaggio esplicativo e le API rispondono
  `422`. Esiste un override esplicito di richiesta (`force_inverted_periods`) per allineamenti
  puntuali, ma non è esposto in alcuna interfaccia.

---

## Licenza

Uso interno per pubbliche amministrazioni e professionisti del settore.

## Contributi

Segnala bug o proponi nuove funzionalità via [GitHub Issues](.github/ISSUE_TEMPLATE/).

Autore: [Walter Tosolini](https://www.tosolini.info)
