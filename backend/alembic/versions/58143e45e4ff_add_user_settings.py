"""add_user_settings

Revision ID: 58143e45e4ff
Revises: abc123def456
Create Date: 2026-06-11 09:25:40.197560
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = '58143e45e4ff'
down_revision: Union[str, None] = 'abc123def456'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('user_settings',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('device_id', sa.String(length=255), nullable=False),
    sa.Column('preferences_json', sa.Text(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_user_settings_device_id'), 'user_settings', ['device_id'], unique=True)


def downgrade() -> None:
    op.drop_index(op.f('ix_user_settings_device_id'), table_name='user_settings')
    op.drop_table('user_settings')
