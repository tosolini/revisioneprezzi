"""add start_period_strategy to index_import_query

Revision ID: d4e5f6a7b8c9
Revises: c1a2b3c4d5e6
Create Date: 2026-08-31 12:00:00.000000

Aggiunge colonna start_period_strategy alla tabella index_import_query
per permettere di variare startPeriod su Riscarica (renderlo più vecchio).
Valori ammessi: fixed, earliest, expand_1y, expand_5y. Default fixed
per le nuove righe; le righe preesistenti ereditano fixed via server_default.
Il PUT permette di modificare la strategia.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = 'd4e5f6a7b8c9'
down_revision: Union[str, None] = 'c1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('index_import_query', sa.Column('start_period_strategy', sa.String(length=20), nullable=False, server_default='fixed'))


def downgrade() -> None:
    op.drop_column('index_import_query', 'start_period_strategy')
