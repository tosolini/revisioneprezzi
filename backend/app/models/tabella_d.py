import uuid
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class CpvTabellaDMaster(Base):
    """Elenco CPV e tabella di pertinenza (sezione master del file sorgente)."""

    __tablename__ = "cpv_tabella_d_master"

    #: Codice CPV normalizzato (forma completa `NNNNNNNN-N`; `NNNNNNNN` per
    #: i codici senza cifra di controllo nel file sorgente).
    cpv_code: Mapped[str] = mapped_column(String(20), primary_key=True)
    cpv_description: Mapped[str] = mapped_column(Text)
    #: D1 | D2 | D3 | CHILDREN (per i CPV "Si vedano CPV di maggior dettaglio").
    table_class: Mapped[str] = mapped_column(String(20))


class CpvTabellaDAssociation(Base):
    """Associazione CPV → indice ISTAT definita nelle Tabelle D.1/D.2/D.3."""

    __tablename__ = "cpv_tabella_d_association"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    #: Codice CPV della riga delle tabelle D.1/D.2/D.3 (normalizzato come nel
    #: sorgente). Nessuna FK a cpv_tabella_d_master: nel file sorgente i codici
    #: divergono (es. master "85110000" vs D.3 "85111000").
    cpv_code: Mapped[str] = mapped_column(String(20), index=True)
    table_class: Mapped[str] = mapped_column(String(10))
    #: Ordine nella riga sorgente (slot*10 + contatore nello slot per D.2/D.3).
    position: Mapped[int] = mapped_column(Integer, default=0)
    index_type: Mapped[str] = mapped_column(String(4))  # PC | PPI | PPS | IR
    classification: Mapped[str] = mapped_column(String(10))  # ATECO | ECOICOP
    #: Codice numerico tra `[..]`, lettera sezione per indici IR (es. `A`),
    #: oppure `00ST`/`00` per gli indici PC generali. Il sorgente contiene
    #: anche codici composti (es. `691_692-702`): 20 caratteri bastano.
    ateco_code: Mapped[str] = mapped_column(String(20))
    index_description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
