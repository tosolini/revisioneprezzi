from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env")

    database_url: str = "postgresql://user:password@db:5432/revision_db"
    app_name: str = "Revisione Prezzi API"
    # Default to False: debug=True leaks stack traces / internal details in responses.
    # Override locally via DEBUG=true in the environment when needed.
    debug: bool = False
    use_wizard_v2: bool = False  # Feature flag per wizard v2 semplificato


settings = Settings()
