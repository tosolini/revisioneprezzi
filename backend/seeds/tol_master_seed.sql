-- Seed per tabella tol_master - 20 Tipologie Omogenee Lavorazioni
-- Fonte: D.lgs 36/2023 Allegato II.2-bis Tabella A.1 e A.2

-- TOL Generali (non specializzate)
INSERT INTO tol_master (code, sequence, short_description, full_description, is_specialized, notes) VALUES
('TOL.1', 1, 
 'Opere edili su edifici e manufatti non soggetti a tutela dei beni culturali',
 'Riguarda la nuova costruzione, la manutenzione, la ristrutturazione o il consolidamento di edifici civili e industriali non soggetti a tutela dei beni culturali quali, in via esemplificativa, le residenze, le carceri, le scuole, le caserme, gli uffici, i teatri, gli ospedali, gli stadi, gli edifici per le industrie, gli edifici per parcheggi, le stazioni ferroviarie e metropolitane e gli edifici aeroportuali. Include, in via esemplificativa e non esaustiva: infissi e rivestimenti interni ed esterni, pavimentazioni, massetti e sottofondi, solai (esclusi quelli interamente in cemento armato), altri manufatti in materie plastiche, materiali vetrosi e simili, murature e tramezzature comprensive di intonacatura, rasatura, tinteggiatura, verniciatura, opere di finitura quali isolamenti termici e acustici, controsoffittature, barriere al fuoco e opere di impermeabilizzazione, facciate continue e coperture in alluminio, apparecchi di appoggio in gomma.',
 false, 
 'Esclude: impianti, strutture in legno/acciaio/c.a., scavi, demolizioni'),

('TOL.2', 2,
 'Opere edili su edifici e manufatti soggetti a tutela dei beni culturali',
 'Riguarda la manutenzione, la ristrutturazione o il consolidamento di edifici civili e industriali soggetti a tutela dei beni culturali quali, in via esemplificativa, le residenze, le carceri, le scuole, gli ospedali, le caserme, gli uffici, i teatri, gli stadi, gli edifici per le industrie, gli edifici per parcheggi, le stazioni ferroviarie e metropolitane e gli edifici aeroportuali. Include, in via esemplificativa e non esaustiva: infissi e rivestimenti interni ed esterni, pavimentazioni, massetti e sottofondi, solai (esclusi quelli interamente in cemento armato), altri manufatti in materie plastiche, materiali vetrosi e simili, murature e tramezzature comprensive di intonacatura, rasatura, tinteggiatura, verniciatura, opere di finitura quali isolamenti termici e acustici, controsoffittature, barriere al fuoco e opere di impermeabilizzazione, facciate continue e coperture in alluminio, apparecchi di appoggio in gomma.',
 false,
 'Beni culturali tutelati. Esclude: impianti, strutture, scavi, demolizioni'),

('TOL.5', 5,
 'Pavimentazioni in conglomerato bituminoso',
 'Riguarda la nuova costruzione, la manutenzione o la ristrutturazione di pavimentazioni in conglomerato bituminoso. Include in via esemplificativa e non esaustiva: le pavimentazioni stradali, di piazzali e marciapiedi, le impermeabilizzazioni a base di materiali bituminosi di impalcati, la segnaletica orizzontale.',
 false,
 'Include segnaletica orizzontale. Esclude: pavimentazioni c.a., strutture, scavi'),

('TOL.9', 9,
 'Gallerie e opere d''arte nel sottosuolo realizzate con metodo tradizionale',
 'Riguarda la nuova costruzione attraverso il metodo di scavo tradizionale e la manutenzione, la ristrutturazione e la messa in sicurezza delle opere d''arte in sotterraneo, qualsiasi sia il loro grado di importanza. Comprende in via esemplificativa gallerie naturali, trafori, passaggi sotterranei, tunnel, rivestimenti primari e definitivi, impermeabilizzazioni, strati separatori, segnaletica di emergenza, perforazioni e iniezioni, infilaggi sub orizzontali, armatura metallica e conglomerato cementizio per opere di sostegno e consolidamento, le centine e le opere di finitura.',
 false,
 'Metodo tradizionale. Esclude: impianti, pavimentazioni bituminose'),

('TOL.10', 10,
 'Gallerie e opere d''arte nel sottosuolo realizzate con metodo meccanizzato',
 'Riguarda la nuova costruzione attraverso il metodo di scavo meccanizzato. Comprende in via esemplificativa gallerie naturali, trafori, passaggi sotterranei, tunnel, rivestimenti, impermeabilizzazioni, strati separatori, segnaletica di emergenza, perforazioni e iniezioni, infilaggi sub orizzontali, armatura metallica e conglomerato cementizio per opere di sostegno e consolidamento, opere di finitura, ecc.',
 false,
 'Metodo meccanizzato. Esclude: impianti, pavimentazioni bituminose'),

('TOL.11', 11,
 'Acquedotti, gasdotti, opere di irrigazione e fognature',
 'Riguarda la costruzione, la manutenzione o la ristrutturazione di interventi a rete, gli acquedotti, le fognature, i gasdotti, gli oleodotti, le torri piezometriche, la rete di distribuzione all''utente finale, che siano necessari per attuare il "servizio idrico integrato" ovvero per trasportare ai punti di utilizzazione fluidi aeriformi o liquidi. Include, in via esemplificativa e non esaustiva: la fornitura e la posa in opera delle tubazioni e dei manufatti idraulici in materiale plastico e di tutte le componenti accessorie, gli impianti elettromeccanici di sollevamento, realizzate all''aperto e/o in galleria.',
 false,
 'Include tubazioni plastiche. Esclude: impianti interni, strutture, scavi'),

('TOL.12', 12,
 'Opere marittime e lavori di dragaggio, opere fluviali e di difesa del suolo',
 'Riguarda la costruzione, la manutenzione o la ristrutturazione di interventi comunque realizzati, in acque dolci e salate, che costituiscono terminali per la mobilità su "acqua" ovvero opere di difesa del territorio dalle stesse acque dolci o salate, compresa la pulizia o bonifica idraulica. Include, in via esemplificativa e non esaustiva: scavi in alveo, scavi per l''apertura di nuovi canali, formazione di rilevati arginali, realizzazione di scogliere e relativi strati di base e a protezione delle fondazioni, le perforazioni, le iniezioni di miscele di acqua e cemento e le tubazioni in resina per interventi di consolidamento, la fornitura e la posa in opera di gabbioni metallici, le lavorazioni finalizzate alla difesa e/o bonifica del mare e dei fiumi.',
 false,
 'Include scavi in alveo, gabbioni. Esclude: impianti, strutture in acciaio/c.a.'),

('TOL.13', 13,
 'Impianti per la produzione, trasformazione e distribuzione di energia elettrica in alta e media tensione, per la trazione elettrica e l''illuminazione pubblica',
 'Riguarda la costruzione, la manutenzione o la ristrutturazione degli interventi a rete che sono necessari per la produzione, distribuzione ad alta e media tensione e per la trasformazione e distribuzione a bassa tensione all''utente finale di energia elettrica, gli impianti fotovoltaici, gli impianti eolici, geotermici e gli impianti di cogenerazione; la costruzione, la manutenzione e la ristrutturazione degli impianti di pubblica illuminazione, da realizzare all''esterno degli edifici; la costruzione, la manutenzione o ristrutturazione degli impianti per la trazione elettrica di qualsiasi ferrovia, metropolitana o linea tranviaria.',
 false,
 'Include fotovoltaico, eolico, illuminazione pubblica. Esclude: tralicci, pali');

-- TOL Specializzate (hanno precedenza nell'assegnazione)
INSERT INTO tol_master (code, sequence, short_description, full_description, is_specialized, notes) VALUES
('TOL.3', 3,
 'Scavi archeologici, restauri specialistici di beni del patrimonio culturale e di interesse storico',
 'Riguarda gli scavi archeologici e le attività strettamente connesse da eseguirsi sia in aree dichiarate di interesse culturale sia in aree non dichiarate, condotti secondo normativa vigente. Per scavi archeologici si intendono anche quelli preparatori alla nuova costruzione, alla ristrutturazione, al restauro ed alla manutenzione da progettarsi, eseguirsi ed effettuarsi da imprese in possesso dei requisiti e della manodopera specializzata, secondo normativa vigente. Sono altresì inclusi gli scavi archeologici subacquei. Riguarda interventi relativi alla conservazione, alla diagnostica, al monitoraggio, alla manutenzione e al restauro di beni culturali di qualsiasi genere e materiale in tutti i tipi di contesto - museale, archeologico, di cantiere e/o laboratorio - effettuati da imprese qualificate e mano d''opera specializzata secondo la normativa vigente.',
 true,
 'Richiede imprese qualificate e manodopera specializzata'),

('TOL.4', 4,
 'Lavori di movimento terra, demolizioni, opere di protezione ambientale, ingegneria naturalistica e opere a verde',
 'Riguarda lo scavo e i movimenti terra di qualsiasi genere, trincee e rilevati, ripristino, modifica e bonifica di volumi di terra, realizzati qualunque sia la natura del terreno da scavare, ripristinare e bonificare, i campionamenti di terreni e le analisi chimiche, le demolizioni in genere, compreso lo smontaggio di impianti, la demolizione completa di edifici e il taglio di strutture in cemento armato, le attività di raccolta dei materiali di risulta ed il loro conferimento, la realizzazione delle cunette, caditoie, canalette in terra o in calcestruzzo direttamente relazionate con i movimenti terra, la realizzazione del verde urbano, compresi gli arredi urbani e le opere a verde.',
 true,
 'Include demolizioni, bonifiche, verde urbano. Rifiuti: TOL.20'),

('TOL.6', 6,
 'Strutture, opere di ingegneria e manufatti in acciaio',
 'Riguarda la produzione in stabilimenti industriali, il montaggio in situ e più in generale la nuova costruzione, la manutenzione e la ristrutturazione di strutture, opere di ingegneria e manufatti realizzati in acciaio, compresi gli edifici in carpenteria pesante e leggera, ponti, viadotti e profilati, lavorazioni e trattamenti protettivi delle strutture in acciaio, i dispositivi strutturali quali, in via esemplificativa e non esaustiva, qualsiasi tipologia di giunti di dilatazione, di apparecchi di appoggio, di dispositivi di ancoraggio e di ritegni antisismici, compresi elementi quali rotaie, paraurti ferroviari, dispositivi di sicurezza stradale in acciaio, segnaletica stradale verticale, tralicci e pali, recinzioni, lamiere per copertura chiusini, canalette, passerelle portacavi, canali di gronda, portali stradali e ferroviari, reti paramassi, scale, tubi in acciaio di qualsiasi tipologia e applicazione.',
 true,
 'Include carpenteria, dispositivi strutturali, tensostrutture'),

('TOL.7', 7,
 'Strutture, opere di ingegneria e manufatti in calcestruzzo armato, anche prefabbricato',
 'Riguarda la nuova costruzione, la manutenzione o la ristrutturazione di strutture, opere di ingegneria e manufatti realizzati in cemento armato normale o precompresso, gettato in opera o prefabbricato, in elevazione o in fondazione, comprese le casseforme, l''acciaio di armatura e le reti d''acciaio elettrosaldate, compresi elementi particolari quali ad esempio, in via esemplificativa e non esaustiva, pavimentazioni in calcestruzzo, cunicoli, pozzetti, cordoli, tubi prefabbricati, traverse ferroviarie, barriere stradali tipo New Jersey ed altri profili redirettivi in calcestruzzo anche per gallerie stradali, blocchi di fondazione per pali, apparecchi di appoggio in gomma, pannelli di calcestruzzo prefabbricato, canalette ecc. Riguarda altresì la realizzazione di opere atte a migliorare la capacità resistente e la duttilità delle strutture in cemento armato o in muratura mediante l''applicazione di materiali compositi fibrorinforzati (FRP).',
 true,
 'Include c.a. normale e precompresso, prefabbricati, FRP. Esclude: fondazioni speciali'),

('TOL.8', 8,
 'Strutture, opere di ingegneria e manufatti in legno',
 'Riguarda la nuova costruzione, la manutenzione o la ristrutturazione di strutture, opere di ingegneria e manufatti realizzati interamente o nella maggior parte in legno, compresi elementi particolari quali ad esempio, in via esemplificativa e non esaustiva, strutture portanti, tamponature, infissi, rivestimenti, pareti, coperture, la impermeabilizzazione o copertura con tegole o similari, scale, pavimenti, pannellature, ecc. Si includono anche la eventuale verniciatura e/o protezione esterna o interna del legno.',
 true,
 'Strutture e manufatti prevalentemente in legno, incluse finiture'),

('TOL.14', 14,
 'Impianti elettrici, tecnologici, radiotelefonici e antintrusione',
 'Riguarda la fornitura, l''installazione, la manutenzione o la ristrutturazione di un insieme di impianti elettrici, tecnologici, antintrusione, antincendio (esclusa la parte idraulica), telefonici, radiotelefonici, televisivi nonché di reti di trasmissione dati e simili, per fabbricati e per la sicurezza in galleria. Include, in via esemplificativa e non esaustiva: le cabine, gli armadi, i quadri elettrici, i cavi, le centraline di controllo a distanza, i rilevatori gas, le videocamere, gli apparecchi illuminanti da interno, i gruppi di continuità, ecc.',
 true,
 'Per edifici e gallerie. Esclude: impianti meccanici/termici'),

('TOL.15', 15,
 'Impianti meccanici, termici, di condizionamento, idrico sanitari e trasportatori',
 'Riguarda la fornitura, l''installazione, la manutenzione o la ristrutturazione di impianti meccanici, idrosanitari, del gas, antincendio (solo la parte idraulica), termici e per il condizionamento del clima, pneumatici e di sollevamento e trasporto, per fabbricati e per la sicurezza in galleria. Include, in via esemplificativa e non esaustiva: le tubazioni in materiale plastico di adduzione e di scarico, i raccordi, le valvole, le pompe, le caldaie, i condizionatori, i sistemi di ventilazione dell''aria, i filtri, i sanitari, le cassette di scarico, gli idranti, gli ascensori, le scale mobili, ecc.',
 true,
 'Impianti meccanici, termici, idraulici per edifici e gallerie'),

('TOL.16', 16,
 'Impianti di potabilizzazione e depurazione',
 'Riguarda la fornitura, l''installazione, la manutenzione o la ristrutturazione di impianti di potabilizzazione e depurazione. Include, in via esemplificativa e non esaustiva: le tubazioni in materiale plastico di adduzione e di scarico, i raccordi, le valvole, le pompe, i filtri, la ghiaia e sabbia, le centrifughe, le coclee, i ventilatori, ecc.',
 true,
 'Impianti specifici per trattamento acque'),

('TOL.17', 17,
 'Impianti di segnalamento, sicurezza del traffico e telecomunicazioni',
 'Riguarda la nuova costruzione, la manutenzione o la ristrutturazione di impianti di telecomunicazioni e gli impianti automatici per la segnaletica luminosa e la sicurezza del traffico stradale, ferroviario, metropolitano o tranviario, aeroportuale, compreso il rilevamento e l''elaborazione delle informazioni. Include, in via esemplificativa e non esaustiva: le tecnologie hardware e software di elaborazione dei dati per il controllo a distanza, i sistemi di radiotrasmissione dei dati, i quadri, gli apparecchi di segnalazione luminosa, i pannelli a messaggio variabile, i sistemi di automazione e manovra elettrica, i sistemi di alimentazione, i sistemi di monitoraggio e diagnostica, i cavi elettrici e di trasmissione dati, le canalizzazioni.',
 true,
 'Segnaletica e sicurezza traffico. Esclude: tralicci, pali, fondazioni'),

('TOL.18', 18,
 'Armamento ferroviario',
 'Riguarda la nuova costruzione, la manutenzione o la ristrutturazione dell''armamento ferroviario. Include, in via esemplificativa e non esaustiva: binari, rotaie, traverse, pietrisco, ballast, scambi, deviatoi, apparecchi di dilatazione, giunzioni, sistemi di fissaggio, dispositivi antivibranti, attraversamenti pedonali, ecc.',
 true,
 'Specifico per armamento ferroviario. Rifiuti: TOL.20'),

('TOL.19', 19,
 'Opere di fondazione speciale, indagini geologiche e geotecniche',
 'Riguarda la nuova costruzione, la manutenzione o la ristrutturazione di fondazioni profonde e speciali di qualsiasi tipo, le indagini geologiche, geognostiche e geotecniche preliminari e durante l''esecuzione delle opere. Include, in via esemplificativa e non esaustiva: pali di fondazione di qualsiasi tipo e tecnologia, diaframmi, micropali, consolidamenti del terreno, jet-grouting, tiranti, chiodature, palificate, paratie, berlinesi, soil-nailing, sondaggi geognostici, prove penetrometriche, carotaggi, prove di carico, monitoraggio geotecnico, ecc.',
 true,
 'Fondazioni profonde e indagini. Rifiuti: TOL.20'),

('TOL.20', 20,
 'Conferimento rifiuti a impianto di smaltimento o recupero',
 'Riguarda il conferimento a impianto di smaltimento o recupero dei rifiuti prodotti dalle lavorazioni. Gli oneri relativi alla componente rifiuti si intendono sempre ricompresi all''interno delle singole TOL, ad eccezione delle TOL 4, 9, 10, 18 e 19. Per queste cinque TOL, il progettista valuta l''elemento di costo relativo ai rifiuti, facendo riferimento alla TOL 20, e individuandone il relativo peso percentuale.',
 true,
 'Solo per TOL 4, 9, 10, 18, 19 quando rifiuti sono elemento di costo significativo');

-- Nota: Gli indici TOL effettivi dovranno essere popolati nella tabella tol_index_series
-- con le serie ISTAT/MIT pubblicate dal Ministero delle Infrastrutture e dei Trasporti
