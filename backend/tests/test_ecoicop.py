"""Catalogo ECOICOP 2: import, label serie NIC, mapping CPV."""

from app.models.ecoicop_catalog import EcoicopCatalog
from app.models.index_series import IndexSeries
from app.models.tabella_d import CpvTabellaDAssociation, CpvTabellaDMaster
from app.services import ecoicop_importer


def _backup_catalog(db, codes):
    rows = db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code.in_(codes)).all()
    return {r.ecoicop_code: r.description for r in rows}


def _restore_catalog(db, backup):
    for code, desc in backup.items():
        row = db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code == code).first()
        if row:
            row.description = desc
        else:
            db.add(EcoicopCatalog(ecoicop_code=code, description=desc))
    db.commit()


def _payload(codes):
    return {
        "data": {
            "codelists": [
                {
                    "codes": [
                        {"id": code, "name": name, "names": {"it": name}} for code, name in codes
                    ]
                }
            ]
        }
    }


def test_extract_prefers_italian():
    payload = {
        "data": {
            "codelists": [
                {
                    "codes": [
                        {
                            "id": "105",
                            "name": "Istruzione non definita per livello",
                            "names": {
                                "it": "Istruzione non definita per livello",
                                "en": "Education not definable by level",
                            },
                        },
                        {"id": "00", "name": "indice generale", "names": {"it": "indice generale"}},
                    ]
                }
            ]
        }
    }
    codes = ecoicop_importer._extract_codes(payload)
    assert codes == [
        {"code": "105", "description": "Istruzione non definita per livello"},
        {"code": "00", "description": "indice generale"},
    ]
    assert ecoicop_importer._extract_codes({}) == []


class _FakeResp:
    status_code = 200

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


def test_import_from_sdmx_upsert(db, monkeypatch):
    import app.services.ecoicop_importer as imp

    backup = _backup_catalog(db, ["105", "00"])
    monkeypatch.setattr(
        imp.httpx,
        "get",
        lambda *a, **k: _FakeResp(_payload([("105", "Istruzione"), ("00", "Generale")])),
    )
    # rate limiter reale: ok anche se fallisce, l'importer lo ignora
    n, tried = imp.import_from_sdmx(db)
    assert n == 2
    assert tried == ["CL_ECOICOP_2"]
    assert (
        db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code == "105").first().description
        == "Istruzione"
    )
    # idempotente: secondo giro aggiorna senza duplicare
    n2, _ = imp.import_from_sdmx(db)
    assert n2 == 2
    assert db.query(EcoicopCatalog).count() >= 2
    # ripristina valori reali preesistenti
    _restore_catalog(db, backup)


def test_import_endpoint_and_lookup(client, db):
    backup = _backup_catalog(db, ["105"])
    row = db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code == "105").first()
    if row:
        row.description = "Istruzione non definita per livello"
    else:
        db.add(
            EcoicopCatalog(ecoicop_code="105", description="Istruzione non definita per livello")
        )
    db.commit()
    try:
        res = client.get("/api/v1/ecoicop/105")
        assert res.status_code == 200, res.text
        assert res.json() == {"code": "105", "description": "Istruzione non definita per livello"}
        res = client.get("/api/v1/ecoicop/XYZ")
        assert res.status_code == 200
        assert res.json() == {"code": "XYZ", "description": None}
    finally:
        _restore_catalog(db, backup)


def test_search_returns_ecoicop_label(client, db):
    sid = "ISTAT_NIC_ECOICOP2_105"
    if not db.query(IndexSeries).filter(IndexSeries.id == sid).first():
        db.add(
            IndexSeries(
                id=sid,
                name="Prezzi al consumo NIC - Tutte le basi (Ecoicop2) - 105",
                source="ISTAT",
                normative_category="services",
                classification_ref="nic_ecoicop2",
                frequency="monthly",
            )
        )
    backup = _backup_catalog(db, ["105"])
    row = db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code == "105").first()
    if row:
        row.description = "Istruzione non definita per livello"
    else:
        db.add(
            EcoicopCatalog(ecoicop_code="105", description="Istruzione non definita per livello")
        )
    db.commit()
    try:
        res = client.get("/api/v1/indices/search", params={"q": sid, "group": "nic_ecoicop2"})
        assert res.status_code == 200, res.text
        hits = [h for h in res.json() if h["id"] == sid]
        assert hits, res.json()
        assert hits[0]["ecoicop_label"] == "Istruzione non definita per livello"
    finally:
        _restore_catalog(db, backup)


def test_cpv_mapping_includes_ecoicop_label(client, db):
    sid = "ISTAT_NIC_ECOICOP2_105"
    created_series = False
    if not db.query(IndexSeries).filter(IndexSeries.id == sid).first():
        db.add(
            IndexSeries(
                id=sid,
                name="Prezzi al consumo NIC - Tutte le basi (Ecoicop2) - 105",
                source="ISTAT",
                normative_category="services",
                classification_ref="nic_ecoicop2",
                frequency="monthly",
            )
        )
        created_series = True
    # Tabella D autonoma (non dipende dai seed): 80500000-9 -> PC/105
    created_master = False
    if not db.query(CpvTabellaDMaster).filter(CpvTabellaDMaster.cpv_code == "80500000-9").first():
        db.add(
            CpvTabellaDMaster(
                cpv_code="80500000-9",
                cpv_description="Servizi di formazione",
                table_class="D1",
            )
        )
        created_master = True
    created_assoc = False
    if (
        not db.query(CpvTabellaDAssociation)
        .filter(
            CpvTabellaDAssociation.cpv_code == "80500000-9",
            CpvTabellaDAssociation.ateco_code == "105",
        )
        .first()
    ):
        db.add(
            CpvTabellaDAssociation(
                cpv_code="80500000-9",
                table_class="D1",
                position=10,
                index_type="PC",
                classification="ECOICOP",
                ateco_code="105",
                index_description="Corsi d'istruzione e di formazione",
            )
        )
        created_assoc = True
    backup = _backup_catalog(db, ["105"])
    row = db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code == "105").first()
    if row:
        row.description = "Istruzione non definita per livello"
    else:
        db.add(
            EcoicopCatalog(ecoicop_code="105", description="Istruzione non definita per livello")
        )
    # osservazione: serve per available=True
    from datetime import date

    from app.models.index_observation import IndexObservation

    preexisting = (
        db.query(IndexObservation)
        .filter(
            IndexObservation.series_id == sid,
            IndexObservation.ref_period == date(2026, 1, 1),
        )
        .first()
    )
    preexisting_value = (preexisting.value, preexisting.is_definitive) if preexisting else None
    if preexisting:
        db.delete(preexisting)
        db.flush()
    db.add(
        IndexObservation(
            series_id=sid, ref_period=date(2026, 1, 1), value=101.4, is_definitive=True
        )
    )
    db.commit()
    try:
        res = client.post("/api/v1/classify/cpv-index-mapping", json={"cpv_code": "80500000-9"})
        assert res.status_code == 200, res.text
        assocs = res.json()["associations"]
        pc = [a for a in assocs if a["index_type"] == "PC"]
        assert pc, assocs
        assert pc[0]["series_id"] == sid
        assert pc[0]["ecoicop_label"] == "Istruzione non definita per livello"
        assert "105" in (pc[0]["series_name"] or "")
    finally:
        db.query(IndexObservation).filter(IndexObservation.series_id == sid).delete(
            synchronize_session=False
        )
        if preexisting_value is not None:
            db.add(
                IndexObservation(
                    series_id=sid,
                    ref_period=date(2026, 1, 1),
                    value=preexisting_value[0],
                    is_definitive=preexisting_value[1],
                )
            )
        db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code == "105").delete(
            synchronize_session=False
        )
        _restore_catalog(db, backup)
        if created_assoc:
            db.query(CpvTabellaDAssociation).filter(
                CpvTabellaDAssociation.cpv_code == "80500000-9",
                CpvTabellaDAssociation.ateco_code == "105",
            ).delete(synchronize_session=False)
        if created_master:
            db.query(CpvTabellaDMaster).filter(CpvTabellaDMaster.cpv_code == "80500000-9").delete(
                synchronize_session=False
            )
        if created_series:
            db.query(IndexSeries).filter(IndexSeries.id == sid).delete(synchronize_session=False)
        db.commit()


def test_report_series_labels_helper(db):
    from app.api.v1.report_v2 import _collect_report_series_ids, _ecoicop_series_labels

    backup = _backup_catalog(db, ["105", "105091"])
    for code, desc in [
        ("105", "Istruzione non definita per livello"),
        ("105091", "Corsi d'istruzione e formazione non definibili per livello"),
    ]:
        row = db.query(EcoicopCatalog).filter(EcoicopCatalog.ecoicop_code == code).first()
        if row:
            row.description = desc
        else:
            db.add(EcoicopCatalog(ecoicop_code=code, description=desc))
    db.commit()
    try:
        data = {
            "series_id": "ISTAT_NIC_ECOICOP2_105",
            "components": [{"series_id": "ISTAT_NIC_ECOICOP2_105091"}],
            "multi_components": [{"series_id": "ISTAT_PPI_20_D"}],
        }
        assert _collect_report_series_ids(data) == [
            "ISTAT_NIC_ECOICOP2_105",
            "ISTAT_NIC_ECOICOP2_105091",
            "ISTAT_PPI_20_D",
        ]
        expected = {
            "ISTAT_NIC_ECOICOP2_105": "Istruzione non definita per livello",
            "ISTAT_NIC_ECOICOP2_105091": (
                "Corsi d'istruzione e formazione non definibili per livello"
            ),
        }
        assert _ecoicop_series_labels(db, _collect_report_series_ids(data)) == expected
    finally:
        db.query(EcoicopCatalog).filter(
            EcoicopCatalog.ecoicop_code.in_(["105", "105091"])
        ).delete(synchronize_session=False)
        _restore_catalog(db, backup)
