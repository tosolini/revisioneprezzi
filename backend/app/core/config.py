import os

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _build_database_url() -> str:
    database_url = os.getenv("DATABASE_URL")
    if database_url:
        return database_url

    user = os.getenv("POSTGRES_USER") or "user"
    password = os.getenv("POSTGRES_PASSWORD") or "password"
    host = os.getenv("POSTGRES_HOST") or "db"
    port = os.getenv("POSTGRES_PORT") or "5432"
    database = os.getenv("POSTGRES_DB") or "revision_db"
    return f"postgresql://{user}:{password}@{host}:{port}/{database}"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str = Field(default_factory=_build_database_url)
    app_name: str = "Revisione Prezzi API"
    # Default to False: debug=True leaks stack traces / internal details in responses.
    # Override locally via DEBUG=true in the environment when needed.
    debug: bool = False
    use_wizard_v2: bool = False  # Feature flag per wizard v2 semplificato


settings = Settings()
