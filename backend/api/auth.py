"""
Auth — Login médecin via Supabase Auth
"""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel, EmailStr
from services.supabase_client import supabase

router = APIRouter()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    full_name: str | None


@router.post("/login", response_model=LoginResponse)
def login(req: LoginRequest):
    try:
        res = supabase.auth.sign_in_with_password({
            "email": req.email,
            "password": req.password
        })
        user = res.user
        session = res.session
        if not user or not session:
            raise HTTPException(status_code=401, detail="Identifiants invalides")

        profile = supabase.table("medecins")\
            .select("full_name")\
            .eq("user_id", user.id)\
            .maybe_single().execute()

        full_name = profile.data.get("full_name") if profile.data else None

        return LoginResponse(
            access_token=session.access_token,
            user_id=str(user.id),
            email=user.email,
            full_name=full_name,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Erreur auth : {str(e)}")


# ✅ CORRIGÉ — Header(...) ajouté
@router.post("/logout")
def logout(authorization: str = Header(...)):
    try:
        token = authorization.replace("Bearer ", "")
        supabase.auth.sign_out()
        return {"message": "Déconnexion réussie"}
    except Exception:
        return {"message": "Déconnexion"}


@router.post("/register")
def register(req: LoginRequest, full_name: str = ""):
    """Créer un compte médecin (admin only en production)"""
    try:
        res = supabase.auth.admin.create_user({
            "email": req.email,
            "password": req.password,
            "email_confirm": True,
        })
        user = res.user
        supabase.table("medecins").insert({
            "user_id": str(user.id),
            "email": req.email,
            "full_name": full_name,
        }).execute()
        return {"message": "Compte créé", "user_id": str(user.id)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
