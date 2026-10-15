"""create ecoicop catalog

Revision ID: b7c9d1e2f304
Revises: f3a4c8e2b107
Create Date: 2026-10-15 12:00:00.000000

Catalogo descrizioni ECOICOP (2a edizione, prezzi al consumo NIC):
codice -> descrizione italiana da codelist ISTAT CL_ECOICOP_2.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c9d1e2f304'
down_revision: Union[str, None] = 'f3a4c8e2b107'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]


def upgrade() -> None:
    op.create_table('ecoicop_catalog',
    sa.Column('ecoicop_code', sa.String(length=20), nullable=False),
    sa.Column('description', sa.String(length=500), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True),
              server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True),
              server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('ecoicop_code')
    )


def downgrade() -> None:
    op.drop_table('ecoicop_catalog')
