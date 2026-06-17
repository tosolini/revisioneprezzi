-- Seed dati ISTAT di test per i codici FABABB TOL (2025-2026)
-- Questi sono dati di esempio per testing, non dati reali ISTAT

-- TOL.1 (FABABB101) - Opere edili edifici non tutelati
INSERT INTO index_observation (id, series_id, ref_period, value, is_definitive)
VALUES 
  (gen_random_uuid(), 'FABABB101', '2025-01-01', 135.5, true),
  (gen_random_uuid(), 'FABABB101', '2025-06-01', 141.2, true);

-- TOL.5 (FABABB105) - Pavimentazioni bituminose
INSERT INTO index_observation (id, series_id, ref_period, value, is_definitive)
VALUES 
  (gen_random_uuid(), 'FABABB105', '2025-01-01', 142.8, true),
  (gen_random_uuid(), 'FABABB105', '2025-06-01', 149.3, true);

-- TOL.7 (FABABB107) - Calcestruzzo armato
INSERT INTO index_observation (id, series_id, ref_period, value, is_definitive)
VALUES 
  (gen_random_uuid(), 'FABABB107', '2025-01-01', 138.2, true),
  (gen_random_uuid(), 'FABABB107', '2025-06-01', 143.9, true);

-- TOL.11 (FABABB111) - Acquedotti, gasdotti
INSERT INTO index_observation (id, series_id, ref_period, value, is_definitive)
VALUES 
  (gen_random_uuid(), 'FABABB111', '2025-01-01', 140.1, true),
  (gen_random_uuid(), 'FABABB111', '2025-06-01', 145.8, true);

-- Aggiungi altre TOL per testing completo
INSERT INTO index_observation (id, series_id, ref_period, value, is_definitive)
VALUES 
  (gen_random_uuid(), 'FABABB102', '2025-01-01', 133.4, true),
  (gen_random_uuid(), 'FABABB102', '2025-06-01', 138.9, true),
  (gen_random_uuid(), 'FABABB106', '2025-01-01', 151.2, true),
  (gen_random_uuid(), 'FABABB106', '2025-06-01', 157.5, true),
  (gen_random_uuid(), 'FABABB113', '2025-01-01', 137.8, true),
  (gen_random_uuid(), 'FABABB113', '2025-06-01', 143.2, true);

SELECT 'Caricati ' || COUNT(*) || ' indici FABABB per testing' 
FROM index_observation 
WHERE series_id LIKE 'FABABB%';
