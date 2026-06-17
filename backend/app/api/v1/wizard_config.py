from fastapi import APIRouter

from app.wizard.engine import get_all_steps, get_step_config

router = APIRouter(prefix="/wizard", tags=["wizard"])


@router.get("/config")
def wizard_config():
    return {"steps": get_all_steps()}


@router.get("/config/{step}")
def wizard_step_config(step: int):
    config = get_step_config(step)
    if not config:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Step not found")
    return config
