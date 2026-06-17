from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from jinja2 import Environment, FileSystemLoader
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.case_file import CaseFile
from app.models.classification_decision import ClassificationDecision
from app.models.contract_context import ContractContext
from app.models.cpv_assignment import CpvAssignment
from app.models.index_series import IndexSeries
from app.models.override_reason import OverrideReason
from app.models.revision_input import RevisionInput
from app.models.revision_result import RevisionResult
from app.models.wizard_answer import WizardAnswer

TEMPLATES_DIR = Path(__file__).resolve().parent.parent / "reporting" / "templates"
env = Environment(loader=FileSystemLoader(str(TEMPLATES_DIR)))


def generate_report(case_id: UUID, db: Session) -> str:
    case = db.query(CaseFile).filter(CaseFile.id == case_id).first()
    if not case:
        raise ValueError("Case not found")

    contract = db.query(ContractContext).filter(
        ContractContext.case_id == case_id
    ).first()

    cpv_assignments = (
        db.query(CpvAssignment)
        .filter(CpvAssignment.case_id == case_id)
        .all()
    )

    classification = db.query(ClassificationDecision).filter(
        ClassificationDecision.case_id == case_id
    ).first()

    revision_input = db.query(RevisionInput).filter(
        RevisionInput.case_id == case_id
    ).first()

    results = (
        db.query(RevisionResult)
        .filter(RevisionResult.case_id == case_id)
        .order_by(RevisionResult.result_version.desc())
        .all()
    )

    wizard_answers = (
        db.query(WizardAnswer)
        .filter(WizardAnswer.case_id == case_id)
        .order_by(WizardAnswer.step)
        .all()
    )

    override_reasons = (
        db.query(OverrideReason)
        .filter(OverrideReason.case_id == case_id)
        .all()
    )

    audit_logs = (
        db.query(AuditLog)
        .filter(AuditLog.case_id == case_id)
        .order_by(AuditLog.created_at.desc())
        .all()
    )

    index_series = None
    if classification and classification.selected_index_series_id:
        index_series = db.query(IndexSeries).filter(
            IndexSeries.id == classification.selected_index_series_id
        ).first()

    template = env.get_template("report.md.j2")
    report = template.render(
        case=case,
        contract=contract,
        cpv_assignments=cpv_assignments,
        classification=classification,
        index_series=index_series,
        revision_input=revision_input,
        results=results,
        wizard_answers=wizard_answers,
        override_reasons=override_reasons,
        audit_logs=audit_logs,
        generated_at=datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M"),
    )

    return report
