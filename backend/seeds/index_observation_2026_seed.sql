-- Seed data aggiuntivi per index_observation
-- Aggiunge dati ISTAT più recenti per supportare test wizard

-- Serie ISTAT_PS_BTOB_PUL - Servizi di pulizia
-- Aggiungiamo dati per feb-giu 2026

INSERT INTO index_observation (id, series_id, ref_period, value, is_definitive, created_at)
VALUES 
(gen_random_uuid(), 'ISTAT_PS_BTOB_PUL', '2026-02-01', 170.2, true, NOW()),
(gen_random_uuid(), 'ISTAT_PS_BTOB_PUL', '2026-03-01', 171.5, true, NOW()),
(gen_random_uuid(), 'ISTAT_PS_BTOB_PUL', '2026-04-01', 172.1, true, NOW()),
(gen_random_uuid(), 'ISTAT_PS_BTOB_PUL', '2026-05-01', 173.0, true, NOW()),
(gen_random_uuid(), 'ISTAT_PS_BTOB_PUL', '2026-06-01', 174.2, true, NOW());

-- Verifica
SELECT series_id, ref_period, value, is_definitive 
FROM index_observation 
WHERE series_id = 'ISTAT_PS_BTOB_PUL' 
  AND ref_period >= '2026-01-01'
ORDER BY ref_period;
