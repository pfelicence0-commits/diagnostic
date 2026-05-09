"""
Configuration centralisée — variables d'environnement via .env
"""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # ── Supabase ──────────────────────────────────────────────────────────────
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
    SUPABASE_STORAGE_BUCKET: str = "images"   # nom de ton bucket existant

    # ── JWT Auth ──────────────────────────────────────────────────────────────
    JWT_SECRET: str = "change-me-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 480             # 8h session médecin

    # ── Modèles IA ────────────────────────────────────────────────────────────
    YOLO_MODEL_PATH: str     = "models/best_yolo_v3_clean.pt"
    ENSEMBLE_MODEL_PATH: str = "models/ensemble_tympan.pth"
    CONF_HIGH: float         = 0.70           # seuil mode ciblé
    CONF_LOW: float          = 0.40           # seuil mode élargi
    IMAGE_SIZE: int          = 384            # taille entrée segmentation
    YOLO_IMG_SIZE: int       = 224            # taille entrée YOLO

    # ── Upload ────────────────────────────────────────────────────────────────
    MAX_IMAGE_SIZE_MB: int = 10

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()


settings = get_settings()