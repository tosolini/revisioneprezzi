"""add_cig_to_case_file

Revision ID: c19a2e7f4b30
Revises: d4e5f6a7b8c9
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c19a2e7f4b30'
down_revision: Union[str, None] = 'd4e5f6a7b8c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Alembic requires module-level revision variables; CodeQL flags as unused - mark as intentionally used
__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]


def upgrade() -> None:
    op.add_column('case_file', sa.Column('cig', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('case_file', 'cig')
