import logging

from fastapi import FastAPI

from app.api.v1 import calc, calculation_v2, cases, classify, cpv, ateco, extract, indices, report, report_v2, tol, user_settings, wizard, wizard_config, wizard_v2
from app.core.config import settings
from app.core.health import health_status
from app.models import *  # noqa: F401, F403
from app.services.auto_seed import auto_seed

app = FastAPI(title=settings.app_name, debug=settings.debug)

app.include_router(calc.router, prefix="/api/v1")
app.include_router(calculation_v2.router, prefix="/api/v1")
app.include_router(cases.router, prefix="/api/v1")
app.include_router(classify.router, prefix="/api/v1")
app.include_router(indices.router, prefix="/api/v1")
app.include_router(report.router, prefix="/api/v1")
app.include_router(report_v2.router, prefix="/api/v1")
app.include_router(wizard.router, prefix="/api/v1")
app.include_router(wizard_config.router, prefix="/api/v1")
app.include_router(extract.router, prefix="/api/v1")
app.include_router(ateco.router, prefix="/api/v1")
app.include_router(cpv.router, prefix="/api/v1")
app.include_router(user_settings.router, prefix="/api/v1")
app.include_router(tol.router, prefix="/api/v1")
app.include_router(wizard_v2.router, prefix="/api/v1")


@app.on_event("startup")
def on_startup():
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    auto_seed()


@app.get("/health")
def health():
    return health_status()


@app.get("/api/v1/features")
def get_features():
    """
    Ritorna feature flags per l'applicazione
    Usato dal frontend per attivare/disattivare funzionalità
    """
    return {
        "use_wizard_v2": settings.use_wizard_v2,
        "wizard_v2_route": "/cases/{id}/wizard-v2" if settings.use_wizard_v2 else None
    }
