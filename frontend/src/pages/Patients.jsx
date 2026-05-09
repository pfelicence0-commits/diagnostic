import React, { useState, useEffect, useCallback } from 'react';
import {
  Users, Search, X, Eye, Trash2, Calendar, Phone,
  FileText, Activity, Brain, Upload, CheckCircle2,
  AlertTriangle, AlertCircle, ChevronDown, ChevronUp,
  Plus, ArrowLeft
} from 'lucide-react';
import GlobalMenu from '../components/GlobalMenu';
import { supabase } from '../supabaseClient';

// ─────────────────────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:8000/api';

const SEG_COLORS = {
  Normal      : { color: '#22c55e', bg: 'bg-green-500/15  border-green-500/30  text-green-400'  },
  OSM         : { color: '#eab308', bg: 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400' },
  OMA         : { color: '#ef4444', bg: 'bg-red-500/15    border-red-500/30    text-red-400'    },
  Perfo       : { color: '#3b82f6', bg: 'bg-blue-500/15   border-blue-500/30   text-blue-400'   },
  'PDR + Atel': { color: '#f97316', bg: 'bg-orange-500/15 border-orange-500/30 text-orange-400' },
  Chole       : { color: '#a855f7', bg: 'bg-purple-500/15 border-purple-500/30 text-purple-400' },
};

const categoryOptions = [
  { name: 'OMA',        options: ['Congestive', 'Suppurée', 'Perforée'] },
  { name: 'OSM',        options: ['Aucun'] },
  { name: 'Perfo',      options: ['Marginale', 'Non Marginale'] },
  { name: 'Chole',      options: ['Atticale', 'Post-Sup', 'Attic + Post-Sup'] },
  { name: 'PDR + Atel', options: ['Stade I', 'Stade II', 'Stade III'] },
  { name: 'Normal',     options: ['Aucun'] },
];

const inputCls =
  'w-full bg-slate-900 text-white text-sm px-3 py-2.5 rounded-xl border border-white/10 ' +
  'focus:outline-none focus:border-cyan-500/60 placeholder-slate-500 transition-colors';
const labelCls = 'block text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5';

// ─────────────────────────────────────────────────────────────────────────────
// Utilitaires
// ─────────────────────────────────────────────────────────────────────────────
function calcAge(dob) {
  if (!dob) return null;
  return Math.floor((Date.now() - new Date(dob)) / (365.25 * 864e5));
}

function DiagBadge({ label }) {
  const s = SEG_COLORS[label];
  const cls = s ? s.bg : 'bg-slate-700/50 border-slate-600 text-slate-300';
  return (
    <span className={`inline-block px-3 py-1 rounded-full border text-[11px] font-bold ${cls}`}>
      {label || '—'}
    </span>
  );
}

function ConfBar({ value, color = '#22d3ee', label }) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-300">{label}</span>
        <span className="font-mono text-white">{(value * 100).toFixed(1)}%</span>
      </div>
      <div className="w-full h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-2 rounded-full transition-all duration-700"
          style={{ width: `${value * 100}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal : Nouveau diagnostic IA pour un patient existant
// Flux : upload image → diagnostic médecin → (optionnel) lancer IA → valider
// ─────────────────────────────────────────────────────────────────────────────
function NouveauDiagnosticModal({ patient, onClose, onSaved }) {
  // étapes : 'upload' | 'medecin' | 'ia' | 'done'
  const [step, setStep]         = useState('upload');

  // upload
  const [file, setFile]         = useState(null);
  const [preview, setPreview]   = useState(null);
  const [drag, setDrag]         = useState(false);
  const [oreille, setOreille]   = useState('droite');

  // diagnostic médecin (saisi AVANT l'IA)
  const [docDiag, setDocDiag]   = useState('');
  const [docStade, setDocStade] = useState('Aucun');
  const [docNotes, setDocNotes] = useState('');

  // résultat IA (optionnel)
  const [iaResult, setIaResult] = useState(null);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaErr, setIaErr]       = useState('');
  const [iaLaunched, setIaLaunched] = useState(false);

  // sauvegarde
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState('');

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  // ── Lancement IA (optionnel) ──────────────────────────────────────────────
  const lancerIA = async () => {
    if (!file) return;
    setIaLoading(true); setIaErr(''); setIaLaunched(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Session expirée');

      const fd = new FormData();
      fd.append('image', file);
      fd.append('patient_id', patient.numero_dossier);
      fd.append('oreille', oreille);

      const res = await fetch(`${API_BASE}/analyse/`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd,
      });
      if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
      const data = await res.json();
      setIaResult(data);
    } catch (e) {
      setIaErr('❌ ' + e.message);
    } finally {
      setIaLoading(false);
    }
  };

  // ── Sauvegarde finale ─────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!docDiag) { setErr('Sélectionnez votre diagnostic'); return; }

    const iaClass  = iaResult?.classification?.seg_class || null;
    const accord   = iaClass ? (docDiag === iaClass) : null;
    const desaccord = iaClass ? (docDiag !== iaClass) : false;

    // mask sauvegardé seulement si accord total
    const maskB64   = accord && iaResult?.images?.mask_b64    ? iaResult.images.mask_b64    : null;
    const overlayB64 = accord && iaResult?.images?.overlay_b64 ? iaResult.images.overlay_b64 : null;

    setSaving(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const nomMedecin = user?.user_metadata?.prenom
        ? `${user.user_metadata.prenom} ${user.user_metadata.nom}`
        : user?.email || 'Médecin';

      // Si l'IA a déjà créé une consultation (via /analyse/), on la met à jour
      // sinon on en crée une nouvelle manuellement
      let consultationId = iaResult?.consultation_id || null;

      if (consultationId) {
        // Mise à jour de la consultation créée par l'IA
        const { error } = await supabase.from('consultations').update({
          diagnostic_medecin         : docDiag,
          stade_medecin              : docStade !== 'Aucun' ? docStade : null,
          notes_medecin              : docNotes || null,
          accord_ia_medecin          : accord,
          nom_medecin_diagnostiqueur : nomMedecin,
          medecin_id                 : user?.id || null,
          mask_sauvegarde            : !!maskB64,
          mask_b64                   : maskB64,
          overlay_b64                : overlayB64,
        }).eq('id', consultationId);
        if (error) throw error;
      } else {
        // Pas d'IA lancée : création manuelle de la consultation
        const { error } = await supabase.from('consultations').insert([{
          numero_dossier             : patient.numero_dossier,
          oreille,
          diagnostic_medecin         : docDiag,
          stade_medecin              : docStade !== 'Aucun' ? docStade : null,
          notes_medecin              : docNotes || null,
          accord_ia_medecin          : null,
          nom_medecin_diagnostiqueur : nomMedecin,
          medecin_id                 : user?.id || null,
          mask_sauvegarde            : false,
        }]);
        if (error) throw error;
      }

      setStep('done');
      onSaved();
    } catch (e) {
      setErr('❌ ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const iaClass    = iaResult?.classification?.seg_class;
  const accord     = iaClass && docDiag ? docDiag === iaClass : null;
  const desaccord  = iaClass && docDiag ? docDiag !== iaClass : false;
  const confColor  = c => c >= 0.7 ? '#22c55e' : c >= 0.4 ? '#f59e0b' : '#ef4444';
  const stagesForDoc = categoryOptions.find(c => c.name === docDiag)?.options || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
              <Brain size={15} className="text-cyan-400" />
            </div>
            <div>
              <h2 className="font-black text-white text-sm">Nouveau diagnostic</h2>
              <p className="text-slate-500 text-xs">
                {patient.prenom} {patient.nom} · #{patient.numero_dossier}
              </p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 transition">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">

          {/* ── ÉTAPE 1 : Upload image ─────────────────────────────────────── */}
          <div>
            <p className={labelCls}>1. Image otoscopique</p>

            {/* Oreille */}
            <div className="flex gap-2 mb-3">
              {['droite', 'gauche', 'bilatérale'].map(o => (
                <button key={o} type="button" onClick={() => setOreille(o)}
                  className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition ${
                    oreille === o
                      ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                  }`}>
                  {o.charAt(0).toUpperCase() + o.slice(1)}
                </button>
              ))}
            </div>

            {/* Zone drop */}
            <div
              className={`relative border-2 border-dashed rounded-2xl flex items-center
                          justify-center overflow-hidden transition-all ${
                drag ? 'border-cyan-400 bg-cyan-500/5' : 'border-white/10 bg-slate-900/50'
              }`}
              style={{ minHeight: 180 }}
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
            >
              <input type="file" accept="image/*"
                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                onChange={e => handleFile(e.target.files[0])} />
              {preview ? (
                <img src={preview} alt="preview"
                  className="w-full h-full object-contain max-h-44 pointer-events-none" />
              ) : (
                <div className="text-center p-8 pointer-events-none">
                  <Upload size={32} className="mx-auto mb-2 text-cyan-400 opacity-70" />
                  <p className="text-slate-400 text-sm font-semibold">Glisser ou cliquer pour uploader</p>
                  <p className="text-slate-600 text-xs mt-1">JPG, PNG, WebP</p>
                </div>
              )}
            </div>
            {file && (
              <p className="text-xs text-slate-500 mt-1.5 text-center">
                📎 {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>

          {/* ── ÉTAPE 2 : Diagnostic médecin (AVANT l'IA) ────────────────── */}
          <div className="bg-slate-800/40 border border-white/8 rounded-2xl p-4 space-y-4">
            <p className={labelCls}>2. Votre diagnostic (avant analyse IA)</p>

            <div>
              <label className="block text-xs text-slate-400 mb-2">Diagnostic *</label>
              <div className="grid grid-cols-3 gap-2">
                {categoryOptions.map(cat => (
                  <button key={cat.name} type="button"
                    onClick={() => { setDocDiag(cat.name); setDocStade('Aucun'); }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold border transition ${
                      docDiag === cat.name
                        ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-300'
                        : 'border-white/5 bg-white/5 text-slate-400 hover:bg-white/10'
                    }`}>
                    {cat.name}
                  </button>
                ))}
              </div>
            </div>

            {docDiag && stagesForDoc.length > 1 && (
              <div>
                <label className="block text-xs text-slate-400 mb-2">Stade / Type</label>
                <select className={inputCls} value={docStade}
                  onChange={e => setDocStade(e.target.value)}>
                  <option value="Aucun">— Sélectionner —</option>
                  {stagesForDoc.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs text-slate-400 mb-2">Notes cliniques</label>
              <textarea className={inputCls} rows={2}
                placeholder="Observations, contexte clinique..."
                value={docNotes} onChange={e => setDocNotes(e.target.value)} />
            </div>
          </div>

          {/* ── ÉTAPE 3 : Lancer l'IA (optionnel) ───────────────────────── */}
          <div className="border border-white/10 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className={labelCls + ' mb-0'}>3. Analyse IA (optionnel)</p>
              {!iaLaunched && (
                <span className="text-[10px] text-slate-500 italic">Non activée par défaut</span>
              )}
            </div>

            {!iaLaunched ? (
              <button
                onClick={lancerIA}
                disabled={!file || !docDiag}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10
                           text-sm font-bold transition disabled:opacity-40
                           flex items-center justify-center gap-2 text-cyan-300"
              >
                <Brain size={15} />
                {!file ? 'Uploadez une image d\'abord' :
                 !docDiag ? 'Posez votre diagnostic d\'abord' :
                 'Lancer l\'analyse IA maintenant'}
              </button>
            ) : iaLoading ? (
              <div className="flex items-center justify-center gap-3 py-4 text-slate-400 text-sm">
                <div className="w-4 h-4 border-2 border-slate-600 border-t-cyan-400 rounded-full animate-spin" />
                Analyse IA en cours...
              </div>
            ) : iaErr ? (
              <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
                {iaErr}
              </div>
            ) : iaResult ? (
              <div className="space-y-3">
                {/* Résultat IA */}
                <div className="bg-slate-800/60 rounded-xl p-4">
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-3">
                    🤖 Résultat IA
                  </p>
                  <div className="flex items-center justify-between mb-3">
                    <DiagBadge label={iaClass} />
                    <span className="text-xl font-black font-mono"
                      style={{ color: confColor(iaResult.classification.confidence) }}>
                      {(iaResult.classification.confidence * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {iaResult.classification.top3?.map((t, i) => (
                      <ConfBar key={i} label={t.yolo_class} value={t.confidence}
                        color={SEG_COLORS[t.seg_class]?.color || '#64748b'} />
                    ))}
                  </div>
                </div>

                {/* Images overlay + mask (si accord) */}
                {iaResult.images?.overlay_b64 && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-[10px] text-slate-500 uppercase font-bold mb-1.5">Segmentation</p>
                      <img src={`data:image/png;base64,${iaResult.images.overlay_b64}`}
                        className="w-full rounded-xl border border-white/10 object-contain" alt="overlay" />
                    </div>
                    {iaResult.images?.mask_b64 && (
                      <div>
                        <p className="text-[10px] text-slate-500 uppercase font-bold mb-1.5">
                          Masque
                          {accord ? ' ✅ (sera sauvegardé)' : ' ⚠️ (non sauvegardé si désaccord)'}
                        </p>
                        <img src={`data:image/png;base64,${iaResult.images.mask_b64}`}
                          className="w-full rounded-xl border border-white/10 object-contain" alt="mask" />
                      </div>
                    )}
                  </div>
                )}

                {/* Accord / Désaccord */}
                {docDiag && (
                  <div className={`rounded-xl px-4 py-3 border flex items-start gap-3 ${
                    accord
                      ? 'bg-green-500/10 border-green-500/30'
                      : 'bg-orange-500/10 border-orange-500/30'
                  }`}>
                    {accord
                      ? <CheckCircle2 size={18} className="text-green-400 flex-shrink-0 mt-0.5" />
                      : <AlertTriangle size={18} className="text-orange-400 flex-shrink-0 mt-0.5" />
                    }
                    <div>
                      {accord ? (
                        <>
                          <p className="font-bold text-green-300 text-sm">✅ Accord IA / Médecin</p>
                          <p className="text-green-600 text-xs mt-0.5">
                            Les deux diagnostics convergent vers <strong>{iaClass}</strong>.
                            Le masque sera sauvegardé.
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-bold text-orange-300 text-sm">⚠️ Désaccord</p>
                          <p className="text-orange-500 text-xs mt-0.5">
                            IA : <strong>{iaClass}</strong> — Vous : <strong>{docDiag}</strong>.
                            Le masque ne sera pas sauvegardé.
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* Erreur + bouton valider */}
          {err && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30
                            rounded-xl px-4 py-3 text-red-400 text-sm">
              <AlertCircle size={14} /> {err}
            </div>
          )}

          {step !== 'done' && (
            <button
              onClick={handleSave}
              disabled={saving || !docDiag || !file}
              className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600
                         font-black text-sm uppercase tracking-wider transition
                         hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {saving
                ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Enregistrement...</>
                : '✅ Valider et enregistrer le diagnostic'
              }
            </button>
          )}

          {step === 'done' && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-2xl p-6 text-center">
              <CheckCircle2 size={36} className="text-green-400 mx-auto mb-2" />
              <p className="font-black text-green-300">Diagnostic enregistré !</p>
              <button onClick={onClose}
                className="mt-3 px-6 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-sm font-bold transition">
                Fermer
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal : Historique complet des consultations d'un patient
// ─────────────────────────────────────────────────────────────────────────────
function HistoriqueModal({ patient, onClose }) {
  const [diagnostics, setDiagnostics] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    // ✅ On tire directement de `consultations` avec toutes les colonnes utiles
    const { data, error } = await supabase
      .from('consultations')
      .select(`
        id,
        created_at,
        oreille,
        diagnostic_medecin,
        stade_medecin,
        notes_medecin,
        ia_seg_classe,
        ia_yolo_classe,
        ia_yolo_confiance,
        accord_ia_medecin,
        nom_medecin_diagnostiqueur,
        image_originale_url,
        overlay_url,
        mask_sauvegarde,
        mask_b64,
        overlay_b64
      `)
      .eq('numero_dossier', patient.numero_dossier)
      .order('created_at', { ascending: false });

    if (error) console.error(error);
    setDiagnostics(data || []);
    setLoading(false);
  }, [patient.numero_dossier]);

  useEffect(() => { load(); }, [load]);

  const age = calcAge(patient.date_naissance);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-white/10 rounded-3xl w-full max-w-2xl max-h-[88vh] flex flex-col shadow-2xl">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 flex-shrink-0">
          <div>
            <h2 className="text-base font-black text-white">
              {patient.prenom || ''} {patient.nom || ''}
              &nbsp;<span className="text-slate-500 font-normal text-sm">#{patient.numero_dossier}</span>
            </h2>
            <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 flex-wrap">
              {age && <span className="flex items-center gap-1"><Calendar size={11} />{age} ans</span>}
              {patient.sexe && <span>{patient.sexe === 'M' ? '👨 Masculin' : '👩 Féminin'}</span>}
              {patient.telephone && <span className="flex items-center gap-1"><Phone size={11} />{patient.telephone}</span>}
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-slate-400 transition">
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">

          {/* Antécédents */}
          {(patient.antecedents || patient.notes) && (
            <div className="bg-slate-800/50 rounded-2xl p-4 space-y-2">
              {patient.antecedents && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">⚕️ Antécédents</p>
                  <p className="text-sm text-slate-300">{patient.antecedents}</p>
                </div>
              )}
              {patient.notes && (
                <div>
                  <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest mb-1">📝 Notes</p>
                  <p className="text-sm text-slate-300">{patient.notes}</p>
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] font-bold uppercase text-slate-500 tracking-widest flex items-center gap-2">
            <Activity size={11} /> Historique — {diagnostics.length} consultation{diagnostics.length !== 1 ? 's' : ''}
          </p>

          {loading ? (
            <div className="flex items-center justify-center py-10 gap-3 text-slate-500 text-sm">
              <div className="w-4 h-4 border-2 border-slate-600 border-t-cyan-400 rounded-full animate-spin" />
              Chargement...
            </div>
          ) : diagnostics.length === 0 ? (
            <div className="bg-slate-800/30 border border-white/5 rounded-2xl p-8 text-center">
              <FileText size={32} className="mx-auto mb-3 text-slate-600" />
              <p className="text-slate-500 text-sm font-semibold">Aucune consultation enregistrée</p>
            </div>
          ) : (
            <div className="space-y-3">
              {diagnostics.map((d, idx) => {
                const isOpen = expanded === idx;

                // ✅ Colonnes correctes selon ta table
                const diagMedecin  = d.diagnostic_medecin || '—';
                const diagIA       = d.ia_seg_classe || d.ia_yolo_classe || null;
                const stade        = d.stade_medecin || null;
                const medecin      = d.nom_medecin_diagnostiqueur || null;
                const accord       = d.accord_ia_medecin;
                const oreilleVal   = d.oreille || null;
                const maskSauvegarde = d.mask_sauvegarde || false;

                // Image originale : priorité à image_originale_url
                const imageUrl     = d.image_originale_url || null;
                // Segmentation : priorité à overlay_url, fallback overlay_b64
                const overlayUrl   = d.overlay_url || null;
                const overlayB64   = d.overlay_b64  || null;
                const overlaySrc   = overlayUrl
                  ? overlayUrl
                  : overlayB64
                    ? `data:image/png;base64,${overlayB64}`
                    : null;

                const dateFormatted = new Date(d.created_at).toLocaleDateString('fr-FR', {
                  day: '2-digit', month: 'long', year: 'numeric'
                });

                return (
                  <div key={d.id}
                    className="bg-slate-800/40 border border-white/5 rounded-2xl overflow-hidden transition-all">

                    {/* ── En-tête cliquable ── */}
                    <button
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.03] transition text-left"
                      onClick={() => setExpanded(isOpen ? null : idx)}
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <DiagBadge label={diagMedecin} />
                        {oreilleVal && (
                          <span className="text-xs text-slate-500 capitalize">🦻 {oreilleVal}</span>
                        )}
                        {accord !== null && accord !== undefined && (
                          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${
                            accord
                              ? 'bg-green-500/10 border-green-500/30 text-green-400'
                              : 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                          }`}>
                            {accord ? '✅ Accord' : '⚠️ Désaccord'}
                          </span>
                        )}
                        {maskSauvegarde && (
                          <span className="text-[10px] text-cyan-400">🗺️ Masque sauvegardé</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                        <span className="text-[10px] text-slate-500">{dateFormatted}</span>
                        {isOpen
                          ? <ChevronUp size={13} className="text-slate-500" />
                          : <ChevronDown size={13} className="text-slate-500" />
                        }
                      </div>
                    </button>

                    {/* ── Détails dépliables ── */}
                    {isOpen && (
                      <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/5">

                        {/* Images */}
                        {(imageUrl || overlaySrc) && (
                          <div className="grid grid-cols-2 gap-3">
                            {imageUrl && (
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1.5">
                                  📷 Image otoscopique
                                </p>
                                <img
                                  src={imageUrl}
                                  alt="otoscopie originale"
                                  className="w-full rounded-xl border border-white/10 object-contain max-h-40"
                                />
                              </div>
                            )}
                            {overlaySrc && (
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase font-bold mb-1.5">
                                  🧠 Segmentation IA
                                  {maskSauvegarde ? ' ✅' : ''}
                                </p>
                                <img
                                  src={overlaySrc}
                                  alt="segmentation IA"
                                  className="w-full rounded-xl border border-white/10 object-contain max-h-40"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* Informations textuelles */}
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-slate-500 mb-1">Diagnostic médecin</p>
                            <DiagBadge label={diagMedecin} />
                          </div>

                          {diagIA && (
                            <div>
                              <p className="text-slate-500 mb-1">Diagnostic IA</p>
                              <DiagBadge label={diagIA} />
                            </div>
                          )}

                          {stade && stade !== 'Aucun' && (
                            <div>
                              <p className="text-slate-500">Stade / Type</p>
                              <p className="text-slate-200 font-semibold mt-0.5">{stade}</p>
                            </div>
                          )}

                          {medecin && (
                            <div>
                              <p className="text-slate-500">Médecin</p>
                              <p className="text-slate-200 font-semibold mt-0.5">👨‍⚕️ {medecin}</p>
                            </div>
                          )}

                          {/* Date complète avec heure */}
                          <div>
                            <p className="text-slate-500">Date de consultation</p>
                            <p className="text-slate-200 font-semibold mt-0.5">
                              📅 {new Date(d.created_at).toLocaleString('fr-FR', {
                                day: '2-digit', month: 'long', year: 'numeric',
                                hour: '2-digit', minute: '2-digit'
                              })}
                            </p>
                          </div>

                          {d.notes_medecin && (
                            <div className="col-span-2">
                              <p className="text-slate-500 mb-1">Notes cliniques</p>
                              <p className="text-slate-300">{d.notes_medecin}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page principale — Tableau de suivi
// ─────────────────────────────────────────────────────────────────────────────
export default function Patients() {
  const [patients, setPatients]             = useState([]);
  const [search, setSearch]                 = useState('');
  const [loading, setLoading]               = useState(true);
  const [viewPatient, setViewPatient]       = useState(null);   // modal historique
  const [diagPatient, setDiagPatient]       = useState(null);   // modal nouveau diagnostic
  const [toast, setToast]                   = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('patients').select('*').order('created_at', { ascending: false });
    if (search.trim()) {
      q = q.or(`numero_dossier.ilike.%${search}%,nom.ilike.%${search}%,prenom.ilike.%${search}%,telephone.ilike.%${search}%`);
    }
    const { data } = await q;
    setPatients(data || []);
    setLoading(false);
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id, label) => {
    if (!window.confirm(`Supprimer le dossier "${label}" et toutes ses données ?`)) return;
    const { error } = await supabase.from('patients').delete().eq('id', id);
    if (error) { showToast('❌ Erreur lors de la suppression'); return; }
    showToast('✅ Dossier supprimé');
    load();
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-white font-sans">
      <GlobalMenu />

      <div className="max-w-6xl mx-auto px-4 pb-12">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6 pt-2">
          <Users className="text-cyan-400" size={26} />
          <div>
            <h1 className="text-2xl font-black text-white">Tableau de suivi</h1>
            <p className="text-slate-500 text-sm mt-0.5">
              {loading ? '…' : `${patients.length} patient${patients.length !== 1 ? 's' : ''} enregistré${patients.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>

        {/* Recherche */}
        <div className="relative mb-5">
          <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="w-full bg-slate-800/50 border border-white/10 rounded-2xl pl-10 pr-10 py-3
                       text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 transition"
            placeholder="Rechercher par numéro de dossier, nom, prénom, téléphone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition">
              <X size={14} />
            </button>
          )}
        </div>

        {/* Tableau */}
        {loading ? (
          <div className="flex items-center justify-center py-24 gap-3 text-slate-500">
            <div className="w-5 h-5 border-2 border-slate-600 border-t-cyan-400 rounded-full animate-spin" />
            Chargement...
          </div>
        ) : patients.length === 0 ? (
          <div className="bg-slate-800/30 border border-white/5 rounded-3xl p-16 text-center">
            <Users size={48} className="mx-auto mb-4 text-slate-600" />
            <p className="font-bold text-slate-400 text-lg">
              {search ? 'Aucun résultat trouvé' : 'Aucun patient enregistré'}
            </p>
            <p className="text-sm text-slate-600 mt-1">
              {search ? "Essayez d'autres termes" : 'Lancez un diagnostic IA pour créer le premier dossier'}
            </p>
          </div>
        ) : (
          <div className="bg-slate-800/30 border border-white/5 rounded-3xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  {['N° Dossier', 'Patient', 'Âge', 'Téléphone', 'Antécédents', 'Créé le', 'Actions'].map(h => (
                    <th key={h}
                      className="text-left px-5 py-3.5 text-[10px] font-black uppercase tracking-widest text-slate-500 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {patients.map((p, i) => {
                  const age = calcAge(p.date_naissance);
                  const fullName = [p.prenom, p.nom].filter(Boolean).join(' ');
                  return (
                    <tr key={p.id}
                      className={`border-b border-white/5 transition-colors hover:bg-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>

                      <td className="px-5 py-3.5">
                        <span className="font-mono text-xs bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 px-2 py-1 rounded-lg whitespace-nowrap">
                          {p.numero_dossier}
                        </span>
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center flex-shrink-0 text-[10px] font-black text-slate-400">
                            {p.prenom?.[0] || p.nom?.[0] || '?'}
                          </div>
                          <div>
                            <p className="font-semibold text-white">
                              {fullName || <span className="text-slate-600 italic text-xs">Non renseigné</span>}
                            </p>
                            {p.sexe && <p className="text-[10px] text-slate-500">{p.sexe === 'M' ? '♂ Masculin' : '♀ Féminin'}</p>}
                          </div>
                        </div>
                      </td>

                      <td className="px-5 py-3.5 text-slate-400 whitespace-nowrap">
                        {age ? `${age} ans` : '—'}
                      </td>

                      <td className="px-5 py-3.5 text-slate-400 whitespace-nowrap">
                        {p.telephone || '—'}
                      </td>

                      <td className="px-5 py-3.5 max-w-[160px]">
                        <p className="truncate text-xs text-slate-400">
                          {p.antecedents || <span className="text-slate-600 italic">—</span>}
                        </p>
                      </td>

                      <td className="px-5 py-3.5 text-slate-500 text-xs whitespace-nowrap">
                        {p.created_at
                          ? new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
                          : '—'}
                      </td>

                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5 flex-nowrap">

                          {/* Nouveau diagnostic IA */}
                          <button
                            onClick={() => setDiagPatient(p)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-cyan-500/10
                                       text-cyan-400 hover:bg-cyan-500/20 transition text-xs font-bold whitespace-nowrap"
                            title="Ajouter un diagnostic IA"
                          >
                            <Plus size={12} /> Diagnostic IA
                          </button>

                          {/* Voir historique */}
                          <button
                            onClick={() => setViewPatient(p)}
                            className="p-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition"
                            title="Voir l'historique"
                          >
                            <Eye size={13} />
                          </button>

                          {/* Supprimer */}
                          <button
                            onClick={() => handleDelete(p.id, fullName || p.numero_dossier)}
                            className="p-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition"
                            title="Supprimer ce dossier"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal nouveau diagnostic */}
      {diagPatient && (
        <NouveauDiagnosticModal
          patient={diagPatient}
          onClose={() => setDiagPatient(null)}
          onSaved={() => { showToast('✅ Diagnostic enregistré'); load(); }}
        />
      )}

      {/* Modal historique */}
      {viewPatient && (
        <HistoriqueModal
          patient={viewPatient}
          onClose={() => setViewPatient(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-slate-800 border border-white/10 rounded-2xl px-5 py-3 text-sm font-semibold shadow-2xl z-50">
          {toast}
        </div>
      )}
    </div>
  );
}