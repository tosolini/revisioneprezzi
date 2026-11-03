"""Aggiorna le query SDMX per retribuzioni contrattuali (dataflow 155_358)

Corregge la chiave dimensionale SDMX da 4 dimensioni (M.IT.N.<code>)
a 6 dimensioni (M.IT.WAGE_E_2021.N.10.<code>), allineandola al DSD ISTAT.

Revision ID: c3d4e5f6a7b8
Revises: a1b2c3d4e5f6
Create Date: 2026-11-03 12:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]


def upgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE index_import_query
            SET key_part = REPLACE(key_part, 'M.IT.N.', 'M.IT.WAGE_E_2021.N.10.'),
                url = REPLACE(url, '/M.IT.N.', '/M.IT.WAGE_E_2021.N.10.')
            WHERE dataflow_id = '155_358_DF_DCSC_RETRATECO1_7'
              AND key_part LIKE 'M.IT.N.%';
            """
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            """
            UPDATE index_import_query
            SET key_part = REPLACE(key_part, 'M.IT.WAGE_E_2021.N.10.', 'M.IT.N.'),
                url = REPLACE(url, '/M.IT.WAGE_E_2021.N.10.', '/M.IT.N.')
            WHERE dataflow_id = '155_358_DF_DCSC_RETRATECO1_7'
              AND key_part LIKE 'M.IT.WAGE_E_2021.N.10.%';
            """
        )
    )
