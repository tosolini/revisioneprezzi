"""add end_period_strategy to index_import_query

Revision ID: c1a2b3c4d5e6
Revises: 9b3c7a1d4e20
Create Date: 2026-08-31 00:00:00.000000

Aggiunge colonna end_period_strategy alla tabella index_import_query
per automatizzare la riscrittura di endPeriod su Riscarica.
Valori ammessi: fixed, last_month_end, today. Default last_month_end
per le nuove righe; le righe preesistenti ereditano last_month_end via
server_default (comportamento richiesto). Il PUT permette di tornare a fixed.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'c1a2b3c4d5e6'
down_revision: Union[str, None] = '9b3c7a1d4e20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('index_import_query', sa.Column('end_period_strategy', sa.String(length=20), nullable=False, server_default='last_month_end'))


def downgrade() -> None:
    op.drop_column('index_import_query', 'end_period_strategy')
