from sqlalchemy.orm import Session

from app.core.config import RuntimeSettings, initial_runtime_settings
from app.models import AppSetting, utcnow


def get_settings(db: Session) -> RuntimeSettings:
    row = db.get(AppSetting, 1)
    if row is None:
        rs = initial_runtime_settings()
        db.add(AppSetting(id=1, data=rs.model_dump()))
        db.commit()
        return rs
    # merge so settings added in newer versions get defaults
    return RuntimeSettings.model_validate({**initial_runtime_settings().model_dump(), **row.data})


def update_settings(db: Session, changes: dict) -> RuntimeSettings:
    """Validates the merged result; raises pydantic.ValidationError on bad input."""
    rs = RuntimeSettings.model_validate({**get_settings(db).model_dump(), **changes})
    row = db.get(AppSetting, 1)
    row.data = rs.model_dump()
    row.updated_at = utcnow()
    db.commit()
    return rs
