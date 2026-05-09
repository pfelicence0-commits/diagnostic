import datetime

try:
    from . import database
    from . import models
    from .main import normalize_input_value, normalize_type_input
except ImportError:
    import database
    import models
    from main import normalize_input_value, normalize_type_input

def normalize_diagnostics():
    db = database.SessionLocal()
    try:
        diagnostics = db.query(models.Diagnostic).all()
        updated = 0
        for diag in diagnostics:
            new_nom = normalize_input_value(diag.nom_maladie)
            new_type = normalize_type_input(diag.type_maladie)
            if diag.nom_maladie != new_nom or diag.type_maladie != new_type:
                diag.nom_maladie = new_nom
                diag.type_maladie = new_type
                diag.date_insertion_bdd = datetime.datetime.now()
                updated += 1

        if updated:
            db.commit()
        print(f"Normalized {updated} diagnostics.")
    finally:
        db.close()

if __name__ == "__main__":
    normalize_diagnostics()
