import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { User, Lock, ArrowRight, Stethoscope, Activity, Users } from 'lucide-react';
import { supabase } from '../supabaseClient';

export default function Login({ onLogin, isAuthenticated }) {
  const navigate = useNavigate();
  const [isCollabMode, setIsCollabMode] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    email2: '',
    password2: ''
  });
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/diagnostic');
    }
  }, [isAuthenticated, navigate]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // ✅ CORRIGÉ — retourne le access_token
  const signInWithPassword = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message || 'Erreur de connexion');
    return data.session.access_token;
  };

  const fetchProfileByEmail = async (email) => {
    const { data, error } = await supabase
      .from('utilisateurs')
      .select('id, nom, prenom, email')
      .eq('email', email)
      .single();

    if (error || !data) {
      throw new Error(`Compte introuvable: ${email}`);
    }

    console.log('Profil récupéré depuis Supabase:', data);
    return data;
  };

  // ✅ CORRIGÉ — fusionne token + profil
  const loginAndGetProfile = async (email, password) => {
    const access_token = await signInWithPassword(email, password);
    const profile = await fetchProfileByEmail(email);
    return { ...profile, access_token };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    localStorage.clear();
    console.log('localStorage nettoyé avant nouvelle connexion');

    try {
      const user1 = await loginAndGetProfile(formData.email, formData.password);

      if (!user1.nom || !user1.prenom) {
        throw new Error(`Profil incomplet. Nom: ${user1.nom}, Prénom: ${user1.prenom}. Contactez l'administrateur.`);
      }

      // ✅ Stocke { id, nom, prenom, email, access_token }
      localStorage.setItem('user', JSON.stringify(user1));
      localStorage.setItem('currentUser', JSON.stringify(user1));

      console.log('Utilisateur stocké dans localStorage:', user1);
      console.log('Nom complet:', `${user1.prenom} ${user1.nom}`);

      if (isCollabMode) {
        if (formData.email === formData.email2) {
          throw new Error("Les deux médecins doivent être différents.");
        }

        const { data: authData2, error: authError2 } = await supabase.auth.signInWithPassword({
          email: formData.email2,
          password: formData.password2
        });

        if (authError2) {
          throw new Error("Erreur d'authentification collaborateur: " + authError2.message);
        }

        const user2 = await fetchProfileByEmail(formData.email2);

        if (!user2.nom || !user2.prenom) {
          throw new Error(`Profil du collaborateur incomplet. Contactez l'administrateur.`);
        }

        // ✅ Token collaborateur aussi sauvegardé
        localStorage.setItem('collaborateur', JSON.stringify({
          ...user2,
          access_token: authData2.session.access_token,
        }));
        localStorage.setItem('mode_session', 'collaboration');

        console.log('Collaborateur stocké:', user2);

        // Re-connexion du médecin principal
        await supabase.auth.signInWithPassword({
          email: formData.email,
          password: formData.password
        });
      } else {
        localStorage.removeItem('collaborateur');
        localStorage.setItem('mode_session', 'solo');
      }

      console.log('=== CONNEXION RÉUSSIE ===');
      console.log('User:', JSON.parse(localStorage.getItem('user')));
      console.log('Mode:', localStorage.getItem('mode_session'));

      if (onLogin) onLogin();
      navigate('/diagnostic');
    } catch (error) {
      console.error("Erreur de connexion:", error);
      alert("Erreur : " + error.message);
    }
  };

  return (
    <div className="min-h-screen flex relative overflow-hidden">
      <div className="fixed inset-0 bg-gradient-to-br from-slate-900 via-blue-900 to-slate-800 animate-gradient"></div>

      {/* Section Gauche */}
      <div className="hidden lg:flex lg:flex-1 relative items-center justify-center p-12">
        <div className="relative z-10 text-center space-y-6 animate-float-card">
          <div className="flex justify-center mb-8">
            <div className="relative">
              <div className="absolute inset-0 bg-cyan-400 blur-3xl opacity-30 rounded-full"></div>
              <div className="relative bg-white/10 backdrop-blur-xl border border-white/20 rounded-full p-12 shadow-2xl">
                <Stethoscope className="w-32 h-32 text-cyan-400" strokeWidth={1.5} />
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <h1 className="text-5xl font-bold text-white leading-tight">Diagnostic ORL</h1>
            <div className="flex items-center justify-center gap-2 text-cyan-300">
              <Activity className="w-5 h-5" />
              <p className="text-xl font-light">Système Expert de Diagnostic</p>
            </div>
          </div>
        </div>
      </div>

      {/* Section Droite - Formulaire */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-12 relative z-10">
        <div className="w-full max-w-md">
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl shadow-2xl p-8 lg:p-10 relative">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-cyan-400 rounded-t-3xl"></div>

            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-white mb-2">
                {isCollabMode ? "Session Collaborative" : "Connexion"}
              </h2>

              <button
                type="button"
                onClick={() => setIsCollabMode(!isCollabMode)}
                className={`mt-2 inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-bold transition-all ${isCollabMode ? 'bg-cyan-500 text-white' : 'bg-white/5 text-cyan-400 border border-cyan-400/30'}`}
              >
                <Users size={14} />
                {isCollabMode ? "Mode Duo Activé" : "Travailler à deux ?"}
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className={`space-y-4 ${isCollabMode ? 'p-4 bg-white/5 rounded-2xl border border-white/10' : ''}`}>
                {isCollabMode && <p className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">Médecin Principal</p>}
                <div className="relative group">
                  <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-cyan-400" />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    className="w-full bg-white/5 border border-white/20 rounded-xl pl-12 pr-4 py-3 text-white text-sm focus:border-cyan-400 outline-none"
                    placeholder="Email médecin 1"
                    required
                  />
                </div>
                <div className="relative group">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-cyan-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    className="w-full bg-white/5 border border-white/20 rounded-xl pl-12 pr-4 py-3 text-white text-sm focus:border-cyan-400 outline-none"
                    placeholder="Mot de passe"
                    required
                  />
                </div>
              </div>

              {isCollabMode && (
                <div className="space-y-4 p-4 bg-cyan-500/5 rounded-2xl border border-cyan-500/20 animate-in fade-in slide-in-from-top-2">
                  <p className="text-[10px] font-bold text-blue-400 uppercase tracking-widest">Médecin Collaborateur</p>
                  <div className="relative group">
                    <User className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-400" />
                    <input
                      type="email"
                      name="email2"
                      value={formData.email2}
                      onChange={handleChange}
                      className="w-full bg-white/5 border border-white/20 rounded-xl pl-12 pr-4 py-3 text-white text-sm focus:border-blue-400 outline-none"
                      placeholder="Email médecin 2"
                      required={isCollabMode}
                    />
                  </div>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-400" />
                    <input
                      type={showPassword ? "text" : "password"}
                      name="password2"
                      value={formData.password2}
                      onChange={handleChange}
                      className="w-full bg-white/5 border border-white/20 rounded-xl pl-12 pr-4 py-3 text-white text-sm focus:border-blue-400 outline-none"
                      placeholder="Mot de passe"
                      required={isCollabMode}
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="w-full bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-semibold py-4 rounded-xl shadow-lg hover:shadow-cyan-500/40 transition-all flex items-center justify-center gap-2"
              >
                Lancer la session {isCollabMode ? "Duo" : ""}
                <ArrowRight size={18} />
              </button>
            </form>
          </div>
        </div>
      </div>
      <style>{`
        @keyframes gradient {
          0%, 100% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
        }
        @keyframes float-card {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-8px); }
        }
        .animate-gradient { animation: gradient 15s ease infinite; background-size: 400% 400%; }
        .animate-float-card { animation: float-card 6s ease-in-out infinite; }
      `}</style>
    </div>
  );
}