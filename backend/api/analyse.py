"""
Analyse IA — Upload image otoscope → pipeline YOLO + segmentation → archivage
"""
import uuid
import base64
from datetime import datetime
from fastapi import APIRouter, HTTPException, UploadFile, File, Form, Header, Request
from typing import Optional
from services.supabase_client import supabase
from config import settings

router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/tiff", "image/gif"}
MAX_BYTES     = settings.MAX_IMAGE_SIZE_MB * 1024 * 1024


def get_user_id(authorization: str) -> str:
    """Extrait et valide le user_id depuis le token Bearer."""
    try:
        token = authorization.replace("Bearer ", "").strip()
        res   = supabase.auth.get_user(token)
        return str(res.user.id)
    except Exception:
        raise HTTPException(status_code=401, detail="Token invalide")


# ── GET /health ───────────────────────────────────────────────────────────────
@router.get("/health")
def analyse_health(request: Request):
    ai_ok = request.app.state.ai is not None
    return {
        "status":        "ok" if ai_ok else "degraded",
        "router":        "analyse",
        "models_loaded": ai_ok,
    }


# ── POST / ────────────────────────────────────────────────────────────────────
@router.post("/")
async def analyser_image(
    request:         Request,
    image:           UploadFile    = File(...),
    patient_id:      str           = Form(...),
    oreille:         str           = Form("droite"),
    notes_cliniques: Optional[str] = Form(None),
    authorization:   str           = Header(...),
):
    user_id = get_user_id(authorization)

    # ── Validation image ──────────────────────────────────────────────────────
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Format non supporté : {image.content_type}. "
                   f"Formats acceptés : {', '.join(ALLOWED_TYPES)}"
        )

    img_bytes = await image.read()
    if not img_bytes:
        raise HTTPException(status_code=400, detail="Fichier image vide")

    if len(img_bytes) > MAX_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Image trop grande (max {settings.MAX_IMAGE_SIZE_MB} MB)"
        )

    # ── Pipeline IA ───────────────────────────────────────────────────────────
    ai = request.app.state.ai
    if ai is None:
        raise HTTPException(
            status_code=503,
            detail="Modèles IA non disponibles — le serveur démarre peut-être encore"
        )

    try:
        result = ai.run(img_bytes)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur pipeline IA : {str(e)}")

    clf = result["classification"]
    seg = result["segmentation"]

    # ── Upload images → Supabase Storage ──────────────────────────────────────
    img_id          = str(uuid.uuid4())
    safe_patient_id = patient_id if patient_id != "anonymous" else user_id
    orig_path       = f"patients/{safe_patient_id}/{img_id}/original.jpg"
    overlay_path    = f"patients/{safe_patient_id}/{img_id}/overlay.png"
    mask_path       = f"patients/{safe_patient_id}/{img_id}/mask.png"

    def safe_upload(path: str, data: bytes, content_type: str):
        try:
            supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET) \
                .upload(path, data, {"content-type": content_type, "upsert": "true"})
        except Exception as e:
            print(f"⚠️  Storage upload warning [{path}]: {e}")

    safe_upload(orig_path,    img_bytes, "image/jpeg")
    safe_upload(overlay_path, base64.b64decode(result["images"]["overlay_b64"]), "image/png")
    safe_upload(mask_path,    base64.b64decode(result["images"]["mask_b64"]),    "image/png")

    # ── URL publiques ─────────────────────────────────────────────────────────
    def get_url(path: str) -> Optional[str]:
        try:
            return supabase.storage.from_(settings.SUPABASE_STORAGE_BUCKET) \
                .get_public_url(path)
        except Exception:
            return None

    orig_url    = get_url(orig_path)
    overlay_url = get_url(overlay_path)
    mask_url    = get_url(mask_path)

    # ── Sauvegarde consultation ───────────────────────────────────────────────
    try:
        consultation = supabase.table("consultations").insert({
            "numero_dossier":      patient_id if patient_id != "anonymous" else None,
            "oreille":             oreille,
            "medecin_id":          user_id,
            "ia_yolo_classe":      clf["yolo_class"],
            "ia_yolo_confiance":   clf["confidence"],
            "ia_seg_classe":       clf["seg_class"],
            "ia_mode":             clf["mode"],
            "ia_top3":             clf["top3"],
            "image_originale_url": orig_url,
            "overlay_url":         overlay_url,
            "mask_url":            mask_url,
        }).execute().data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur BDD consultation : {str(e)}")

    return {
        "consultation_id": consultation["id"],
        "classification":  clf,
        "segmentation":    seg,
        "images": {
            "original_url": orig_url,
            "overlay_url":  overlay_url,
            "mask_url":     mask_url,
            "overlay_b64":  result["images"]["overlay_b64"],
            "mask_b64":     result["images"]["mask_b64"],
        },
    }


# ── GET /{consultation_id} ────────────────────────────────────────────────────
@router.get("/{consultation_id}")
def get_analyse(consultation_id: str, authorization: str = Header(...)):
    get_user_id(authorization)
    res = supabase.table("consultations") \
        .select("*") \
        .eq("id", consultation_id) \
        .maybe_single() \
        .execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Consultation introuvable")
    return res.data


# ── GET /patient/{numero_dossier}/evolution ───────────────────────────────────
@router.get("/patient/{numero_dossier}/evolution")
def get_evolution(numero_dossier: str, authorization: str = Header(...)):
    """Évolution temporelle des diagnostics pour un patient."""
    get_user_id(authorization)
    res = supabase.table("consultations") \
        .select(
            "id, created_at, oreille, "
            "ia_yolo_classe, ia_yolo_confiance, ia_seg_classe, "
            "diagnostic_medecin, accord_ia_medecin"
        ) \
        .eq("numero_dossier", numero_dossier) \
        .order("created_at") \
        .execute()
    return res.data