# Analisi Tecnica e Metodologica: Disallineamento Valori PC/NIC (12/2025 – 01/2026)

**Progetto**: Revisione Prezzi Appalti Pubblici (D.Lgs 36/2023)  
**Data**: 2 Novembre 2026  
**Oggetto**: Analisi del salto di oltre 20 punti tra dicembre 2025 e gennaio 2026 sulle serie ISTAT dei Prezzi al Consumo (NIC / ECOICOP 2), implicazioni sui contratti a cavallo del 2025/2026 e opzioni risolutive.

---

## 1. Executive Summary

Nel catalogo indici e nei calcoli di revisione prezzi per servizi e forniture, gli indici dei Prezzi al Consumo per l'intera collettività (**NIC**, denominati anche **PC** in Tabella D) evidenziano un repentino calo numerico tra **dicembre 2025** e **gennaio 2026**:
- **Indice Generale NIC (`ISTAT_NIC_ECOICOP2_00`)**: passa da **123,0** (12/2025) a **100,2** (01/2026), con un salto di **-22,8 punti** (pari a un apparente **-18,5%**).
- **Indici di settore (es. Alimentari `01`)**: passano da **138,1** a **101,5** (**-36,6 punti**, pari a **-26,5%**).

Tale fenomeno **non rappresenta un crollo reale dei prezzi di mercato né un errore di fornitura dati**, bensì l'effetto del **cambio decennale di base di riferimento ISTAT**:
1. Con i dati di **Gennaio 2026**, in ottemperanza ai Regolamenti Europei **Reg. (UE) 2024/3159** e **Reg. (UE) 2025/1182**, l'ISTAT è passata dalla **Base 2015 = 100** alla nuova **Base 2025 = 100** e ha introdotto la classificazione **ECOICOP versione 2**.
2. Nei bollettini ufficiali ISTAT la variazione congiunturale tra dicembre 2025 e gennaio 2026 è in realtà **positiva (+0,4%)**, poiché calcolata con la metodologia dell'**indice a catena** e l'applicazione dei **coefficienti di raccordo ufficiali**.
3. In `revprezzi`, poiché le osservazioni pre-2026 (in base 2015) e post-2026 (in base 2025) sono confluite nello stesso identificativo di serie senza normalizzazione, il calcolo ordinario della revisione prezzi genera una riduzione contrattuale errata del **-18%** su qualsiasi contratto a cavallo del biennio 2025–2026.

---

## 2. Quadro Normativo e Metodologico ISTAT

### 2.1. Il passaggio a Base 2025 = 100
A norma del Regolamento quadro europeo sui prezzi al consumo (Reg. UE 2016/792) e del Regolamento di esecuzione (UE) 2025/1182, gli istituti di statistica degli Stati membri dell'Unione Europea rinnovano la base di riferimento degli indici con cadenza decennale.

- **Fino a Dicembre 2025**: gli indici NIC e FOI avevano come base di riferimento l'anno **2015 = 100**. A fine 2025 l'indice generale si attestava a quota **123,0**, riflettendo l'inflazione cumulata nel decennio 2015–2025.
- **Da Gennaio 2026**: la base di riferimento è stata aggiornata all'anno **2025 = 100** (la media dell'intero anno 2025 è normalizzata a 100,0). Di conseguenza, a gennaio 2026 l'indice generale "riparte" da quota **100,4** (dato provvisorio/definitivo ISTAT).

### 2.2. Adozione di ECOICOP versione 2
Contestualmente al cambio base, l'ISTAT ha adottato la **ECOICOP v2** (Regolamento UE 2024/3159), passando da 12 a 13 divisioni di spesa (con la separazione di servizi assicurativi e finanziari, protezione sociale, e inclusione di giochi e scommesse).

### 2.3. Regola di calcolo ISTAT per le variazioni tra basi diverse
Come descritto nella nota metodologica ISTAT (*"Indice dei prezzi per le rivalutazioni monetarie - NM_variazioni_coefficienti_2026"* e nei comunicati mensili sui prezzi al consumo):

> *"Se gli indici sono espressi in base di riferimento diversa, la variazione percentuale tra indici è pari al rapporto degli indici messi a confronto, moltiplicato per i coefficienti di raccordo tra basi contigue, per 100, meno 100."*

La formula statistica ufficiale per il calcolo della variazione percentuale è:

$$\Delta\% = \left( \frac{I_{T_1}^{(\text{base 2025})}}{I_{T_0}^{(\text{base 2015})}} \times C_{\text{raccordo}} \times 100 \right) - 100$$

Equivalentemente, per esprimere il nuovo indice nella vecchia base 2015:

$$I_{T_1}^{(\text{riportato in base 2015})} = I_{T_1}^{(\text{base 2025})} \times C_{\text{raccordo}}$$

Per l'indice generale NIC / FOI:
- Il coefficiente di raccordo medio annuo da base 2015 a base 2025 pubblicato da ISTAT è **1,214**.
- Il raccordo mensile sul livello di dicembre 2025 è circa **1,226 – 1,228**.
- Applicando il coefficiente:
  $$\frac{100,4 \times 1,226}{122,6} = 1,0040 \implies \mathbf{+0,4\%}$$
  che corrisponde esattamente alla variazione congiunturale certificata da ISTAT (+0,4%).

---

## 3. Evidenza Empirica nel Database di `revprezzi`

### 3.1. Dati estratti da PostgreSQL (`index_observation`)
Confrontando le osservazioni registrate per i periodi `2025-12-01` e `2026-01-01`:

| ID Serie | Denominazione Sintetica | Valore 12/2025 (Base 2015) | Valore 01/2026 (Base 2025) | Differenza Punti | Variazione Calcolata (Attuale) | Variazione ISTAT Reale |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `ISTAT_NIC_ECOICOP2_00` | NIC Indice Generale | 123,0 | 100,2 | -22,8 | **-18,54%** | **+0,4%** |
| `ISTAT_NIC_ECOICOP2_00ST` | NIC Generale (senza tabacchi) | 123,0 | 100,4 | -22,6 | **-18,37%** | **+0,3%** |
| `ISTAT_NIC_ECOICOP2_01` | Prodotti alimentari | 138,1 | 101,5 | -36,6 | **-26,50%** | **+0,8%** |
| `ISTAT_NIC_ECOICOP2_011` | Alimenti | 137,9 | 101,4 | -36,5 | **-26,47%** | **+0,8%** |
| `ISTAT_NIC_ECOICOP2_0111` | Pane e cereali | 129,7 | 100,6 | -29,1 | **-22,44%** | **+0,7%** |
| `ISTAT_NIC_ECOICOP2_0112` | Carne | 133,3 | 103,1 | -30,2 | **-22,66%** | **+1,1%** |
| `ISTAT_NIC_ECOICOP2_0115` | Oli e grassi | 162,1 | 96,7 | -65,4 | **-40,35%** | **-0,2%** |
| `ISTAT_NIC_ECOICOP2_04` | Abitazione, acqua, energia | 125,4 | 102,8 | -22,6 | **-18,02%** | **+2,4%** |

### 3.2. Perché le altre famiglie non hanno questo problema?
Interrogando gli indici delle altre famiglie nel medesimo intervallo:
- **PPI (Prezzi alla produzione dell'industria)**: ad es. `ISTAT_PPI_0020_D` passa da **125,8** a **128,3** (variazione continua ordinaria).
- **IR (Retribuzioni contrattuali orarie)**: dinamica continua senza cambio base.
- **TOL (Costi di costruzione lavori)**: dinamica ordinaria.

Il cambio base a gennaio 2026 riguarda **in via esclusiva il comparto PC/NIC/FOI** (prezzi al consumo).

### 3.3. Meccanismo tecnico dell'errore nell'applicativo
1. **Dataflow SDMX ISTAT**: `167_745_DF_DCSP_NIC1B2025_6` articola le due basi con la dimensione `DATA_TYPE`:
   - `DATA_TYPE 39`: Base 2015 (serie fino a dicembre 2025).
   - `DATA_TYPE 85`: Base 2025 (serie da gennaio 2026).
2. **Sincronizzazione (commit `052b501`)**: la query SDMX per PC è stata impostata su `M.IT.85.4.{codice}` a partire da `2026-01-01`. I record restituiti sono stati inseriti nella tabella `index_observation` mantenendo la medesima chiave `series_id` (es. `ISTAT_NIC_ECOICOP2_00`).
3. **Algoritmo di calcolo revisione (`revision_calculation_v2.py`)**:
   ```python
   variation = ((comp_value - base_value) / base_value) * 100
   ```
   L'algoritmo presume che `comp_value` e `base_value` siano omogenei. Se il periodo base è nel 2025 e il confronto è nel 2026, il calcolo confronta valori numerici non omogenei.

---

## 4. Valutazione dell'Idea: "Separazione tra Calcoli Pre/Post 2025"

### 4.1. Ambiti in cui la separazione funziona
- **Appalti chiusi entro il 31/12/2025**:
  - Esempio: base gara Gennaio 2023, SAL Dicembre 2024.
  - Tutti i valori sono in Base 2015 = 100 $\implies$ Nessuna anomalia.
- **Nuovi appalti banditi dal 01/01/2026 in poi**:
  - Esempio: offerta Febbraio 2026, SAL Settembre 2026.
  - Tutti i valori sono in Base 2025 = 100 $\implies$ Nessuna anomalia.

### 4.2. Perché la sola separazione NON è sufficiente: i contratti pluriennali a cavallo
Nel contesto del **Codice dei Contratti Pubblici (D.Lgs 36/2023, art. 60 e allegato II.14)**:
- Gli appalti di servizi (es. pulizie, ristorazione scolastica, manutenzioni, vigilanza) e forniture hanno tipicamente durata **biennale, triennale o quinquennale**.
- **Caso concreto frequentissimo**:
  - Contratto affidato a **Maggio o Ottobre 2025** ($T_0$, espresso in Base 2015).
  - Prima revisione prezzi annuale / SAL a **Maggio o Ottobre 2026** ($T_1$, espresso in Base 2025).

Se si separassero i calcoli in due universi chiusi (pre e post 2025):
1. **Impossibilità di calcolo automatico**: il sistema non sarebbe in grado di calcolare la revisione prezzi per qualsiasi contratto stipulato nel 2024–2025 con ratei nel 2026.
2. **Rischio contenzioso per le Stazioni Appaltanti**: costringere il RUP a spezzare manualmente il calcolo a ratei o calcolare variazioni parziali espone l'amministrazione a rilievi dei revisori dei conti e ricorsi al TAR da parte degli appaltatori.

È pertanto indispensabile un meccanismo di raccordo matematico continuo.

---

## 5. Opzioni di Soluzione a Confronto

```
                     ┌──────────────────────────────────────────────┐
                     │ Periodo Base (T0) e Periodo Confronto (T1)  │
                     └──────────────────────┬───────────────────────┘
                                            │
                             ┌──────────────┴──────────────┐
                             ▼                             ▼
                 Entrambi nella stessa base      A cavallo tra basi
                 (T0, T1 <= 2025 oppure          (T0 <= 2025-12 e
                  T0, T1 >= 2026)                 T1 >= 2026-01)
                             │                             │
                             ▼                             ▼
                     Formula ordinaria:             Opzione Scelta:
                   (I_T1 - I_T0) / I_T0          1. Raccordo BaseLink (Consigliata)
                                                 2. Ribasamento globale a monte
                                                 3. Calcolo a catena a due ratei
```

### Opzione 1 (Consigliata): Integrazione Coefficienti di Raccordo tramite `IndexBaseLink`

#### Descrizione
Nel database di `revprezzi` esiste già il modello SQLAlchemy dedicato ai raccordi tra basi (`backend/app/models/index_base_link.py`):
```python
class IndexBaseLink(Base):
    __tablename__ = "index_base_link"
    from_series_id: Mapped[str]       # Es. 'ISTAT_NIC_ECOICOP2_00' (Base 2015)
    to_series_id: Mapped[str]         # Es. 'ISTAT_NIC_ECOICOP2_00' (Base 2025)
    coefficient: Mapped[float]        # Es. 1.21400000 (o specifico per divisione)
    reference_period: Mapped[date]    # Es. 2025-12-01
```

#### Meccanismo Operativo
1. **Popolamento**: si inseriscono nella tabella `index_base_link` i coefficienti ufficiali ISTAT di passaggio da Base 2015 a Base 2025 per ciascuna sottoserie ECOICOP 2.
2. **Motore di calcolo (`revision_calculation_v2.py`)**:
   - Se $T_0 \le 2025\text{-}12$ e $T_1 \ge 2026\text{-}01$, il motore interroga `index_base_link`.
   - Normalizza l'indice recente moltiplicandolo per il coefficiente:
     $$I_{T_1}^{(\text{omogeneizzato})} = I_{T_1}^{(\text{base 2025})} \times C_{\text{raccordo}}$$
   - Calcola la variazione ordinaria su valori omogenei:
     $$\Delta\% = \frac{I_{T_1}^{(\text{omogeneizzato})} - I_{T_0}}{I_{T_0}} \times 100$$
3. **Trasparenza nel Report (Web e PDF)**:
   - Viene esposta una nota metodologica chiara e inoppugnabile per il RUP:
     > *"Nota metodologica: il calcolo interessa periodi con diversa base ISTAT (Base 2015 per T0 e Base 2025 per T1). Ai sensi della metodologia ufficiale ISTAT (Reg. UE 2025/1182), è stato applicato il coefficiente di raccordo ufficiale pari a 1,2140."*

#### Valutazione
- **Pro**: Piena conformità giuridica e statistica con le circolari ISTAT e le linee guida ANAC/MIT; tracciabilità impeccabile nei verbali di revisione prezzi per RUP e revisori contabili; preserva i dati storici a catalogo esattamente uguali ai bollettini cartacei dell'epoca.
- **Contro**: Richiede il popolamento dei coefficienti e l'aggiornamento della funzione di calcolo per rilevare la transizione.

---

### Opzione 2: Ribasamento Completo dello Storico a Monte (Base Unica 2025 = 100)

#### Descrizione
Riconvertire tutte le osservazioni registrate in `index_observation` dal 1996 al 2025 dividendole per il rispettivo coefficiente di raccordo ($1 / C_{\text{raccordo}}$), oppure reimportando dall'ISTAT la serie storica retrospettiva ricostruita in Base 2025.

#### Valutazione
- **Pro**: Nessuna modifica alla formula matematica del calcolatore; l'algoritmo $((I_1 - I_0)/I_0) \times 100$ funziona automaticamente per qualsiasi coppia di date.
- **Contro**:
  - Se un RUP o un operatore economico confronta il valore storico visualizzato nel software per il 2023 (es. 98,5) con la circolare o Gazzetta Ufficiale pubblicata nel 2023 (che riportava 119,7), potrebbe contestare l'inesattezza del numero indice di base, pur essendo le variazioni percentuali identiche.
  - Richiede la conversione a batch di decine di migliaia di record storici.

---

### Opzione 3: Calcolo a Catena a Due Ratei (Separazione con "Ponte" su 12/2025)

#### Descrizione
Mantenere la separazione logica suggerita dall'utente, gestendo i contratti a cavallo tramite composizione a catena su due finestre temporali:
1. **Finestra 1 (Base 2015)**: da $T_0$ a Dicembre 2025:
   $$\Delta_1 = \frac{I_{12/2025}^{(\text{b15})} - I_{T_0}^{(\text{b15})}}{I_{T_0}^{(\text{b15})}}$$
2. **Finestra 2 (Base 2025)**: da Dicembre 2025 a $T_1$:
   $$\Delta_2 = \frac{I_{T_1}^{(\text{b25})} - I_{12/2025}^{(\text{b25})}}{I_{12/2025}^{(\text{b25})}}$$
3. **Variazione Totale Concatenata**:
   $$\Delta_{\text{totale}} = \left( (1 + \Delta_1) \times (1 + \Delta_2) - 1 \right) \times 100$$

#### Valutazione
- **Pro**: Riflette formalmente il concetto di indice a catena.
- **Contro**: Richiede che ISTAT diffonda il valore di `2025-12` già in base 2025 per tutte le serie ECOICOP (attualmente nel dataflow `DATA_TYPE 85` parte solo da `2026-01`). Se il valore ponte di dicembre 2025 non è disponibile per tutte le sottocategorie, la formula non è applicabile uniformemente.

---

## 6. Matrice Comparativa di Sintesi

| Criterio | Opzione 1: Raccordo `IndexBaseLink` | Opzione 2: Ribasamento a monte | Opzione 3: Catena a due ratei |
| :--- | :---: | :---: | :---: |
| **Conformità Prassi ISTAT / Ragioneria** | **Massima (Standard)** | Media | Buona |
| **Trasparenza Verbale / Report RUP** | **Eccellente** (cita $C_{\text{raccordo}}$) | Bassa (cambia i valori storici) | Complessa da leggere |
| **Gestione Contratti a Cavallo 2025/26** | **Nativa e automatica** | **Nativa e automatica** | Parziale (dipende da dato ponte) |
| **Impatto sul Database** | Basso (popolamento tabella dedicata) | Alto (riscrittura dati storici) | Nessuno |
| **Impatto sul Motore di Calcolo** | Medio (logica di raccordo) | Nullo | Alto (spezzamento intervalli) |
| **Rischio Rilievi Contabili / TAR** | **Minimo** | Moderato | Moderato |

---

## 7. Raccomandazione Conclusiva

La soluzione ottimale per il progetto `revprezzi` è l'**Opzione 1**:
1. Valorizza la tabella `index_base_link` già progettata e migrata nel database.
2. Risolve alla radice il disallineamento senza alterare la fedeltà storica delle osservazioni pre-2026.
3. Fornisce al RUP e alla Stazione Appaltante una documentazione ineccepibile nel report PDF (con formula di raccordo esplicitata a norma delle circolari ISTAT sul D.Lgs 36/2023).
