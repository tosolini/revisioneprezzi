"""CUP multipli sulla pratica + errori leggibili (mai 500) su overflow campi."""

import pytest

from app.schemas.case import parse_cig_field, parse_cup_field

CUP1 = "A" * 15
CUP2 = "B" * 15
CUP3 = "c3d4e5f6g7h8i9j0"[:15]


def test_parse_cup_single():
    assert parse_cup_field(CUP1) == CUP1
    assert parse_cup_field(None) is None
    assert parse_cup_field("   ") is None


def test_parse_cup_multi_normalized():
    raw = f"  {CUP1.lower()} , {CUP2};{CUP3}  "
    assert parse_cup_field(raw) == f"{CUP1}, {CUP2}, {CUP3.upper()}"


def test_parse_cup_invalid():
    with pytest.raises(ValueError, match="CUP non validi"):
        parse_cup_field(f"{CUP1}, TROPPOCORTO")


def test_parse_cup_too_long():
    many = ", ".join(f"{i:015d}" for i in range(20))
    with pytest.raises(ValueError, match="Troppi CUP"):
        parse_cup_field(many)


def test_parse_cig():
    assert parse_cig_field("abc1234567") == "ABC1234567"
    assert parse_cig_field(None) is None
    with pytest.raises(ValueError, match="CIG non valido"):
        parse_cig_field("CORTO")


def _create(client, **kwargs):
    payload = {"title": "Pratica CUP test"}
    payload.update(kwargs)
    res = client.post("/api/v1/cases", json=payload)
    return res


def test_create_multi_cup_normalized(client):
    res = _create(client, cup=f"{CUP1} , {CUP2.lower()}")
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["cup"] == f"{CUP1}, {CUP2}"
    client.delete(f"/api/v1/cases/{body['id']}")


def test_create_invalid_cup_422_readable(client):
    res = _create(client, cup="NONVALIDO")
    assert res.status_code == 422, res.text
    detail = res.json()["detail"]
    text = str(detail)
    assert "CUP non validi" in text
    assert "15 caratteri" in text


def test_create_title_overflow_422_not_500(client):
    res = _create(client, title="T" * 300)
    assert res.status_code == 422, res.text
    assert "255" in str(res.json()["detail"])


def test_update_cup_persists(client):
    res = _create(client)
    assert res.status_code == 201, res.text
    cid = res.json()["id"]
    try:
        upd = client.patch(f"/api/v1/cases/{cid}", json={"cup": f"{CUP1},{CUP2}"})
        assert upd.status_code == 200, upd.text
        assert upd.json()["cup"] == f"{CUP1}, {CUP2}"
        bad = client.patch(f"/api/v1/cases/{cid}", json={"cup": "CORTO"})
        assert bad.status_code == 422, bad.text
    finally:
        client.delete(f"/api/v1/cases/{cid}")
