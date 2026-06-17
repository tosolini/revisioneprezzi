-- Creazione serie ISTAT FABABB per TOL in index_series

-- TOL.1 - TOL.20
INSERT INTO index_series (id, name, source, frequency, normative_category)
VALUES 
  ('FABABB101', 'TOL.1 - Opere edili edifici non tutelati', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB102', 'TOL.2 - Opere edili edifici tutelati', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB103', 'TOL.3 - Scavi archeologici, restauri', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB104', 'TOL.4 - Movimento terra, demolizioni', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB105', 'TOL.5 - Pavimentazioni bituminose', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB106', 'TOL.6 - Strutture acciaio', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB107', 'TOL.7 - Calcestruzzo armato', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB108', 'TOL.8 - Strutture legno', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB109', 'TOL.9 - Gallerie tradizionali', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB110', 'TOL.10 - Gallerie meccanizzate', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB111', 'TOL.11 - Acquedotti, gasdotti', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB112', 'TOL.12 - Opere marittime', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB113', 'TOL.13 - Impianti elettrici AT/MT', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB114', 'TOL.14 - Impianti elettrici, tecnologici', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB115', 'TOL.15 - Impianti meccanici, termici', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB116', 'TOL.16 - Impianti potabilizzazione', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB117', 'TOL.17 - Impianti segnalamento', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB118', 'TOL.18 - Armamento ferroviario', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB119', 'TOL.19 - Fondazioni speciali', 'MIT/ISTAT', 'monthly', 'TOL'),
  ('FABABB120', 'TOL.20 - Conferimento rifiuti', 'MIT/ISTAT', 'monthly', 'TOL');

SELECT 'Create ' || COUNT(*) || ' serie FABABB' FROM index_series WHERE id LIKE 'FABABB%';
