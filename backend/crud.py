from sqlalchemy.orm import Session
import models, schemas, auth
from .models import User, Diagnostic

def get_user_by_email(db: Session, email: str):
    return db.query(User).filter(User.email == email).first()

# Dans crud.py
def create_user(db: Session, user: schemas.UserCreate):
    # Enregistre le mot de passe tel quel (en clair)
    db_user = models.Utilisateur(
        nom=user.nom, 
        prenom=user.prenom, 
        email=user.email, 
        mot_de_passe=user.password  # On ne hache plus ici
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

# Fonction pour récupérer tous les diagnostics pour la galerie
def get_all_diagnostics(db: Session):
    return db.query(Diagnostic).all()
