from fastapi import FastAPI, APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
# Correction des imports (enlève le "." si tu as une erreur "ImportError")
from . import schemas, crud, database, auth, models 

app = FastAPI()
router = APIRouter()

# Fonction pour récupérer la base de données
def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Route d'inscription (via le router)
@router.post("/register", response_model=schemas.UserOut)
def register(user: schemas.UserCreate, db: Session = Depends(get_db)):
    db_user = crud.get_user_by_email(db, user.email)
    if db_user:
        raise HTTPException(status_code=400, detail="Email déjà utilisé")
    return crud.create_user(db, user)

# Route de connexion (corrigée pour utiliser router et la bonne clé dict)

# --- ROUTE LOGIN CORRIGÉE ---
@router.post("/login")
def login(data: dict, db: Session = Depends(get_db)):
    # 1. On cherche l'utilisateur par email
    user = db.query(models.Utilisateur).filter(models.Utilisateur.email == data.get('email')).first()
    
    # 2. Vérification du mot de passe
    if not user or user.mot_de_passe != data.get('mot_de_passe'):
        raise HTTPException(status_code=400, detail="Email ou mot de passe incorrect")
        
    # 3. RETOURNER L'ID (C'est le changement le plus important !)
    return {
        "message": "Connexion réussie", 
        "id": user.id,          # <--- Ajoute cette ligne
        "nom": user.nom, 
        "prenom": user.prenom,
        "email": user.email
    }
# IMPORTANT : Inclure le router dans l'application
app.include_router(router)