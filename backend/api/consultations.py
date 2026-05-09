"""
Consultations — Gestion des consultations médicales
"""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional
from services.supabase_client import supabase

router = APIRouter()


def get_user_id(authorization: str) -> str:
    try:
        token = authorization.replace("Bearer ", "").strip()
        return str(supabase.auth.get_user(token).user.id)
    except Exception:
        raise HTTPException(status_code=401, detail="Token invalide")


# ── Modèle de mise à jour — uniquement les colonnes qui existent ──────────────
class ConsultationUpdate(BaseModel):
    oreille:                   Optional[str]   = None
    diagnostic_medecin:        Optional[str]   = None
    stade_medecin:             Optional[str]   = None
    notes_medecin:             Optional[str]   = None
    accord_ia_medecin:         Optional[bool]  = None
    tiers_avis:                Optional[str]   = None
    nom_medecin_diagnostiqueur: Optional[str]  = None


# ── GET /api/consultations/ ───────────────────────────────────────────────────
@router.get("/")
def list_consultations(limit: int = 50, authorization: str = Header(...)):
    get_user_id(authorization)
    res = supabase.table("consultations") \
        .select("*") \
        .order("created_at", desc=True) \
        .limit(limit) \
        .execute()
    return res.data


# ── GET /api/consultations/{consultation_id} ──────────────────────────────────
@router.get("/{consultation_id}")
def get_consultation(consultation_id: str, authorization: str = Header(...)):
    get_user_id(authorization)
    res = supabase.table("consultations") \
        .select("*") \
        .eq("id", consultation_id) \
        .maybe_single() \
        .execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Consultation introuvable")
    return res.data


# ── PUT /api/consultations/{consultation_id} — diagnostic médecin ─────────────
@router.put("/{consultation_id}")
def update_consultation(
    consultation_id: str,
    update: ConsultationUpdate,
    authorization: str = Header(...),
):
    get_user_id(authorization)
    data = {k: v for k, v in update.model_dump().items() if v is not None}
    if not data:
        raise HTTPException(status_code=400, detail="Aucune donnée à mettre à jour")
    res = supabase.table("consultations") \
        .update(data) \
        .eq("id", consultation_id) \
        .execute()
    return res.data[0] if res.data else {"message": "Mis à jour"}


# ── DELETE /api/consultations/{consultation_id} ───────────────────────────────
@router.delete("/{consultation_id}")
def delete_consultation(consultation_id: str, authorization: str = Header(...)):
    get_user_id(authorization)
    supabase.table("consultations") \
        .delete() \
        .eq("id", consultation_id) \
        .execute()
    return {"message": "Consultation supprimée"}