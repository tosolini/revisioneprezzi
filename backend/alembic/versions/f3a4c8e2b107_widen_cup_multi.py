"""widen_cup_multi

Revision ID: f3a4c8e2b107
Revises: e1a2b3c4d5e6
Create Date: 2026-10-14 12:00:00.000000

Allarga case_file.cup da 20 a 255 caratteri per ospitare più CUP
(separati da virgola) sulla stessa pratica.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f3a4c8e2b107'
down_revision: Union[str, None] = 'e1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Revisioni richieste da Alembic a livello modulo (cfr. altre migration)
__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]


def upgrade() -> None:
    op.alter_column('case_file', 'cup',
               existing_type=sa.VARCHAR(length=20),
               type_=sa.String(length=255),
               existing_nullable=True)


def downgrade() -> None:
    op.alter_column('case_file', 'cup',
               existing_type=sa.String(length=255),
               type_=sa.VARCHAR(length=20),
               existing_nullable=True)
