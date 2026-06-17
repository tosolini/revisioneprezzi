-- Aggiornamento codici series_id TOL con codici ISTAT reali
-- Fonte: Decreto MIT 7 marzo 2018 n. 49
-- Serie FABABB: Fabbricati e Opere di Architettura

-- Formato: FABABB101 per TOL.1, FABABB102 per TOL.2, etc.

UPDATE tol_index_series SET series_id = 'FABABB101' WHERE tol_code = 'TOL.1' AND series_id = 'ISTAT_TOL1_2023';
UPDATE tol_index_series SET series_id = 'FABABB102' WHERE tol_code = 'TOL.2' AND series_id = 'ISTAT_TOL2_2023';
UPDATE tol_index_series SET series_id = 'FABABB103' WHERE tol_code = 'TOL.3' AND series_id = 'ISTAT_TOL3_2023';
UPDATE tol_index_series SET series_id = 'FABABB104' WHERE tol_code = 'TOL.4' AND series_id = 'ISTAT_TOL4_2023';
UPDATE tol_index_series SET series_id = 'FABABB105' WHERE tol_code = 'TOL.5' AND series_id = 'ISTAT_TOL5_2023';
UPDATE tol_index_series SET series_id = 'FABABB106' WHERE tol_code = 'TOL.6' AND series_id = 'ISTAT_TOL6_2023';
UPDATE tol_index_series SET series_id = 'FABABB107' WHERE tol_code = 'TOL.7' AND series_id = 'ISTAT_TOL7_2023';
UPDATE tol_index_series SET series_id = 'FABABB108' WHERE tol_code = 'TOL.8' AND series_id = 'ISTAT_TOL8_2023';
UPDATE tol_index_series SET series_id = 'FABABB109' WHERE tol_code = 'TOL.9' AND series_id = 'ISTAT_TOL9_2023';
UPDATE tol_index_series SET series_id = 'FABABB110' WHERE tol_code = 'TOL.10' AND series_id = 'ISTAT_TOL10_2023';
UPDATE tol_index_series SET series_id = 'FABABB111' WHERE tol_code = 'TOL.11' AND series_id = 'ISTAT_TOL11_2023';
UPDATE tol_index_series SET series_id = 'FABABB112' WHERE tol_code = 'TOL.12' AND series_id = 'ISTAT_TOL12_2023';
UPDATE tol_index_series SET series_id = 'FABABB113' WHERE tol_code = 'TOL.13' AND series_id = 'ISTAT_TOL13_2023';
UPDATE tol_index_series SET series_id = 'FABABB114' WHERE tol_code = 'TOL.14' AND series_id = 'ISTAT_TOL14_2023';
UPDATE tol_index_series SET series_id = 'FABABB115' WHERE tol_code = 'TOL.15' AND series_id = 'ISTAT_TOL15_2023';
UPDATE tol_index_series SET series_id = 'FABABB116' WHERE tol_code = 'TOL.16' AND series_id = 'ISTAT_TOL16_2023';
UPDATE tol_index_series SET series_id = 'FABABB117' WHERE tol_code = 'TOL.17' AND series_id = 'ISTAT_TOL17_2023';
UPDATE tol_index_series SET series_id = 'FABABB118' WHERE tol_code = 'TOL.18' AND series_id = 'ISTAT_TOL18_2023';
UPDATE tol_index_series SET series_id = 'FABABB119' WHERE tol_code = 'TOL.19' AND series_id = 'ISTAT_TOL19_2023';
UPDATE tol_index_series SET series_id = 'FABABB120' WHERE tol_code = 'TOL.20' AND series_id = 'ISTAT_TOL20_2023';

-- Verifica aggiornamento
SELECT tol_code, series_id, valid_from, valid_to 
FROM tol_index_series 
ORDER BY tol_code;
