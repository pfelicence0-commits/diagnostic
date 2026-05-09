# ✅ APRÈS — utilise la service_role key depuis config
from supabase import create_client, Client
from config import settings

supabase: Client = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_SERVICE_KEY   # ← service_role, pas anon
)