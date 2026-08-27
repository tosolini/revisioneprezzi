"""Test del parsing della Tabella D (Allegato II.2-bis) dal file sorgente."""

from pathlib import Path

import pytest

from scripts.import_tabella_d import normalize_cpv, parse_source

SOURCE = (
    Path(__file__).resolve().parents[2]
    / "source"
    / "Allegato II.2-bis Modalità applicative delle clausole di revisione dei prezzi (DLGS_36_2023).md"  # noqa: E501
)


@pytest.fixture()
def source():
    """File sorgente Tabella D (normalmente gitignorato in `source/`).

    Assente nel checkout CI e nell'immagine Docker: i test che verificano i
    conteggi e gli spot sul documento vengono saltati, non falliti. Il test
    puro di normalizzazione CPV resta attivo ovunque."""
    if not SOURCE.exists():
        pytest.skip(
            "file sorgente Tabella D non presente (source/ è gitignorato): "
            "test eseguibile solo con il file nel checkout"
        )
    return SOURCE


def test_source_exists(source):
    assert source.exists()


def test_master_and_counts(source):
    master, assoc = parse_source(source)
    assert len(master) > 0
    # Conteggi verificati sul file sorgente: la legge dichiara 76 (D.2) e 54 (D.3);
    # per D.1 il file contiene 282 righe (284 nel piano era un conteggio errato).
    by_class: dict[str, int] = {}
    for m in master:
        by_class[m["table_class"]] = by_class.get(m["table_class"], 0) + 1
    assert by_class["D1"] == 282
    assert by_class["D2"] == 76
    assert by_class["D3"] == 54
    assert "CHILDREN" in by_class

    by_table: dict[str, int] = {}
    for a in assoc:
        by_table[a["table_class"]] = by_table.get(a["table_class"], 0) + 1
    assert by_table["D1"] == 282
    assert by_table["D2"] > 76  # ogni CPV D.2 ha 1+ indici
    assert by_table["D3"] > 54


def test_normalize_cpv():
    assert normalize_cpv("50330000- 7") == "50330000-7"
    assert normalize_cpv("221000 00-1") == "22100000-1"
    assert normalize_cpv("03100000- 2") == "03100000-2"
    assert normalize_cpv("85110000") == "85110000"


def test_spot_50330000(source):
    _, assoc = parse_source(source)
    rows = [a for a in assoc if a["cpv_code"] == "50330000-7"]
    assert len(rows) == 2
    assert rows[0]["table_class"] == "D3"
    assert rows[0]["index_type"] == "PPI"
    assert rows[0]["ateco_code"] == "263"
    assert rows[1]["index_type"] == "IR"
    assert rows[1]["ateco_code"] == "951"


def test_spot_03211000_d1(source):
    _, assoc = parse_source(source)
    rows = [a for a in assoc if a["cpv_code"] == "03211000-3"]
    assert len(rows) == 1
    assert rows[0]["table_class"] == "D1"
    assert rows[0]["index_type"] == "PC"
    assert rows[0]["ateco_code"] == "0111"
    assert rows[0]["classification"] == "ECOICOP"


def test_spot_221000_d2(source):
    _, assoc = parse_source(source)
    rows = [a for a in assoc if a["cpv_code"] == "22100000-1"]
    assert len(rows) == 2
    assert (rows[0]["index_type"], rows[0]["ateco_code"]) == ("PC", "0951")
    assert (rows[1]["index_type"], rows[1]["ateco_code"]) == ("PPI", "1812")


def test_special_rows_without_check_digit(source):
    master, assoc = parse_source(source)
    master_codes = {m["cpv_code"] for m in master}
    assert "85110000" in master_codes
    assert "98310000" in master_codes
    # D.3: codice senza cifra di controllo nel file sorgente
    d3_8511 = [a for a in assoc if a["cpv_code"] == "85111000"]
    assert len(d3_8511) == 3
    assert d3_8511[0]["index_type"] == "IR"
    assert d3_8511[0]["ateco_code"] == "9601"
