-- Seed data per tol_index_series
-- Associa TOL agli indici ISTAT/MIT pubblicati mensilmente
-- Nota: series_id deve corrispondere agli indici reali ISTAT/MIT

-- TOL.1 - Edifici civili e industriali
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.1', 'ISTAT_TOL1_2023', '2023-01-01', true);

-- TOL.2 - Edifici soggetti a tutela
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.2', 'ISTAT_TOL2_2023', '2023-01-01', true);

-- TOL.3 - Scavi archeologici, restauri
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.3', 'ISTAT_TOL3_2023', '2023-01-01', true);

-- TOL.4 - Movimento terra, demolizioni
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.4', 'ISTAT_TOL4_2023', '2023-01-01', true);

-- TOL.5 - Pavimentazioni bituminose
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.5', 'ISTAT_TOL5_2023', '2023-01-01', true);

-- TOL.6 - Strutture in acciaio
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.6', 'ISTAT_TOL6_2023', '2023-01-01', true);

-- TOL.7 - Strutture in calcestruzzo armato
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.7', 'ISTAT_TOL7_2023', '2023-01-01', true);

-- TOL.8 - Strutture in legno
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.8', 'ISTAT_TOL8_2023', '2023-01-01', true);

-- TOL.9 - Gallerie metodo tradizionale
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.9', 'ISTAT_TOL9_2023', '2023-01-01', true);

-- TOL.10 - Gallerie metodo meccanizzato
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.10', 'ISTAT_TOL10_2023', '2023-01-01', true);

-- TOL.11 - Acquedotti, gasdotti, fognature
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.11', 'ISTAT_TOL11_2023', '2023-01-01', true);

-- TOL.12 - Opere marittime e fluviali
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.12', 'ISTAT_TOL12_2023', '2023-01-01', true);

-- TOL.13 - Impianti elettrici alta/media tensione
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.13', 'ISTAT_TOL13_2023', '2023-01-01', true);

-- TOL.14 - Impianti elettrici, tecnologici
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.14', 'ISTAT_TOL14_2023', '2023-01-01', true);

-- TOL.15 - Impianti meccanici, termici
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.15', 'ISTAT_TOL15_2023', '2023-01-01', true);

-- TOL.16 - Impianti potabilizzazione e depurazione
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.16', 'ISTAT_TOL16_2023', '2023-01-01', true);

-- TOL.17 - Impianti segnalamento, telecomunicazioni
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.17', 'ISTAT_TOL17_2023', '2023-01-01', true);

-- TOL.18 - Armamento ferroviario
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.18', 'ISTAT_TOL18_2023', '2023-01-01', true);

-- TOL.19 - Fondazioni speciali, indagini geotecniche
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.19', 'ISTAT_TOL19_2023', '2023-01-01', true);

-- TOL.20 - Conferimento rifiuti
INSERT INTO tol_index_series (id, tol_code, series_id, valid_from, is_active)
VALUES 
(gen_random_uuid(), 'TOL.20', 'ISTAT_TOL20_2023', '2023-01-01', true);

-- NOTA IMPORTANTE:
-- I series_id sopra (ISTAT_TOL1_2023, ecc.) sono PLACEHOLDER.
-- Devono essere sostituiti con i codici reali delle serie ISTAT/MIT per la revisione prezzi.
-- 
-- Gli indici ISTAT per le TOL sono pubblicati mensilmente dal MIT in collaborazione con ISTAT.
-- Verificare sul sito MIT (www.mit.gov.it) o ISTAT la nomenclatura esatta delle serie storiche.
-- 
-- Formato tipico: "FABABBXXX" dove XXX identifica la TOL
-- Es: FABABB101 per TOL.1, FABABB102 per TOL.2, ecc.
-- (verificare la nomenclatura effettiva)
