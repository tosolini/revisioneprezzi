import re
from pathlib import Path
from typing import Any

import yaml


def _load_config() -> dict:
    path = Path(__file__).resolve().parent / "steps_config.yaml"
    with open(path) as f:
        return yaml.safe_load(f)


CONFIG = _load_config()


def get_step_config(step: int) -> dict | None:
    for s in CONFIG["steps"]:
        if s["step"] == step:
            return s
    return None


def get_all_steps() -> list[dict]:
    return CONFIG["steps"]


def validate_field(value: Any, field_config: dict) -> list[str]:
    errors = []
    if "validation" in field_config:
        pattern = field_config["validation"].get("pattern")
        if pattern and value:
            if not re.match(pattern, str(value)):
                errors.append(field_config["validation"].get("message", "Formato non valido"))
    if field_config.get("required") and (value is None or value == ""):
        errors.append(f"{field_config['label']} è obbligatorio")
    return errors


def evaluate_branching_rules(step: int, answers: dict[str, Any]) -> dict[str, Any]:
    result = {
        "warnings": [],
        "mandatory_fields": [],
        "options_filter": None,
    }
    for rule in CONFIG.get("branching_rules", []):
        cond = rule["if"]
        if cond["step"] != step:
            continue
        field_value = answers.get(cond["field"])
        if field_value is None:
            continue

        match = False
        op = cond.get("operator", "==")
        if op == "==":
            match = str(field_value) == str(cond["value"])
        elif op == "!=":
            match = str(field_value) != str(cond["value"])

        if match:
            action = rule["then"]
            if "set_mandatory" in action:
                for m in action["set_mandatory"]:
                    result["mandatory_fields"].append(m)
            if "show_warning" in action:
                result["warnings"].append(action["show_warning"])
            if "options_filter" in action:
                result["options_filter"] = action["options_filter"]
    return result


def get_step_warnings(step: int, answers: dict[str, Any]) -> list[str]:
    field_warnings = []
    step_config = get_step_config(step)
    if step_config:
        for field in step_config.get("fields", []):
            if "warnings" in field:
                val = answers.get(field["key"])
                for w in field["warnings"]:
                    if w.get("condition") and val == w["condition"]:
                        field_warnings.append(w["message"])
    return field_warnings
