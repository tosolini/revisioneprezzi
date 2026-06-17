"""
Modelli per supportare TOL (Tipologie Omogenee Lavorazioni) secondo Allegato II.2-bis Tabella A
"""
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class TolMaster(Base):
    """
    Master table delle 20 Tipologie Omogenee Lavorazioni (Tabella A.1)
    """
    __tablename__ = "tol_master"
    
    code: Mapped[str] = mapped_column(String(10), primary_key=True)  # TOL.1, TOL.2, ...
    sequence: Mapped[int] = mapped_column(Integer)  # 1-20
    short_description: Mapped[str] = mapped_column(String(255), nullable=False)
    full_description: Mapped[str] = mapped_column(Text, nullable=False)  # Declaratoria completa
    is_specialized: Mapped[bool] = mapped_column(default=False)  # TOL specializzate hanno precedenza
    notes: Mapped[str | None] = mapped_column(Text)
    
    # Relazioni
    assignments = relationship("TolAssignment", back_populates="tol_master")


class TolAssignment(Base):
    """
    Assegnazione TOL a una pratica (case_file)
    Una pratica può avere una o più TOL con relativi pesi percentuali
    """
    __tablename__ = "tol_assignment"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    case_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("case_file.id"), nullable=False
    )
    tol_code: Mapped[str] = mapped_column(
        String(10), ForeignKey("tol_master.code"), nullable=False
    )
    weight_percent: Mapped[float] = mapped_column(
        Float, nullable=False, default=100.0,
        comment="Peso percentuale della TOL (per multi-TOL deve sommare a 100)"
    )
    amount_allocated: Mapped[float | None] = mapped_column(
        Float, comment="Importo allocato a questa TOL (calcolato da peso%)"
    )
    notes: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    
    # Relazioni
    case_file = relationship("CaseFile", back_populates="tol_assignments")
    tol_master = relationship("TolMaster", back_populates="assignments")


class TolIndexSeries(Base):
    """
    Serie storiche degli indici TOL pubblicati da MIT/ISTAT
    Ogni TOL ha un indice di riferimento mensile
    """
    __tablename__ = "tol_index_series"
    
    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    tol_code: Mapped[str] = mapped_column(
        String(10), ForeignKey("tol_master.code"), nullable=False
    )
    series_id: Mapped[str] = mapped_column(
        String(100), nullable=False,
        comment="ID della serie ISTAT/MIT associata alla TOL"
    )
    description: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    valid_to: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    
    # Relazioni
    tol_master = relationship("TolMaster")


# Estensione del modello ContractContext per supportare il nuovo campo contract_type
"""
MODIFICA A: backend/app/models/contract_context.py

Aggiungere al campo contract_type il valore 'works':

    contract_type: Mapped[str | None] = mapped_column(
        String(50), comment="works|service|supply|mixed"
    )
"""
