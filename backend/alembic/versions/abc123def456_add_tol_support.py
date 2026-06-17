"""add_tol_support_for_works

Revision ID: add_tol_support
Revises: <previous_revision>
Create Date: 2026-06-11

Aggiunge supporto per TOL (Tipologie Omogenee Lavorazioni) secondo Allegato II.2-bis Tabella A
- Tabella tol_master: 20 TOL dalla Tabella A.1 con declaratorie
- Tabella tol_assignment: assegnazione TOL a pratiche con pesi percentuali
- Tabella tol_index_series: serie storiche indici TOL da MIT/ISTAT
- Modifica contract_context.contract_type per includere 'works'
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'abc123def456'  # Generated unique ID
down_revision = 'f7ba43f2dd2e'  # Last migration: add_updated_at_to_ateco_catalog
branch_labels = None
depends_on = None


def upgrade():
    # 1. Crea tabella tol_master
    op.create_table(
        'tol_master',
        sa.Column('code', sa.String(length=10), nullable=False),
        sa.Column('sequence', sa.Integer(), nullable=False),
        sa.Column('short_description', sa.String(length=255), nullable=False),
        sa.Column('full_description', sa.Text(), nullable=False),
        sa.Column('is_specialized', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('code')
    )
    
    # 2. Crea tabella tol_assignment
    op.create_table(
        'tol_assignment',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('case_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tol_code', sa.String(length=10), nullable=False),
        sa.Column('weight_percent', sa.Float(), nullable=False, server_default='100.0'),
        sa.Column('amount_allocated', sa.Float(), nullable=True),
        sa.Column('notes', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['case_id'], ['case_file.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['tol_code'], ['tol_master.code']),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Indici per tol_assignment
    op.create_index(op.f('ix_tol_assignment_case_id'), 'tol_assignment', ['case_id'], unique=False)
    op.create_index(op.f('ix_tol_assignment_tol_code'), 'tol_assignment', ['tol_code'], unique=False)
    
    # 3. Crea tabella tol_index_series
    op.create_table(
        'tol_index_series',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('tol_code', sa.String(length=10), nullable=False),
        sa.Column('series_id', sa.String(length=100), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('valid_from', sa.DateTime(timezone=True), nullable=True),
        sa.Column('valid_to', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tol_code'], ['tol_master.code']),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Indici per tol_index_series
    op.create_index(op.f('ix_tol_index_series_tol_code'), 'tol_index_series', ['tol_code'], unique=False)
    op.create_index(op.f('ix_tol_index_series_series_id'), 'tol_index_series', ['series_id'], unique=False)
    op.create_index(op.f('ix_tol_index_series_active'), 'tol_index_series', ['is_active'], unique=False)
    
    # 4. Modifica contract_context.contract_type per supportare 'works'
    # Nota: se ci sono dati esistenti, potrebbe essere necessario gestire la migrazione
    # Questo assume che il campo esista già come String(50)
    # Se necessario, modificare il commento o i constraints
    op.alter_column(
        'contract_context',
        'contract_type',
        comment='works|service|supply|mixed',
        existing_type=sa.String(length=50),
        existing_nullable=True
    )


def downgrade():
    # Rimuovi le modifiche in ordine inverso
    
    # 1. Ripristina contract_context.contract_type
    op.alter_column(
        'contract_context',
        'contract_type',
        comment='service|supply|mixed',
        existing_type=sa.String(length=50),
        existing_nullable=True
    )
    
    # 2. Rimuovi tabelle TOL
    op.drop_index(op.f('ix_tol_index_series_active'), table_name='tol_index_series')
    op.drop_index(op.f('ix_tol_index_series_series_id'), table_name='tol_index_series')
    op.drop_index(op.f('ix_tol_index_series_tol_code'), table_name='tol_index_series')
    op.drop_table('tol_index_series')
    
    op.drop_index(op.f('ix_tol_assignment_tol_code'), table_name='tol_assignment')
    op.drop_index(op.f('ix_tol_assignment_case_id'), table_name='tol_assignment')
    op.drop_table('tol_assignment')
    
    op.drop_table('tol_master')
