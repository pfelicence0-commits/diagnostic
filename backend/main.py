"""
OtoScan AI — Backend FastAPI
Pipeline : YOLO classification → Segmentation ensemble → Supabase archivage
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn

from api import patients, consultations, auth, analyse

# ── FIX : import corrigé (int est un mot-clé Python) ─────────────────────────
# Renommez votre dossier "int" en "core" ou "backend_core" et adaptez l'import
try:
    from api.ai_pipeline import AIPipeline          # si ai_pipeline est dans /api/
except ImportError:
    try:
        from api.ai_pipeline import AIPipeline     # si vous avez renommé "int" → "core"
    except ImportError:
        AIPipeline = None
        print("⚠️  AIPipeline introuvable — vérifiez le chemin d'import")


# ── Lifespan : charge les modèles IA au démarrage ────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🔄 Chargement des modèles IA...")
    if AIPipeline is not None:
        try:
            app.state.ai = AIPipeline()
            print("✅ Modèles IA prêts")
        except Exception as e:
            print(f"⚠️  Erreur chargement modèles : {e}")
            app.state.ai = None
    else:
        app.state.ai = None
        print("⚠️  AIPipeline non chargé")
    yield
    print("🔻 Arrêt du serveur")


app = FastAPI(
    title="OtoScan AI",
    description="Diagnostic intelligent des pathologies tympaniques",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # restreindre en production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router,          prefix="/api/auth",          tags=["Auth"])
app.include_router(patients.router,      prefix="/api/patients",      tags=["Patients"])
app.include_router(consultations.router, prefix="/api/consultations", tags=["Consultations"])
app.include_router(analyse.router,       prefix="/api/analyse",       tags=["IA Analyse"])


@app.get("/")
def root():
    return {"status": "ok", "service": "OtoScan AI v1.0"}


# ── FIX : health global (appelé par le frontend sur /health) ─────────────────
@app.get("/health")
def health():
    return {
        "status": "healthy",
        "models_loaded": app.state.ai is not None,
    }


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)