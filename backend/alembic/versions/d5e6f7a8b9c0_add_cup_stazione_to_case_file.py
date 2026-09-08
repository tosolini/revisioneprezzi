"""add_cup_stazione_to_case_file

Revision ID: d5e6f7a8b9c0
Revises: c19a2e7f4b30
Create Date: 2026-09-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, None] = 'c19a2e7f4b30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Alembic requires module-level revision variables; CodeQL flags as unused - mark as intentionally used
__all__ = ["revision", "down_revision", "branch_labels", "depends_on", "upgrade", "downgrade"]


def upgrade() -> None:
    op.add_column('case_file', sa.Column('cup', sa.String(length=20), nullable=True))
    op.add_column('case_file', sa.Column('stazione_appaltante', sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column('case_file', 'stazione_appaltante')
    op.drop_column('case_file', 'cup')
