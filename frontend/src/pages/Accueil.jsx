import React, { useState, useEffect } from 'react';
import { Upload, Activity, Image as ImageIcon, CheckCircle2, AlertCircle, Edit2, X, SlidersHorizontal } from 'lucide-react';
import GlobalMenu from '../components/GlobalMenu';
import AnnotationCanvas from '../components/AnnotationCanvas';
import { supabase } from '../supabaseClient';
import UTIF from 'utif';
import { client } from "@gradio/client";

const categoryOptions = [
  { name: 'OMA',        fullName: 'Otite Moyenne Aiguë',                options: ['Congestive', 'Suppurée', 'Perforée'],        icon: '🔴', color: '#ef4444' },
  { name: 'OSM',        fullName: 'Otite Séromuqueuse',                 options: ['Aucun'],                                     icon: '🟡', color: '#eab308' },
  { name: 'Perfo',      fullName: 'Perforation',                        options: ['Marginale', 'Non Marginale'],                icon: '🔵', color: '#3b82f6' },
  { name: 'Chole',      fullName: 'Cholestéatome',                      options: ['Atticale', 'Post-Sup', 'Attic + Post-Sup'], icon: '🟣', color: '#a855f7' },
  { name: 'PDR + Atel', fullName: 'Poche de Rétraction + Atélectasie', options: ['Stade I', 'Stade II', 'Stade III'],          icon: '🟠', color: '#f97316' },
  { name: 'Normal',     fullName: 'Tympan Normal',                      options: ['Aucun'],                                     icon: '🟢', color: '#22c55e' },
  { name: 'Autre',      fullName: 'Autre Pathologie',                   options: ['Aucun'],                                     icon: '⚪', color: '#94a3b8' },
];

export default function Accueil() {
  const [fileQueue,                  setFileQueue]                  = useState([]);
  const [currentIndex,               setCurrentIndex]               = useState(null);
  const [selectedImage,              setSelectedImage]              = useState(null);
  const [selectedFile,               setSelectedFile]               = useState(null);
  const [isSaving,                   setIsSaving]                   = useState(false);
  const [isLoading,                  setIsLoading]                  = useState(false);
  const [isChecking,                 setIsChecking]                 = useState(false);
  const [isCurrentImageChecking,     setIsCurrentImageChecking]     = useState(false);
  const [saveMessage,                setSaveMessage]                = useState('');
  const [selections,                 setSelections]                 = useState({});
  const [currentUser,                setCurrentUser]                = useState(null);
  const [collaborator,               setCollaborator]               = useState(null);
  const [sessionMode,                setSessionMode]                = useState('solo');
  const [importStats,                setImportStats]                = useState(null);
  const [annotations,                setAnnotations]                = useState({});
  const [showAnnotationModal,        setShowAnnotationModal]        = useState(false);
  const [currentAnnotatingDisease,   setCurrentAnnotatingDisease]   = useState(null);
  const [annotationPreviewUrl,       setAnnotationPreviewUrl]       = useState('');
  const [autreDescription,           setAutreDescription]           = useState('');
  const [iaSuggestions,              setIaSuggestions]              = useState(null);
  const [isAnalysing,                setIsAnalysing]                = useState(false);

  // ── États filtres image ──────────────────────────────────
  const [filtres,       setFiltres]       = useState({ teinte: 0, temperature: 0, luminosite: 0 });
  const [filtresActifs, setFiltresActifs] = useState(false);

  useEffect(() => {
    const storedUser   = localStorage.getItem('user');
    const storedCollab = localStorage.getItem('collaborateur');
    const storedMode   = localStorage.getItem('mode_session');
    if (storedUser)   setCurrentUser(JSON.parse(storedUser));
    if (storedCollab) setCollaborator(JSON.parse(storedCollab));
    setSessionMode(storedMode || 'solo');
  }, []);

  // ── Filtres CSS ──────────────────────────────────────────
  const getCssFilter = () => {
    const { teinte, temperature, luminosite } = filtres;

    // Teinte : 0 → rouge (0°), 100 → jaune (60°)
    // Valeurs négatives : rouge → violet (-60°)
    const hueRotate  = (teinte / 100) * 60;        // ← 180 → 60
    const brightness = 1 + (luminosite / 100);
    const sepia      = temperature > 0 ? (temperature / 100) * 0.5 : 0;
    const hueTemp    = temperature < 0 ? (Math.abs(temperature) / 100) * 30 : 0;
    return `hue-rotate(${hueRotate}deg) brightness(${brightness}) sepia(${sepia}) hue-rotate(${-hueTemp}deg)`;
  };

  const resetFiltres = () => {
    setFiltres({ teinte: 0, temperature: 0, luminosite: 0 });
    setFiltresActifs(false);
  };

  const updateFiltre = (key, rawValue) => {
    const v = Math.max(-100, Math.min(100, Number(rawValue)));
    setFiltres(prev => ({ ...prev, [key]: isNaN(v) ? 0 : v }));
  };

  // ── Helpers ──────────────────────────────────────────────
  const resetAnnotationState = () => {
    setAnnotations({});
    setAnnotationPreviewUrl('');
    setCurrentAnnotatingDisease(null);
  };

  const handleClearQueue = () => {
    setFileQueue([]);
    setCurrentIndex(null);
    setSelectedImage(null);
    setSelectedFile(null);
    setSelections({});
    setSaveMessage('');
    setAutreDescription('');
    setImportStats(null);
    resetAnnotationState();
    resetFiltres();
  };

  const processFileToPreview = async (file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'tif' || ext === 'tiff') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const buffer = e.target.result;
            const ifds   = UTIF.decode(buffer);
            UTIF.decodeImage(buffer, ifds[0]);
            const rgba   = UTIF.toRGBA8(ifds[0]);
            const canvas = document.createElement('canvas');
            canvas.width  = ifds[0].width;
            canvas.height = ifds[0].height;
            const ctx     = canvas.getContext('2d');
            const imgData = ctx.createImageData(canvas.width, canvas.height);
            imgData.data.set(rgba);
            ctx.putImageData(imgData, 0, 0);
            resolve(canvas.toDataURL('image/png'));
          } catch (err) { reject(err); }
        };
        reader.readAsArrayBuffer(file);
      });
    }
    return URL.createObjectURL(file);
  };

  const calculateHash = async (file) => {
    const buffer     = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const checkHashesBatch = async (hashes) => {
    if (!hashes.length) return new Set();
    const BATCH  = 100;
    const found  = new Set();
    for (let i = 0; i < hashes.length; i += BATCH) {
      const lot = hashes.slice(i, i + BATCH);
      const { data, error } = await supabase
        .from('categories_diagnostics').select('image_hash').in('image_hash', lot);
      if (error) { console.error(`Erreur lot ${i}:`, error); continue; }
      (data || []).forEach(r => found.add(r.image_hash));
    }
    return found;
  };

  const checkCurrentImageExists = async (file) => {
    setIsCurrentImageChecking(true);
    try {
      const hash   = await calculateHash(file);
      const { data } = await supabase
        .from('categories_diagnostics')
        .select('image_hash, maladie_nom, nom_medecin_diagnostiqueur')
        .eq('image_hash', hash).limit(1);
      return { hash, exists: !!(data && data.length > 0), info: data?.[0] || null };
    } catch (e) {
      console.error('Erreur vérification:', e);
      return { hash: null, exists: false, info: null };
    } finally {
      setIsCurrentImageChecking(false);
    }
  };

  const handleFolderChange = async (e) => {
    const files   = Array.from(e.target.files);
    const allowed = ['jpg','jpeg','png','tif','tiff','webp','bmp'];
    const images  = files.filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return allowed.includes(ext) || f.type.startsWith('image/');
    });
    if (!images.length) return;

    setIsLoading(true);
    const queue = [];
    for (let i = 0; i < images.length; i++) {
      try {
        const preview = await processFileToPreview(images[i]);
        queue.push({ id: i, file: images[i], preview, status: 'pending', name: images[i].name, hash: null });
      } catch (err) { console.error('Erreur lecture:', images[i].name); }
    }
    setIsLoading(false);

    setFileQueue(queue);
    setCurrentIndex(0);
    setSelectedFile(queue[0].file);
    setSelectedImage(queue[0].preview);
    resetAnnotationState();
    resetFiltres();
    setSaveMessage('');
    setImportStats({ total: queue.length, existing: 0, pending: queue.length, progress: 0 });

    setIsChecking(true);
    try {
      const HASH_BATCH = 20;
      const withHash   = [...queue];
      for (let i = 0; i < withHash.length; i += HASH_BATCH) {
        const lot = withHash.slice(i, i + HASH_BATCH);
        await Promise.all(lot.map(async (item) => { item.hash = await calculateHash(item.file); }));
        setImportStats(prev => prev ? { ...prev, progress: Math.min(i + HASH_BATCH, withHash.length) } : null);
      }
      const allHashes  = withHash.map(item => item.hash).filter(Boolean);
      const existingSet = await checkHashesBatch(allHashes);
      let nbExisting = 0;
      const checkedQueue = withHash.map(item => {
        const exists = item.hash && existingSet.has(item.hash);
        if (exists) nbExisting++;
        return { ...item, status: exists ? 'uploaded' : 'pending' };
      });
      setFileQueue(checkedQueue);
      setImportStats({ total: checkedQueue.length, existing: nbExisting, pending: checkedQueue.length - nbExisting, progress: checkedQueue.length });
      const firstPending = checkedQueue.findIndex(item => item.status === 'pending');
      if (firstPending !== -1) {
        setCurrentIndex(firstPending);
        setSelectedFile(checkedQueue[firstPending].file);
        setSelectedImage(checkedQueue[firstPending].preview);
      } else {
        setSaveMessage('✅ Toutes les images ont déjà été traitées !');
      }
    } catch (err) {
      console.error('Erreur Supabase:', err);
    } finally {
      setIsChecking(false);
    }
  };

  const canCheckDisease = (diseaseName) => {
    const sel = Object.keys(selections);
    if (sel.length === 0) return true;
    if (sel.length === 1) return !!annotations[sel[0]];
    return false;
  };

  const canDrawContour = (diseaseName) => {
    const sel = Object.keys(selections);
    if (sel[0] === diseaseName) return true;
    if (sel[1] === diseaseName) return !!annotations[sel[0]];
    return false;
  };

  const handleDiseaseCheck = (diseaseName, checked) => {
    const newSels = { ...selections };
    if (checked) {
      if (!canCheckDisease(diseaseName)) {
        setSaveMessage("⚠️ Dessinez d'abord le contour de la première maladie");
        setTimeout(() => setSaveMessage(''), 3000);
        return;
      }
      newSels[diseaseName] = { stage: 'Aucun' };
    } else {
      delete newSels[diseaseName];
      if (diseaseName === 'Autre') setAutreDescription('');
      const newAnn = { ...annotations };
      delete newAnn[diseaseName];
      setAnnotations(newAnn);
      if (Object.keys(newAnn).length > 0) {
        buildMultiAnnotatedPreview(selectedImage, newAnn);
      } else {
        setAnnotationPreviewUrl('');
      }
    }
    setSelections(newSels);
  };

  const handleOpenAnnotation = (diseaseName) => {
    if (!canDrawContour(diseaseName)) {
      setSaveMessage("⚠️ Dessinez d'abord le contour de la première maladie");
      setTimeout(() => setSaveMessage(''), 3000);
      return;
    }
    setCurrentAnnotatingDisease(diseaseName);
    setShowAnnotationModal(true);
  };

  const buildMultiAnnotatedPreview = async (src, annotationsData) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width  = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx     = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        Object.keys(annotationsData).forEach(diseaseName => {
          const annotation = annotationsData[diseaseName];
          const points     = annotation.points_pixels || [];
          const disease    = categoryOptions.find(c => c.name === diseaseName);
          if (points.length >= 3 && disease) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.closePath();
            const hexToRgba = (hex, alpha) => {
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              return `rgba(${r},${g},${b},${alpha})`;
            };
            ctx.fillStyle   = hexToRgba(disease.color, 0.3);
            ctx.fill();
            ctx.strokeStyle = disease.color;
            ctx.lineWidth   = 4;
            ctx.stroke();
          }
        });
        const dataUrl = canvas.toDataURL('image/png');
        setAnnotationPreviewUrl(dataUrl);
        resolve(dataUrl);
      };
      img.src = src;
    });
  };

  const handleAnnotationSave = async (payload) => {
    const newAnnotations = { ...annotations, [currentAnnotatingDisease]: payload };
    setAnnotations(newAnnotations);
    await buildMultiAnnotatedPreview(selectedImage, newAnnotations);
    setShowAnnotationModal(false);
    setCurrentAnnotatingDisease(null);
  };

  const goToNext = (currentQueue, currentIdx) => {
    const nextPending = currentQueue.findIndex((item, i) => i > currentIdx && item.status === 'pending');
    if (nextPending !== -1) {
      setCurrentIndex(nextPending);
      setSelectedFile(currentQueue[nextPending].file);
      setSelectedImage(currentQueue[nextPending].preview);
      setSelections({});
      setAutreDescription('');
      resetAnnotationState();
      resetFiltres();
      setSaveMessage('');
    } else {
      setSaveMessage('✅ Toutes les images ont été traitées !');
      setTimeout(() => handleClearQueue(), 2500);
    }
  };

  const buildRenamedFileName = async (selectedDiseases, selectionsData, docId, fileExt) => {
    const diseaseParts = selectedDiseases.map(diseaseName => {
      const stage = selectionsData[diseaseName]?.stage || 'Aucun';
      if (diseaseName === 'Autre' && autreDescription.trim())
        return `Autre_${autreDescription.trim().replace(/\s+/g, '-')}`;
      if (stage === 'Aucun') return diseaseName;
      return `${diseaseName}_${stage.replace(/\s+/g, '-')}`;
    }).join('_');
    const maladieLabel = selectedDiseases.join(' + ');
    const { count, error } = await supabase
      .from('categories_diagnostics')
      .select('*', { count: 'exact', head: true })
      .eq('maladie_nom', maladieLabel);
    if (error) console.warn('Erreur comptage:', error.message);
    const compteur = (count || 0) + 1;
    const nom = `${compteur}_${diseaseParts}_${docId}.${fileExt}`;
    return nom.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_.\-+]/g, '_');
  };

  const handleUpload = async () => {
    const selectedDiseases = Object.keys(selections);
    if (!selectedFile || selectedDiseases.length === 0) {
      setSaveMessage("⚠️ Sélectionnez au moins une maladie"); return;
    }
    if (selectedDiseases.includes('Autre') && !autreDescription.trim()) {
      setSaveMessage("⚠️ Précisez la pathologie dans le champ « Autre »"); return;
    }
    for (const disease of selectedDiseases) {
      if (!annotations[disease]) {
        setSaveMessage(`⚠️ Dessinez le contour pour ${disease}`); return;
      }
    }

    setIsSaving(true);
    try {
      const currentItem = fileQueue[currentIndex];
      const imageHash   = currentItem.hash || await calculateHash(selectedFile);

      if (currentItem.status === 'uploaded') {
        setSaveMessage('⚠️ Image déjà enregistrée — passage à la suivante...');
        setTimeout(() => goToNext(fileQueue, currentIndex), 1500);
        setIsSaving(false);
        return;
      }

      const { data: existCheck } = await supabase
        .from('categories_diagnostics')
        .select('image_hash, maladie_nom, nom_medecin_diagnostiqueur')
        .eq('image_hash', imageHash).limit(1);
      if (existCheck && existCheck.length > 0) {
        const info         = existCheck[0];
        const updatedQueue = fileQueue.map((item, i) =>
          i === currentIndex ? { ...item, status: 'uploaded', hash: imageHash } : item);
        setFileQueue(updatedQueue);
        setImportStats(prev => prev ? { ...prev, existing: prev.existing + 1, pending: Math.max(0, prev.pending - 1) } : null);
        setSaveMessage(`⚠️ Image déjà enregistrée (par ${info.nom_medecin_diagnostiqueur || 'un médecin'} — ${info.maladie_nom || ''}) — passage à la suivante...`);
        setTimeout(() => goToNext(updatedQueue, currentIndex), 2000);
        setIsSaving(false);
        return;
      }

      const fileExt    = selectedFile.name.split('.').pop();
      const doctors    = sessionMode === 'collaboration' && collaborator
        ? [currentUser, collaborator] : [currentUser];
      let combinedAnnotBlob = null;
      if (annotationPreviewUrl) {
        combinedAnnotBlob = await (await fetch(annotationPreviewUrl)).blob();
      }

      const maladieLabel = selectedDiseases
        .map(d => d === 'Autre' && autreDescription.trim() ? `Autre (${autreDescription.trim()})` : d)
        .join(' + ');
      const stadeLabel = selectedDiseases
        .map(d => selections[d]?.stage || 'Aucun').join(' / ');

      for (const doc of doctors) {
        const nomRenomme  = await buildRenamedFileName(selectedDiseases, selections, doc.id, fileExt);
        const storagePath = `diagnostics/${nomRenomme}`;

        const { error: uploadErr } = await supabase.storage.from('images').upload(storagePath, selectedFile);
        if (uploadErr) throw uploadErr;

        const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath);

        const stadeInsert = selectedDiseases.includes('Autre') && autreDescription.trim()
          ? stadeLabel.replace('Aucun', autreDescription.trim())
          : stadeLabel;

        const { data: diagData, error: diagErr } = await supabase
          .from('categories_diagnostics')
          .insert([{
            image_hash:                 imageHash,
            image_url:                  publicUrl,
            utilisateur_id:             doc.id,
            nom_medecin_diagnostiqueur: `${doc.prenom} ${doc.nom}`,
            maladie_nom:                maladieLabel,
            stade_nom:                  stadeInsert,
            nom_image_originale:        selectedFile.name,
            nom_image_renommee:         nomRenomme,
            path_image_final:           storagePath,
          }])
          .select().single();

        if (diagErr) throw diagErr;

        if (doc.id === currentUser.id && combinedAnnotBlob) {
          const annotPath = `annotations/${imageHash}_${doc.id}_combined.png`;
          const { error: uploadAnnotErr } = await supabase.storage
            .from('images').upload(annotPath, combinedAnnotBlob);

          if (!uploadAnnotErr) {
            const { data: { publicUrl: annotPublicUrl } } = supabase.storage
              .from('images').getPublicUrl(annotPath);

            const contours = selectedDiseases
              .filter(d => annotations[d]?.points_normalized?.length >= 3)
              .map(d => {
                const disease = categoryOptions.find(c => c.name === d);
                return {
                  maladie:           d,
                  color:             disease?.color || '#22d3ee',
                  points_normalized: annotations[d].points_normalized,
                  points_pixels:     annotations[d].points_pixels,
                  bounding_box:      annotations[d].bounding_box,
                  created_at:        new Date().toISOString(),
                };
              });

            if (contours.length > 0) {
              await supabase.from('annotations_maladie').insert([{
                diagnostic_id:        diagData.id,
                image_hash:           imageHash,
                utilisateur_id:       doc.id,
                image_original_url:   publicUrl,
                annotated_image_path: annotPath,
                annotated_image_url:  annotPublicUrl,
                annotation_details:   { contours },
              }]);
            }
          }
        }
      }

      const updatedQueue = fileQueue.map((item, i) =>
        i === currentIndex ? { ...item, status: 'uploaded', hash: imageHash } : item);
      setFileQueue(updatedQueue);
      setImportStats(prev => prev
        ? { ...prev, existing: prev.existing + 1, pending: Math.max(0, prev.pending - 1) }
        : null);
      setSaveMessage('✅ Enregistré !');
      setTimeout(() => goToNext(updatedQueue, currentIndex), 1200);

    } catch (err) {
      setSaveMessage(`❌ Erreur: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const interrogerIA = async () => {
    if (!selectedFile) return;
    setIsAnalysing(true);
    try {
      const hf     = await client("pfelicence/tympan-classifier");
      const result = await hf.predict("/predict", [selectedFile]);
      const dataRaw = result.data[0];
      let scores = [];
      if (Array.isArray(dataRaw.confidences)) {
        scores = dataRaw.confidences.map(item => ({ label: item.label, score: item.confidence }));
      } else {
        scores = Object.entries(dataRaw).map(([key, value]) => ({ label: key, score: value }));
      }
      scores.sort((a, b) => b.score - a.score);
      setIaSuggestions(scores);
    } catch (err) {
      console.error('Erreur IA:', err);
      setSaveMessage("❌ Erreur de connexion à l'IA");
    } finally {
      setIsAnalysing(false);
    }
  };

  const selectedDiseases             = Object.keys(selections);
  const currentItemIsAlreadyUploaded = currentIndex !== null && fileQueue[currentIndex]?.status === 'uploaded';

  // ── Config sliders filtres ───────────────────────────────
 const FILTER_CONFIG = [
    {
      key  : 'teinte',
      label: 'Teinte',
      icon : '🎨',
      // Dégradé rouge → orange → jaune
      color: '#f97316',
      unit : '',
      // Labels personnalisés min/max
      minLabel: '🔴 Rouge',
      maxLabel: 'Jaune 🟡',
    },
    { key: 'temperature', label: 'Température', icon: '🌡️', color: '#f97316', unit: '', minLabel: '-100', maxLabel: '+100' },
    { key: 'luminosite',  label: 'Luminosité',  icon: '☀️', color: '#fbbf24', unit: '%', minLabel: '-100', maxLabel: '+100' },
  ];

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] text-white font-sans overflow-hidden">
      <GlobalMenu />

      <div className="flex flex-1 gap-4 p-4 pt-[80px] overflow-hidden min-h-0">

        {/* ══ GALERIE ══════════════════════════════════════════ */}
        <div className="w-44 flex-shrink-0 flex flex-col bg-slate-800/50 rounded-3xl border border-white/10 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-3 border-b border-white/10 flex-shrink-0">
            <ImageIcon size={14} className="text-cyan-400 flex-shrink-0" />
            <h2 className="text-[10px] font-bold uppercase tracking-widest truncate flex-1">
              Galerie ({fileQueue.length})
            </h2>
            {fileQueue.length > 0 && (
              <button onClick={handleClearQueue} disabled={isSaving} title="Vider"
                className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full bg-slate-600 hover:bg-red-500 transition-colors disabled:opacity-40">
                <X size={11} className="text-white" />
              </button>
            )}
          </div>

          {importStats && (
            <div className="px-3 py-2 border-b border-white/10 flex-shrink-0 space-y-1">
              {isChecking ? (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Activity size={11} className="animate-spin text-cyan-400" />
                    <span className="text-[9px] text-cyan-400">Vérification...</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[9px] text-slate-500">Hash</span>
                    <span className="text-[9px] text-slate-400">{importStats.progress || 0}/{importStats.total}</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-1">
                    <div className="bg-cyan-400 h-1 rounded-full transition-all duration-300"
                      style={{ width: `${((importStats.progress || 0) / importStats.total) * 100}%` }} />
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span className="text-[9px] text-slate-400">Total</span>
                    <span className="text-[9px] font-bold text-white">{importStats.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[9px] text-green-400 flex items-center gap-1">
                      <CheckCircle2 size={9} /> Déjà faites
                    </span>
                    <span className="text-[9px] font-bold text-green-400">{importStats.existing}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[9px] text-cyan-400">À traiter</span>
                    <span className="text-[9px] font-bold text-cyan-400">{importStats.pending}</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-1 mt-1">
                    <div className="bg-green-400 h-1 rounded-full transition-all"
                      style={{ width: `${importStats.total > 0 ? (importStats.existing / importStats.total) * 100 : 0}%` }} />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2 space-y-2 custom-scrollbar min-h-0">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Activity className="animate-spin text-cyan-400" size={24} />
                <span className="text-[9px] text-slate-400">Chargement...</span>
              </div>
            ) : fileQueue.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2 text-slate-600">
                <ImageIcon size={28} />
                <p className="text-[9px] uppercase font-bold text-center">Aucune image</p>
              </div>
            ) : fileQueue.map((item, idx) => (
              <div key={idx}
                onClick={async () => {
                  if (!isSaving) {
                    setCurrentIndex(idx);
                    setSelectedFile(item.file);
                    setSelectedImage(item.preview);
                    resetAnnotationState();
                    resetFiltres();
                    setSelections({});
                    setAutreDescription('');
                    setSaveMessage('');
                    if (item.status !== 'uploaded') {
                      const { exists, hash, info } = await checkCurrentImageExists(item.file);
                      if (exists) {
                        setFileQueue(prev => prev.map((q, i) =>
                          i === idx ? { ...q, status: 'uploaded', hash } : q));
                        setSaveMessage(`⚠️ Déjà enregistrée (${info?.nom_medecin_diagnostiqueur || 'un médecin'} — ${info?.maladie_nom || ''})`);
                      } else if (hash) {
                        setFileQueue(prev => prev.map((q, i) =>
                          i === idx ? { ...q, hash } : q));
                      }
                    }
                  }
                }}
                className={`relative cursor-pointer rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all ${
                  currentIndex === idx
                    ? 'border-cyan-400 opacity-100'
                    : 'border-transparent opacity-50 hover:opacity-70'
                }`}
              >
                <img src={item.preview} alt="mini" className="w-full h-20 object-cover" />
                {item.status === 'uploaded' && (
                  <div className="absolute inset-0 bg-green-500/60 flex flex-col items-center justify-center gap-1">
                    <CheckCircle2 size={20} className="text-white drop-shadow" />
                    <span className="text-[7px] text-white font-bold uppercase">Enregistrée</span>
                  </div>
                )}
                {item.status === 'duplicate' && (
                  <div className="absolute inset-0 bg-orange-500/70 flex flex-col items-center justify-center gap-1">
                    <AlertCircle size={16} className="text-white" />
                    <span className="text-[7px] text-white font-bold uppercase">Doublon</span>
                  </div>
                )}
                {isChecking && item.status === 'pending' && (
                  <div className="absolute bottom-1 right-1">
                    <Activity size={10} className="animate-spin text-cyan-300" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ══ PANNEAU CENTRAL ══════════════════════════════════ */}
        <div className="flex-1 flex gap-4 min-h-0 overflow-hidden">

          {/* ── DIAGNOSTIC ───────────────────────────────────── */}
          <div className="w-[340px] flex-shrink-0 flex flex-col bg-slate-800/30 rounded-3xl border border-white/10 overflow-hidden">
            <div className="px-5 pt-5 pb-2 flex-shrink-0">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Diagnostic Médical
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-3 custom-scrollbar min-h-0">

              {/* IA */}
              <div className="p-4 bg-cyan-500/10 border border-cyan-500/30 rounded-2xl">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="text-[10px] font-bold text-cyan-400 uppercase">Assistance IA</h4>
                  <button onClick={interrogerIA} disabled={isAnalysing || !selectedFile}
                    className="text-[9px] bg-cyan-600 hover:bg-cyan-500 px-3 py-1 rounded-full transition-colors disabled:opacity-50">
                    {isAnalysing ? 'Analyse...' : "Lancer l'IA"}
                  </button>
                </div>
                {iaSuggestions ? (
                  <div className="space-y-2">
                    {iaSuggestions.slice(0, 3).map((s, i) => (
                      <div key={i}>
                        <div className="flex justify-between text-[10px] mb-1">
                          <span>{s.label}</span>
                          <span className="font-mono">{(s.score * 100).toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-slate-700 h-1 rounded-full">
                          <div className="bg-cyan-400 h-1 rounded-full transition-all duration-1000"
                            style={{ width: `${s.score * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[9px] text-slate-500 italic text-center">
                    Cliquez pour une suggestion
                  </p>
                )}
              </div>

              {/* Déjà uploadée */}
              {currentItemIsAlreadyUploaded && (
                <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-2xl flex items-center gap-3">
                  <CheckCircle2 size={20} className="text-green-400 flex-shrink-0" />
                  <div>
                    <p className="text-[11px] text-green-400 font-bold">Image déjà enregistrée</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">Sélectionnez une autre image.</p>
                  </div>
                </div>
              )}

              {/* Légende contours */}
              {selectedDiseases.length > 0 && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <p className="text-[9px] text-blue-400 font-bold uppercase mb-2">Légende</p>
                  <div className="space-y-1">
                    {selectedDiseases.map(d => {
                      const disease = categoryOptions.find(c => c.name === d);
                      return (
                        <div key={d} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded border-2 flex-shrink-0"
                            style={{ backgroundColor: disease?.color, borderColor: disease?.color }} />
                          <span className="text-[10px] text-white font-bold">
                            {d === 'Autre' && autreDescription.trim() ? `Autre — ${autreDescription.trim()}` : d}
                          </span>
                          {annotations[d] && <span className="text-[8px] text-green-400 ml-auto">✓</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Catégories */}
              {categoryOptions.map((cat, idx) => {
                const isSelected    = !!selections[cat.name];
                const hasAnnotation = !!annotations[cat.name];
                const canCheck      = canCheckDisease(cat.name);
                const canDraw       = canDrawContour(cat.name);
                const isAutre       = cat.name === 'Autre';
                return (
                  <div key={idx}
                    className={`p-4 border rounded-2xl transition-all ${
                      currentItemIsAlreadyUploaded
                        ? 'border-white/5 bg-white/5 opacity-30 pointer-events-none'
                        : isSelected
                          ? 'border-cyan-400 bg-cyan-400/5'
                          : !canCheck && selectedDiseases.length > 0
                            ? 'border-white/5 bg-white/5 opacity-40'
                            : 'border-white/5 bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center border-2"
                        style={{ borderColor: cat.color }}>
                        <span className="text-lg">{cat.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate">{cat.name}</div>
                        <div className="text-[9px] text-slate-400 uppercase truncate">{cat.fullName}</div>
                      </div>
                      <input type="checkbox" className="w-5 h-5 accent-cyan-400 flex-shrink-0"
                        checked={isSelected}
                        disabled={currentItemIsAlreadyUploaded || (!isSelected && !canCheck)}
                        onChange={e => handleDiseaseCheck(cat.name, e.target.checked)}
                      />
                    </div>

                    {isSelected && (
                      <>
                        {isAutre && (
                          <div className="mt-3">
                            <label className="text-[9px] text-slate-400 uppercase font-bold block mb-1">
                              Préciser la pathologie *
                            </label>
                            <input type="text" value={autreDescription}
                              onChange={e => setAutreDescription(e.target.value)}
                              placeholder="Ex: Otomycose, Corps étranger..." maxLength={100}
                              className={`w-full bg-slate-900 text-[11px] text-white placeholder-slate-500 px-3 py-2 rounded-lg border transition-colors outline-none ${
                                autreDescription.trim()
                                  ? 'border-cyan-500/60 focus:border-cyan-400'
                                  : 'border-red-500/40 focus:border-red-400'
                              }`}
                            />
                            {!autreDescription.trim()
                              ? <p className="text-[8px] text-red-400 mt-1">⚠️ Champ obligatoire</p>
                              : <p className="text-[8px] text-green-400 mt-1">✓ "{autreDescription.trim()}"</p>
                            }
                          </div>
                        )}
                        {cat.options[0] !== 'Aucun' && (
                          <select
                            className="mt-3 bg-slate-900 text-[10px] p-2 rounded-lg border border-cyan-500/30 w-full text-cyan-100"
                            value={selections[cat.name].stage}
                            onChange={e => setSelections({ ...selections, [cat.name]: { stage: e.target.value } })}
                          >
                            <option value="Aucun">Sélectionner un stade...</option>
                            {cat.options.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        )}
                        <button onClick={() => handleOpenAnnotation(cat.name)}
                          disabled={!canDraw || (isAutre && !autreDescription.trim())}
                          className={`mt-2 w-full py-2 rounded-lg text-[10px] font-bold uppercase flex items-center justify-center gap-2 transition-all ${
                            !canDraw || (isAutre && !autreDescription.trim())
                              ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                              : hasAnnotation
                                ? 'bg-green-600 hover:bg-green-500 text-white'
                                : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                          }`}
                        >
                          <Edit2 size={11} />
                          {hasAnnotation ? 'Modifier le contour' : 'Dessiner le contour'}
                        </button>
                        {isAutre && !autreDescription.trim() && (
                          <p className="text-[8px] text-slate-500 text-center mt-1">
                            Précisez d'abord la pathologie
                          </p>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── FILTRES IMAGE ─────────────────────────────────── */}
          <div className={`w-[200px] flex-shrink-0 flex flex-col bg-slate-800/30 rounded-3xl border border-white/10 overflow-hidden transition-opacity ${
            selectedImage ? 'opacity-100' : 'opacity-30 pointer-events-none'
          }`}>
            {/* Header */}
            <div className="px-4 pt-4 pb-3 flex-shrink-0 border-b border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <SlidersHorizontal size={13} className="text-slate-400" />
                <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest flex-1">
                  Filtres
                </h3>
                <span className="text-[7px] text-slate-600 bg-slate-700/50 px-1.5 py-0.5 rounded-full">
                  Optionnel
                </span>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => setFiltresActifs(v => !v)}
                  className={`flex-1 py-1.5 rounded-lg text-[9px] font-bold uppercase transition-all ${
                    filtresActifs
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40'
                      : 'bg-slate-700 text-slate-400 border border-white/5'
                  }`}>
                  {filtresActifs ? '✓ Actifs' : 'Activer'}
                </button>
                <button onClick={resetFiltres} title="Réinitialiser"
                  className="px-2.5 py-1.5 rounded-lg text-[11px] text-slate-400 hover:text-white bg-slate-700/50 border border-white/5 transition-colors">
                  ↺
                </button>
              </div>
            </div>

            {/* Sliders */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 custom-scrollbar">
              {FILTER_CONFIG.map(({ key, label, icon, color, unit }) => (
                <div key={key} className={`transition-opacity duration-200 ${
                  !filtresActifs ? 'opacity-35 pointer-events-none' : ''
                }`}>
                  {/* Label + saisie */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-slate-300 flex items-center gap-1">
                      <span>{icon}</span>
                      <span>{label}</span>
                    </span>
                    <div className="flex items-center gap-0.5">
                      <input
                        type="number"
                        min="-100"
                        max="100"
                        value={filtres[key]}
                        onChange={e => updateFiltre(key, e.target.value)}
                        className="w-12 bg-slate-900 text-[10px] text-center text-white rounded-md px-1 py-1 border border-white/10 outline-none focus:border-cyan-500/50"
                        style={{
                          MozAppearance: 'textfield',
                          WebkitAppearance: 'none',
                        }}
                      />
                      {unit && (
                        <span className="text-[9px] text-slate-500 ml-0.5">{unit}</span>
                      )}
                    </div>
                  </div>

                  {/* Curseur */}
                  <div className="relative">
                    <div className="absolute top-1/2 left-1/2 -translate-y-1/2 w-px h-3 bg-white/20 pointer-events-none z-10" />
                    <input
                      type="range"
                      min="-100"
                      max="100"
                      step="1"
                      value={filtres[key]}
                      onChange={e => updateFiltre(key, e.target.value)}
                      className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: key === 'teinte'
                          // Dégradé visuel rouge → orange → jaune
                          ? `linear-gradient(to right,
                              #dc2626 0%,
                              #ea580c 25%,
                              #f97316 50%,
                              #eab308 75%,
                              #facc15 100%)`
                          : filtres[key] >= 0
                            ? `linear-gradient(to right, #334155 0%, #334155 50%, ${color} 50%, ${color} ${(filtres[key] + 100) / 2}%, #334155 ${(filtres[key] + 100) / 2}%, #334155 100%)`
                            : `linear-gradient(to right, #334155 0%, #334155 ${(filtres[key] + 100) / 2}%, ${color} ${(filtres[key] + 100) / 2}%, ${color} 50%, #334155 50%, #334155 100%)`,
                      }}
                    />
                  </div>

                 <div className="flex justify-between mt-1">
                    <span className="text-[7px] text-slate-600">
                      {key === 'teinte' ? '🔴 Rouge' : '-100'}
                    </span>
                    <span className="text-[7px] text-slate-600">0</span>
                    <span className="text-[7px] text-slate-600">
                      {key === 'teinte' ? '🟡 Jaune' : '+100'}
                    </span>
                  </div>

                  {/* Badge valeur active */}
                  {filtres[key] !== 0 && (
                    <div className="flex justify-center mt-1">
                      <span className="text-[8px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: `${color}25`, color }}>
                        {filtres[key] > 0 ? '+' : ''}{filtres[key]}{unit}
                      </span>
                    </div>
                  )}
                </div>
              ))}

              {/* Note */}
              <div className="pt-2 border-t border-white/5">
                <p className="text-[7px] text-slate-600 italic leading-relaxed text-center">
                  Filtres visuels uniquement.<br />
                  L'image originale est conservée.
                </p>
              </div>
            </div>
          </div>

          {/* ── ZONE IMAGE + BOUTON ───────────────────────────── */}
          <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-hidden">
            <div className="flex-1 min-h-0 bg-slate-950 border-2 border-dashed border-white/10 rounded-[2rem] flex items-center justify-center relative overflow-hidden">
              {!selectedImage ? (
                <label className="cursor-pointer text-center p-8 hover:scale-105 transition-transform">
                  <Upload className="text-cyan-400 mx-auto mb-4" size={44} />
                  <p className="font-black uppercase text-xs text-slate-400">
                    Importer un dossier médical
                  </p>
                  <p className="text-[9px] text-slate-600 mt-1">JPG · PNG · TIFF · WEBP</p>
                  <input type="file" className="hidden" webkitdirectory="true" directory="true"
                    multiple onChange={handleFolderChange} />
                </label>
              ) : (
                <>
                  {/* Image avec filtres CSS appliqués */}
                  <img
                    src={annotationPreviewUrl || selectedImage}
                    className="w-full h-full object-contain transition-all duration-300"
                    alt="Current"
                    style={{ filter: filtresActifs ? getCssFilter() : 'none' }}
                  />

                  {/* Indicateur filtres actifs */}
                  {filtresActifs && (filtres.teinte !== 0 || filtres.temperature !== 0 || filtres.luminosite !== 0) && (
                    <div className="absolute top-3 right-3 flex gap-1">
                      {FILTER_CONFIG.map(({ key, label, color, unit }) =>
                        filtres[key] !== 0 ? (
                          <span key={key}
                            className="text-[8px] font-bold px-2 py-0.5 rounded-full backdrop-blur-sm"
                            style={{ backgroundColor: `${color}30`, color, border: `1px solid ${color}50` }}>
                            {label} {filtres[key] > 0 ? '+' : ''}{filtres[key]}{unit}
                          </span>
                        ) : null
                      )}
                    </div>
                  )}

                  {isCurrentImageChecking && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <div className="bg-slate-800/90 backdrop-blur-sm rounded-2xl px-6 py-4 flex flex-col items-center gap-3 border border-cyan-500/30">
                        <Activity size={32} className="animate-spin text-cyan-400" />
                        <p className="text-cyan-400 font-bold text-xs uppercase">Vérification...</p>
                      </div>
                    </div>
                  )}

                  {!isCurrentImageChecking && currentItemIsAlreadyUploaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <div className="bg-green-500/90 backdrop-blur-sm rounded-2xl px-6 py-4 flex flex-col items-center gap-2 border border-green-400/50">
                        <CheckCircle2 size={36} className="text-white" />
                        <p className="text-white font-black text-sm uppercase">Déjà enregistrée</p>
                        <p className="text-green-100 text-[10px]">Cette image a déjà été diagnostiquée</p>
                      </div>
                    </div>
                  )}

                  {fileQueue.length > 0 && currentIndex !== null && (
                    <div className="absolute bottom-4 right-4 bg-black/70 backdrop-blur-sm rounded-lg px-3 py-1.5 border border-white/10">
                      <span className="text-[10px] text-slate-300 font-bold">
                        {currentIndex + 1} / {fileQueue.length}
                      </span>
                    </div>
                  )}

                  {annotationPreviewUrl && !currentItemIsAlreadyUploaded && (
                    <div className="absolute top-4 left-4 bg-black/80 backdrop-blur-sm rounded-xl p-3 border border-cyan-500/30">
                      <p className="text-[9px] text-cyan-400 font-bold uppercase mb-1">Contours</p>
                      <div className="space-y-1">
                        {selectedDiseases.map(d => {
                          const disease    = categoryOptions.find(c => c.name === d);
                          const hasContour = annotations[d];
                          return (
                            <div key={d} className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded flex-shrink-0"
                                style={{ backgroundColor: disease?.color }} />
                              <span className="text-[9px] text-white">
                                {d === 'Autre' && autreDescription.trim()
                                  ? `Autre — ${autreDescription.trim()}` : d}
                              </span>
                              {hasContour && <span className="text-[8px] text-green-400">✓</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Bouton valider */}
            <div className="flex-shrink-0 flex flex-col gap-2">
              <button onClick={handleUpload}
                disabled={
                  isSaving || isChecking || isCurrentImageChecking || !selectedFile ||
                  currentItemIsAlreadyUploaded || selectedDiseases.length === 0 ||
                  !selectedDiseases.every(d => annotations[d]) ||
                  (selectedDiseases.includes('Autre') && !autreDescription.trim())
                }
                className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-tighter transition-all ${
                  isSaving || isChecking || isCurrentImageChecking || !selectedFile ||
                  currentItemIsAlreadyUploaded || selectedDiseases.length === 0 ||
                  !selectedDiseases.every(d => annotations[d]) ||
                  (selectedDiseases.includes('Autre') && !autreDescription.trim())
                    ? 'bg-slate-800 opacity-50 cursor-not-allowed'
                    : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:brightness-110 shadow-lg shadow-cyan-900/20'
                }`}
              >
                {isSaving
                  ? <Activity className="animate-spin mx-auto" />
                  : isChecking
                    ? <span className="flex items-center justify-center gap-2">
                        <Activity size={14} className="animate-spin" /> Vérification...
                      </span>
                    : currentItemIsAlreadyUploaded
                      ? '✓ Image déjà enregistrée'
                      : `Valider ${selectedDiseases.length} maladie(s)`
                }
              </button>

              {saveMessage && (
                <div className={`py-2 px-4 rounded-xl text-center text-[10px] font-bold uppercase flex items-center justify-center gap-2 ${
                  saveMessage.includes('✅') ? 'bg-green-500/10 text-green-400'
                  : saveMessage.includes('⚠️') ? 'bg-orange-500/10 text-orange-400'
                  : 'bg-red-500/10 text-red-400'
                }`}>
                  {saveMessage.includes('❌') && <AlertCircle size={13} />}
                  {saveMessage}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Modal annotation */}
      {showAnnotationModal && currentAnnotatingDisease && (
        <AnnotationCanvas
          imageSrc={selectedImage}
          initialPoints={annotations[currentAnnotatingDisease]?.points_normalized || []}
          annotationColor={categoryOptions.find(c => c.name === currentAnnotatingDisease)?.color}
          diseaseName={currentAnnotatingDisease}
          onClose={() => { setShowAnnotationModal(false); setCurrentAnnotatingDisease(null); }}
          onSave={handleAnnotationSave}
        />
      )}
    </div>
  );
}