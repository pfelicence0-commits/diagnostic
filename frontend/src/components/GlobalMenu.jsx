import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Image as ImageIcon, LogOut, Stethoscope, Users, Brain } from 'lucide-react';

const GlobalMenu = () => {
  const navigate  = useNavigate();
  const location  = useLocation();

  const isActive = (path) => location.pathname === path;

  const handleLogout = () => {
    localStorage.removeItem('user');
    window.dispatchEvent(new Event('auth-change'));
    navigate('/login');
  };

  const navButtonClass = (active) =>
    `px-4 py-2 rounded-xl text-sm font-semibold border transition-all ` +
    (active
      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/40'
      : 'bg-white/5 text-slate-200 border-white/10 hover:bg-white/10');

  return (
    <div className="relative z-10 w-full max-w-6xl mx-auto mt-4 mb-6 px-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-3 shadow-xl">

        {/* Logo */}
        <div className="flex items-center gap-2 text-white font-semibold">
          <Stethoscope className="w-5 h-5 text-cyan-400" />
          <span>OtoScan AI</span>
        </div>

        {/* Nav links */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={navButtonClass(isActive('/diagnostic'))}
            onClick={() => navigate('/diagnostic')}
          >
            <span className="inline-flex items-center gap-2">
              <Stethoscope className="w-4 h-4" />
              Diagnostic
            </span>
          </button>

          <button
            type="button"
            className={navButtonClass(isActive('/mes-images'))}
            onClick={() => navigate('/mes-images')}
          >
            <span className="inline-flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              Images diagnostiquées
            </span>
          </button>

          {/* ── NOUVEAU : Patients ── */}
          <button
            type="button"
            className={navButtonClass(isActive('/patients'))}
            onClick={() => navigate('/patients')}
          >
            <span className="inline-flex items-center gap-2">
              <Users className="w-4 h-4" />
              Patients
            </span>
          </button>

          {/* ── NOUVEAU : Diagnostic IA ── */}
          <button
            type="button"
            className={navButtonClass(isActive('/diagnostic-ia'))}
            onClick={() => navigate('/diagnostic-ia')}
          >
            <span className="inline-flex items-center gap-2">
              <Brain className="w-4 h-4" />
              Diagnostic IA
            </span>
          </button>
        </div>

        {/* Logout */}
        <button
          type="button"
          className="px-4 py-2 rounded-xl text-sm font-semibold border border-red-400/30 bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-all"
          onClick={handleLogout}
        >
          <span className="inline-flex items-center gap-2">
            <LogOut className="w-4 h-4" />
            Déconnexion
          </span>
        </button>
      </div>
    </div>
  );
};

export default GlobalMenu;
