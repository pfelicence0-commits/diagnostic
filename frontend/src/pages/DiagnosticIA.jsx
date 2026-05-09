import React, { useState, useEffect, useCallback } from 'react';
import {
  Brain, Upload, Search, CheckCircle2, AlertCircle,
  AlertTriangle, ChevronRight, Users, Plus, X,
  UserPlus, Stethoscope, ArrowLeft
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
function ClassBadge({ cls, size = 'sm' }) {
  const s = SEG_COLORS[cls] || { bg: 'bg-slate-700 border-slate-600 text-slate-300' };
  return (
    <span className={`inline-block px-3 py-1 rounded-full border font-bold
      ${size === 'lg' ? 'text-sm' : 'text-[11px]'} ${s.bg}`}>
      {cls || '—'}
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

function PatientCard({ patient, oreille }) {
  const age = patient.date_naissance
    ? Math.floor((Date.now() - new Date(patient.date_naissance)) / (365.25 * 864e5))
    : null;
  return (
    <div className="flex items-center gap-4 bg-slate-800/60 border border-cyan-500/20 rounded-2xl px-5 py-3">
      <div className="w-10 h-10 rounded-full bg-cyan-500/20 flex items-center justify-center flex-shrink-0">
        <Users size={18} className="text-cyan-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-white text-sm truncate">
          {patient.prenom || ''} {patient.nom || ''}
          {!patient.prenom && !patient.nom && <span className="text-slate-500 italic">Nom non renseigné</span>}
        </p>
        <p className="text-xs text-slate-400">
          #{patient.numero_dossier}
          {age ? ` · ${age} ans` : ''}
          {patient.telephone ? ` · ${patient.telephone}` : ''}
        </p>
      </div>
      <span className="flex-shrink-0 text-xs bg-slate-700 px-3 py-1 rounded-full text-slate-300 capitalize">
        Oreille {oreille}
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAPE 1 — Recherche ou création patient (fusionné)
// ─────────────────────────────────────────────────────────────────────────────
function StepPatient({ onValidated }) {
  const [mode, setMode]           = useState('search'); // 'search' | 'create'
  const [num, setNum]             = useState('');
  const [oreille, setOreille]     = useState('droite');
  const [patient, setPatient]     = useState(null);
  const [checking, setChecking]   = useState(false);
  const [notFound, setNotFound]   = useState(false);

  // Création
  const [form, setForm] = useState({
    numero_dossier: '', nom: '', prenom: '', telephone: '',
    date_naissance: '', sexe: '', antecedents: '', notes: '',
  });
  const [numExists, setNumExists]   = useState(false);
  const [checkingNum, setCheckingNum] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [saveErr, setSaveErr]       = useState('');

  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // ── Recherche dossier ─────────────────────────────────────────────────────
  const lookup = useCallback(async (value) => {
    const q = (value ?? num).trim();
    if (!q) return;
    setChecking(true); setNotFound(false); setPatient(null);
    const { data } = await supabase
      .from('patients').select('*')
      .eq('numero_dossier', q).limit(1).maybeSingle();
    setChecking(false);
    if (data) setPatient(data);
    else setNotFound(true);
  }, [num]);

  // ── Vérif unicité numéro (création) ──────────────────────────────────────
  useEffect(() => {
    if (!form.numero_dossier.trim()) { setNumExists(false); return; }
    const t = setTimeout(async () => {
      setCheckingNum(true);
      const { data } = await supabase.from('patients').select('id')
        .eq('numero_dossier', form.numero_dossier.trim()).limit(1);
      setNumExists(!!(data && data.length > 0));
      setCheckingNum(false);
    }, 400);
    return () => clearTimeout(t);
  }, [form.numero_dossier]);

  // ── Création patient + passage direct à l'analyse ─────────────────────────
  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.numero_dossier.trim()) { setSaveErr('Le numéro de dossier est obligatoire'); return; }
    if (numExists) { setSaveErr('Ce numéro existe déjà'); return; }
    setSaving(true); setSaveErr('');
    try {
      const payload = {
        numero_dossier : form.numero_dossier.trim(),
        nom            : form.nom.trim()         || null,
        prenom         : form.prenom.trim()      || null,
        telephone      : form.telephone.trim()   || null,
        date_naissance : form.date_naissance     || null,
        sexe           : form.sexe               || null,
        antecedents    : form.antecedents.trim() || null,
        notes          : form.notes.trim()       || null,
      };
      const { data, error } = await supabase.from('patients').insert([payload]).select().single();
      if (error) throw error;
      // → passage direct vers l'analyse avec le patient créé
      onValidated({ patient: data, numeroDossier: data.numero_dossier, oreille });
    } catch (err) {
      setSaveErr(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">

      {/* Toggle recherche / création */}
      <div className="flex gap-2 p-1 bg-slate-900 rounded-2xl border border-white/10">
        <button
          onClick={() => { setMode('search'); setNotFound(false); setPatient(null); }}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition ${
            mode === 'search'
              ? 'bg-cyan-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Search size={15} /> Rechercher un dossier
        </button>
        <button
          onClick={() => setMode('create')}
          className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition ${
            mode === 'create'
              ? 'bg-cyan-600 text-white shadow'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <UserPlus size={15} /> Nouveau patient
        </button>
      </div>

      {/* ── MODE RECHERCHE ─────────────────────────────────────────────────── */}
      {mode === 'search' && (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Numéro de dossier</label>
            <div className="flex gap-2">
              <input
                className={inputCls + ' flex-1'}
                placeholder="Ex: 2024-ORL-0042"
                value={num}
                onChange={e => { setNum(e.target.value); setPatient(null); setNotFound(false); }}
                onKeyDown={e => e.key === 'Enter' && lookup()}
              />
              <button
                onClick={() => lookup()}
                disabled={!num.trim() || checking}
                className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 rounded-xl font-bold
                           text-sm transition disabled:opacity-50 flex items-center gap-2"
              >
                <Search size={14} /> {checking ? '...' : 'Chercher'}
              </button>
            </div>
          </div>

          {notFound && (
            <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-4 py-4 space-y-3">
              <div className="flex items-center gap-2 text-orange-400 text-sm">
                <AlertCircle size={15} />
                <span>Dossier <strong>{num}</strong> introuvable.</span>
              </div>
              <button
                onClick={() => {
                  setForm(f => ({ ...f, numero_dossier: num }));
                  setMode('create');
                }}
                className="w-full py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white
                           text-sm font-bold transition flex items-center justify-center gap-2"
              >
                <UserPlus size={14} /> Créer ce dossier maintenant
              </button>
            </div>
          )}

          {patient && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3
                            flex items-center gap-3">
              <CheckCircle2 size={18} className="text-green-400 flex-shrink-0" />
              <div>
                <p className="text-green-300 font-bold text-sm">
                  {patient.prenom || ''} {patient.nom || ''}
                </p>
                <p className="text-green-600 text-xs">#{patient.numero_dossier}</p>
              </div>
            </div>
          )}

          {/* Oreille */}
          <div>
            <label className={labelCls}>Oreille examinée</label>
            <div className="flex gap-3">
              {['droite', 'gauche', 'bilatérale'].map(o => (
                <button key={o} onClick={() => setOreille(o)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                    oreille === o
                      ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                  }`}>
                  {o.charAt(0).toUpperCase() + o.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => patient && onValidated({ patient, numeroDossier: patient.numero_dossier, oreille })}
            disabled={!patient}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600
                       font-black text-sm uppercase tracking-wider transition
                       hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <Stethoscope size={16} /> Lancer l'analyse IA →
          </button>
        </div>
      )}

      {/* ── MODE CRÉATION ──────────────────────────────────────────────────── */}
      {mode === 'create' && (
        <form onSubmit={handleCreate} className="space-y-4">

          {/* Numéro dossier */}
          <div>
            <label className={labelCls}>
              Numéro de dossier <span className="text-red-400">*</span>
            </label>
            <div className="relative">
              <input
                className={`${inputCls} pr-8 ${
                  numExists ? 'border-red-500/60' :
                  form.numero_dossier && !numExists && !checkingNum ? 'border-green-500/60' : ''
                }`}
                placeholder="Ex: 2024-ORL-0042"
                value={form.numero_dossier}
                onChange={e => setF('numero_dossier', e.target.value)}
                required
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px]">
                {checkingNum ? '⏳' : numExists ? '❌' : form.numero_dossier ? '✅' : ''}
              </span>
            </div>
            {numExists && <p className="text-[10px] text-red-400 mt-1">Ce numéro existe déjà</p>}
          </div>

          {/* Nom / Prénom */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Nom</label>
              <input className={inputCls} placeholder="BENALI"
                value={form.nom} onChange={e => setF('nom', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Prénom</label>
              <input className={inputCls} placeholder="Ahmed"
                value={form.prenom} onChange={e => setF('prenom', e.target.value)} />
            </div>
          </div>

          {/* Téléphone + Date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Téléphone</label>
              <input className={inputCls} placeholder="0555 000 000"
                value={form.telephone} onChange={e => setF('telephone', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Date de naissance</label>
              <input type="date" className={inputCls}
                value={form.date_naissance} onChange={e => setF('date_naissance', e.target.value)} />
            </div>
          </div>

          {/* Sexe */}
          <div>
            <label className={labelCls}>Sexe</label>
            <select className={inputCls} value={form.sexe} onChange={e => setF('sexe', e.target.value)}>
              <option value="">— Non précisé —</option>
              <option value="M">Masculin</option>
              <option value="F">Féminin</option>
            </select>
          </div>

          {/* Antécédents */}
          <div>
            <label className={labelCls}>Antécédents médicaux</label>
            <textarea className={inputCls} rows={2}
              placeholder="Diabète, HTA, allergies..."
              value={form.antecedents} onChange={e => setF('antecedents', e.target.value)} />
          </div>

          {/* Oreille */}
          <div>
            <label className={labelCls}>Oreille examinée</label>
            <div className="flex gap-3">
              {['droite', 'gauche', 'bilatérale'].map(o => (
                <button type="button" key={o} onClick={() => setOreille(o)}
                  className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border transition ${
                    oreille === o
                      ? 'bg-cyan-500/20 border-cyan-400/40 text-cyan-300'
                      : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                  }`}>
                  {o.charAt(0).toUpperCase() + o.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {saveErr && (
            <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30
                            rounded-xl px-4 py-3 text-red-400 text-sm">
              <AlertCircle size={14} /> {saveErr}
            </div>
          )}

          <button
            type="submit"
            disabled={saving || numExists || !form.numero_dossier.trim()}
            className="w-full py-3 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600
                       font-black text-sm uppercase tracking-wider transition
                       hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {saving
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Création...</>
              : <><UserPlus size={16} /> Créer et lancer l'analyse IA →</>
            }
          </button>
        </form>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAPE 2 — Upload image + lancement IA
// ─────────────────────────────────────────────────────────────────────────────
function StepUpload({ dossierInfo, onResult }) {
  const [file, setFile]       = useState(null);
  const [preview, setPreview] = useState(null);
  const [drag, setDrag]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');

  const handleFile = (f) => {
    if (!f) return;
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setErr('');
  };

  const launch = async () => {
    if (!file) return;
    setLoading(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Session expirée — veuillez vous reconnecter');

      const fd = new FormData();
      fd.append('image', file);
      fd.append('patient_id', dossierInfo.numeroDossier || 'anonymous');
      fd.append('oreille', dossierInfo.oreille || 'droite');

      const response = await fetch(`${API_BASE}/analyse/`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: fd,
      });

      if (!response.ok) {
        const txt = await response.text();
        throw new Error(txt || `Erreur HTTP ${response.status}`);
      }

      const data = await response.json();
      onResult({ ...data, imageFile: file, imagePreview: preview });
    } catch (e) {
      setErr('❌ ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto space-y-5">

      {/* Récap patient — pré-rempli, non modifiable */}
      <PatientCard patient={dossierInfo.patient} oreille={dossierInfo.oreille} />

      {/* Zone upload */}
      <div
        className={`relative border-2 border-dashed rounded-3xl flex items-center
                    justify-center overflow-hidden transition-all ${
          drag ? 'border-cyan-400 bg-cyan-500/5' : 'border-white/10 bg-slate-900/50'
        }`}
        style={{ minHeight: 260 }}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
      >
        <input
          type="file" accept="image/*"
          className="absolute inset-0 opacity-0 cursor-pointer z-10"
          onChange={e => handleFile(e.target.files[0])}
        />
        {preview ? (
          <img src={preview} alt="preview"
               className="w-full h-full object-contain max-h-64 pointer-events-none" />
        ) : (
          <div className="text-center p-10 pointer-events-none">
            <Upload size={40} className="mx-auto mb-3 text-cyan-400 opacity-70" />
            <p className="font-bold text-slate-400 text-sm">Glisser ou cliquer pour uploader</p>
            <p className="text-xs text-slate-600 mt-1">JPG, PNG, WebP — max 10 MB</p>
          </div>
        )}
      </div>

      {file && (
        <p className="text-xs text-slate-500 text-center">
          📎 {file.name} — {(file.size / 1024 / 1024).toFixed(2)} MB
        </p>
      )}

      {err && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3
                        text-red-400 text-sm whitespace-pre-wrap break-all">
          {err}
        </div>
      )}

      <button
        onClick={launch}
        disabled={!file || loading}
        className="w-full py-4 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600
                   font-black text-sm uppercase tracking-wider transition
                   hover:brightness-110 disabled:opacity-40 flex items-center justify-center gap-3"
      >
        {loading ? (
          <>
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Analyse IA en cours...
          </>
        ) : (
          <><Brain size={18} /> Lancer l'analyse IA</>
        )}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ÉTAPE 3 — Résultats IA + diagnostic médecin
// ─────────────────────────────────────────────────────────────────────────────
function StepResult({ result, dossierInfo, onFinish }) {
  const clf  = result.classification;
  const seg  = result.segmentation;
  const imgs = result.images;

  const [docDiag, setDocDiag]   = useState('');
  const [docStade, setDocStade] = useState('Aucun');
  const [docNotes, setDocNotes] = useState('');
  const [tiers, setTiers]       = useState('');
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [err, setErr]           = useState('');

  const iaClass      = clf.seg_class;
  const stagesForDoc = categoryOptions.find(c => c.name === docDiag)?.options || [];
  const accord       = docDiag && docDiag === iaClass;
  const desaccord    = docDiag && docDiag !== iaClass;
  const confColor    = c => c >= 0.7 ? '#22c55e' : c >= 0.4 ? '#f59e0b' : '#ef4444';

  const handleSave = async () => {
    if (!docDiag) { setErr('Saisissez votre diagnostic avant de valider'); return; }
    if (desaccord && !tiers.trim()) {
      setErr('En cas de désaccord, un 3ème avis est obligatoire'); return;
    }
    setSaving(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      const nomMedecin = user?.user_metadata?.prenom
        ? `${user.user_metadata.prenom} ${user.user_metadata.nom}`
        : user?.email || 'Médecin';

      const { error } = await supabase
        .from('consultations')
        .update({
          diagnostic_medecin:          docDiag,
          stade_medecin:               docStade !== 'Aucun' ? docStade : null,
          notes_medecin:               docNotes || null,
          accord_ia_medecin:           accord,
          tiers_avis:                  desaccord ? tiers.trim() : null,
          nom_medecin_diagnostiqueur:  nomMedecin,
          medecin_id:                  user?.id || null,
        })
        .eq('id', result.consultation_id);

      if (error) throw error;
      setSaved(true);
    } catch (e) {
      setErr('❌ Erreur : ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">

      {/* Récap patient en haut */}
      <PatientCard patient={dossierInfo.patient} oreille={dossierInfo.oreille} />

      {/* Images */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Résultat segmentation
          </p>
          {imgs.overlay_b64 ? (
            <img src={`data:image/png;base64,${imgs.overlay_b64}`} alt="overlay"
                 className="w-full rounded-2xl object-contain border border-white/10" />
          ) : result.imagePreview ? (
            <img src={result.imagePreview} alt="original"
                 className="w-full rounded-2xl object-contain border border-white/10" />
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="bg-slate-800/50 border border-white/10 rounded-2xl p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-3">
              🤖 Résultat IA
            </p>
            <div className="flex items-center justify-between mb-4">
              <ClassBadge cls={iaClass} size="lg" />
              <span className="text-2xl font-black font-mono"
                    style={{ color: confColor(clf.confidence) }}>
                {(clf.confidence * 100).toFixed(1)}%
              </span>
            </div>
            <p className="text-xs text-slate-400 mb-3">
              Classe YOLO : <code className="text-cyan-300 text-[11px]">{clf.yolo_class}</code>
              &nbsp;·&nbsp;Mode : <span className="text-slate-300">{clf.mode}</span>
            </p>
            <div className="space-y-1.5">
              {clf.top3?.map((t, i) => (
                <ConfBar key={i} label={t.yolo_class} value={t.confidence}
                         color={SEG_COLORS[t.seg_class]?.color || '#64748b'} />
              ))}
            </div>
          </div>

          {imgs.mask_b64 && (
            <div>
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                🗺️ Masque
              </p>
              <img src={`data:image/png;base64,${imgs.mask_b64}`} alt="mask"
                   className="w-full rounded-2xl border border-white/10 object-contain max-h-40" />
              {seg.detected?.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {seg.detected.map(c => <ClassBadge key={c} cls={c} />)}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Diagnostic médecin */}
      {!saved ? (
        <div className="bg-slate-800/40 border border-white/10 rounded-3xl p-6 space-y-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            👨‍⚕️ Votre diagnostic
          </p>

          <div>
            <label className="block text-xs text-slate-400 mb-2">Diagnostic *</label>
            <div className="grid grid-cols-3 gap-2">
              {categoryOptions.map(cat => (
                <button key={cat.name}
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

          {docDiag && (
            <div className={`rounded-2xl px-5 py-4 border flex items-start gap-4 ${
              accord ? 'bg-green-500/10 border-green-500/30' : 'bg-orange-500/10 border-orange-500/30'
            }`}>
              {accord
                ? <CheckCircle2 size={22} className="text-green-400 flex-shrink-0 mt-0.5" />
                : <AlertTriangle size={22} className="text-orange-400 flex-shrink-0 mt-0.5" />
              }
              <div className="flex-1">
                {accord ? (
                  <>
                    <p className="font-bold text-green-300 text-sm">✅ Accord IA / Médecin</p>
                    <p className="text-green-600 text-xs mt-0.5">
                      Les deux diagnostics convergent vers <strong>{iaClass}</strong>.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-bold text-orange-300 text-sm">⚠️ Désaccord — 3ème avis requis</p>
                    <p className="text-orange-500 text-xs mt-0.5 mb-3">
                      IA : <strong>{iaClass}</strong> — Médecin : <strong>{docDiag}</strong>
                    </p>
                    <label className="block text-xs text-slate-400 mb-1.5">3ème avis *</label>
                    <textarea className={inputCls} rows={2}
                      placeholder="Ex: Confirmé par Dr. X comme PDR Stade I..."
                      value={tiers} onChange={e => setTiers(e.target.value)} />
                  </>
                )}
              </div>
            </div>
          )}

          {err && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
              {err}
            </div>
          )}

          <button onClick={handleSave} disabled={saving || !docDiag}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600
                       font-black text-sm uppercase transition hover:brightness-110
                       disabled:opacity-40 flex items-center justify-center gap-2">
            {saving
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Enregistrement...</>
              : '✅ Valider et enregistrer'
            }
          </button>
        </div>
      ) : (
        <div className="bg-green-500/10 border border-green-500/30 rounded-3xl p-8 text-center space-y-4">
          <CheckCircle2 size={48} className="text-green-400 mx-auto" />
          <h3 className="text-xl font-black text-green-300">Diagnostic enregistré !</h3>
          <p className="text-slate-400 text-sm">
            {dossierInfo.patient.prenom || ''} {dossierInfo.patient.nom || ''} —
            #{dossierInfo.numeroDossier}
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <ClassBadge cls={iaClass} />
            <span className="text-slate-500">IA</span>
            <ChevronRight size={16} className="text-slate-600" />
            <ClassBadge cls={docDiag} />
            <span className="text-slate-500">Médecin</span>
          </div>
          {accord
            ? <p className="text-green-600 text-sm">Les deux diagnostics concordent ✅</p>
            : <p className="text-orange-400 text-sm">Désaccord documenté avec 3ème avis ⚠️</p>
          }
          <div className="flex gap-3 justify-center pt-2">
            <button onClick={onFinish}
              className="px-8 py-3 rounded-2xl bg-cyan-600 hover:bg-cyan-500 font-bold text-sm transition">
              Nouveau diagnostic
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page principale — flow unifié
// ─────────────────────────────────────────────────────────────────────────────
export default function DiagnosticIA() {
  const [step, setStep]               = useState(1);
  const [dossierInfo, setDossierInfo] = useState(null);
  const [iaResult, setIaResult]       = useState(null);
  const [apiOk, setApiOk]             = useState(null);

  useEffect(() => {
    fetch('http://localhost:8000/health')
      .then(r => r.ok ? setApiOk(true) : setApiOk(false))
      .catch(() => setApiOk(false));
  }, []);

  const reset = () => { setStep(1); setDossierInfo(null); setIaResult(null); };

  const STEPS = ['Patient', 'Image otoscopique', 'Résultat & validation'];

  return (
    <div className="min-h-screen bg-[#0f172a] text-white font-sans">
      <GlobalMenu />

      <div className="max-w-4xl mx-auto px-4 pb-12">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Brain className="text-cyan-400" size={26} />
          <div>
            <h1 className="text-2xl font-black">Diagnostic par IA</h1>
            <p className="text-slate-500 text-sm">
              Classification + Segmentation · YOLO v8 + Ensemble 6 modèles
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs">
            <span className={`w-2 h-2 rounded-full ${
              apiOk === null ? 'bg-slate-500 animate-pulse'
              : apiOk ? 'bg-green-400' : 'bg-red-400'}`} />
            <span className="text-slate-400">
              {apiOk === null ? 'Vérification...' : apiOk ? 'API connectée' : 'API hors ligne'}
            </span>
            {apiOk === false && (
              <code className="text-cyan-400 text-[10px] ml-1">uvicorn main:app --reload</code>
            )}
          </div>
        </div>

        {/* Stepper */}
        <div className="flex items-center mb-8">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const done = step > n;
            const active = step === n;
            return (
              <React.Fragment key={n}>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center
                                   text-xs font-black border-2 transition-all ${
                    done   ? 'bg-cyan-500 border-cyan-500 text-white'
                    : active ? 'bg-transparent border-cyan-400 text-cyan-400'
                    : 'bg-transparent border-slate-700 text-slate-600'
                  }`}>
                    {done ? '✓' : n}
                  </div>
                  <span className={`text-xs font-semibold hidden sm:block ${
                    active ? 'text-cyan-300' : done ? 'text-slate-400' : 'text-slate-600'
                  }`}>{label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-3 transition-all ${
                    step > n ? 'bg-cyan-500' : 'bg-slate-700'}`} />
                )}
              </React.Fragment>
            );
          })}
        </div>

        {/* Contenu étape */}
        <div className="bg-slate-800/30 border border-white/5 rounded-3xl p-6 md:p-8">
          {step === 1 && (
            <StepPatient
              onValidated={info => { setDossierInfo(info); setStep(2); }}
            />
          )}
          {step === 2 && dossierInfo && (
            <StepUpload
              dossierInfo={dossierInfo}
              onResult={res => { setIaResult(res); setStep(3); }}
            />
          )}
          {step === 3 && iaResult && dossierInfo && (
            <StepResult result={iaResult} dossierInfo={dossierInfo} onFinish={reset} />
          )}
        </div>

        {/* Bouton retour */}
        {step > 1 && (
          <button
            onClick={() => setStep(s => s - 1)}
            className="mt-4 text-slate-500 text-xs hover:text-slate-300 transition flex items-center gap-1"
          >
            <ArrowLeft size={12} /> Retour
          </button>
        )}
      </div>
    </div>
  );
}