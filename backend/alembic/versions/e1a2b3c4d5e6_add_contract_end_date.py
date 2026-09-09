"""add contract_end_date to contract_context

Revision ID: e1a2b3c4d5e6
Revises: d5e6f7a8b9c0
Create Date: 2026-09-09

Wizard unificato 1.2.0 (step 3): termine contrattuale derivabile da
avvio+durata ma persistito esplicitamente; nessun backfill obbligatorio.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1a2b3c4d5e6'
down_revision: Union[str, None] = 'd5e6f7a8b9c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Alembic requires module-level revision variables; CodeQL flags as unused - mark as intentionally used
__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]


def upgrade() -> None:
    op.add_column('contract_context', sa.Column('contract_end_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('contract_context', 'contract_end_date')
