from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Configuration MySQL pour XAMPP
# Format : mysql+pymysql://utilisateur:motdepasse@localhost:3306/nom_de_la_bdd
DATABASE_URL = "mysql+pymysql://root:@localhost:3306/pfe_db"

try:
    engine = create_engine(
        DATABASE_URL,
        # Ce paramètre règle le problème d'encodage (UnicodeDecodeError)
        connect_args={"charset": "utf8mb4"}
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base = declarative_base()
    print("✅ Configuration de la base de données MySQL prête.")
except Exception as e:
    print(f"❌ Erreur lors de la configuration de la DB : {e}")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()