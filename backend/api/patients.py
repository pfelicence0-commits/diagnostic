"""
Patients — CRUD complet
"""
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from typing import Optional
from datetime import date
from services.supabase_client import supabase

router = APIRouter()

# ── Schémas ───────────────────────────────────────────────────────────────────
class PatientCreate(BaseModel):
    nom: str
    prenom: str
    date_naissance: date
    sexe: str                        # M / F
    telephone: Optional[str] = None
    email: Optional[str] = None
    adresse: Optional[str] = None
    antecedents: Optional[str] = None
    notes: Optional[str] = None

class PatientUpdate(BaseModel):
    telephone: Optional[str] = None
    email: Optional[str] = None
    adresse: Optional[str] = None
    antecedents: Optional[str] = None
    notes: Optional[str] = None

# ── Helper auth ───────────────────────────────────────────────────────────────
def get_user_id(authorization: str = Header(...)):
    try:
        token = authorization.replace("Bearer ", "")
        res   = supabase.auth.get_user(token)
        return str(res.user.id)
    except Exception:
        raise HTTPException(status_code=401, detail="Token invalide")

# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.get("/")
def list_patients(search: str = "", authorization: str = Header(...)):
    get_user_id(authorization)
    q = supabase.table("patients").select(
        "id, nom, prenom, date_naissance, sexe, telephone, email, created_at"
    ).order("nom")
    if search:
        q = q.or_(f"nom.ilike.%{search}%,prenom.ilike.%{search}%")
    res = q.execute()
    return res.data

@router.get("/{patient_id}")
def get_patient(patient_id: str, authorization: str = Header(...)):
    get_user_id(authorization)
    res = supabase.table("patients").select("*").eq("id", patient_id).maybe_single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Patient introuvable")
    return res.data

@router.post("/", status_code=201)
def create_patient(patient: PatientCreate, authorization: str = Header(...)):
    user_id = get_user_id(authorization)
    data = patient.model_dump()
    data["date_naissance"] = str(data["date_naissance"])
    data["created_by"] = user_id
    res = supabase.table("patients").insert(data).execute()
    return res.data[0]

@router.put("/{patient_id}")
def update_patient(patient_id: str, update: PatientUpdate, authorization: str = Header(...)):
    get_user_id(authorization)
    data = {k:v for k,v in update.model_dump().items() if v is not None}
    res  = supabase.table("patients").update(data).eq("id", patient_id).execute()
    return res.data[0] if res.data else {"message": "Mis à jour"}

@router.delete("/{patient_id}")
def delete_patient(patient_id: str, authorization: str = Header(...)):
    get_user_id(authorization)
    supabase.table("patients").delete().eq("id", patient_id).execute()
    return {"message": "Patient supprimé"}

@router.get("/{patient_id}/consultations")
def get_patient_consultations(patient_id: str, authorization: str = Header(...)):
    """Historique complet des consultations d'un patient avec résultats IA."""
    get_user_id(authorization)
    res = supabase.table("consultations")\
        .select("*, analyses_ia(*)")\
        .eq("patient_id", patient_id)\
        .order("created_at", desc=True)\
        .execute()
    return res.data