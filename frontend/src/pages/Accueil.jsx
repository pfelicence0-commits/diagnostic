import React, { useState, useEffect } from 'react';
import { Upload, Activity, Image as ImageIcon, CheckCircle2, AlertCircle, Edit2, X } from 'lucide-react';
import GlobalMenu from '../components/GlobalMenu';
import AnnotationCanvas from '../components/AnnotationCanvas';
import { supabase } from '../supabaseClient'; 
import UTIF from 'utif';

const categoryOptions = [
  { name: 'OMA', fullName: 'Otite Moyenne Aiguë', options: ['Congestive', 'Suppurée', 'Perforée'], icon: '🔴', color: '#ef4444' },
  { name: 'OSM', fullName: 'Otite Séromuqueuse', options: ['Aucun'], icon: '🟡', color: '#eab308' },
  { name: 'Perfo', fullName: 'Perforation', options: ['Marginale', 'Non Marginale'], icon: '🔵', color: '#3b82f6' },
  { name: 'Chole', fullName: 'Cholestéatome', options: ['Atticale', 'Post-Sup', 'Attic + Post-Sup'], icon: '🟣', color: '#a855f7' },
  { name: 'PDR + Atel', fullName: 'Poche de Rétraction + Atélectasie', options: ['Stade I', 'Stade II', 'Stade III'], icon: '🟠', color: '#f97316' },
  { name: 'Normal', fullName: 'Tympan Normal', options: ['Aucun'], icon: '🟢', color: '#22c55e' },
  { name: 'Autre', fullName: 'Autre Pathologie', options: ['Aucun'], icon: '⚪', color: '#94a3b8' }
];

export default function Accueil() {
  const [fileQueue, setFileQueue] = useState([]); 
  const [currentIndex, setCurrentIndex] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isChecking, setIsChecking] = useState(false); // vérification Supabase en cours
  const [saveMessage, setSaveMessage] = useState('');
  const [selections, setSelections] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [collaborator, setCollaborator] = useState(null);
  const [sessionMode, setSessionMode] = useState('solo');
  const [importStats, setImportStats] = useState(null); // stats après import
  
  const [annotations, setAnnotations] = useState({});
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [currentAnnotatingDisease, setCurrentAnnotatingDisease] = useState(null);
  const [annotationPreviewUrl, setAnnotationPreviewUrl] = useState('');
  const [autreDescription, setAutreDescription] = useState('');

  useEffect(() => {
    const initSession = async () => {
      const storedUser = localStorage.getItem('user');
      const storedCollab = localStorage.getItem('collaborateur');
      const storedMode = localStorage.getItem('mode_session');
      if (storedUser) setCurrentUser(JSON.parse(storedUser));
      if (storedCollab) setCollaborator(JSON.parse(storedCollab));
      setSessionMode(storedMode || 'solo');
    };
    initSession();
  }, []);

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
  };

  const processFileToPreview = async (file) => {
    const extension = file.name.split('.').pop().toLowerCase();
    if (extension === 'tif' || extension === 'tiff') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const buffer = e.target.result;
            const ifds = UTIF.decode(buffer);
            UTIF.decodeImage(buffer, ifds[0]);
            const rgba = UTIF.toRGBA8(ifds[0]);
            const canvas = document.createElement('canvas');
            canvas.width = ifds[0].width;
            canvas.height = ifds[0].height;
            const ctx = canvas.getContext('2d');
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

  // ── Calcul SHA-256 d'un fichier ──────────────────────────
  const calculateHash = async (file) => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  };

  // ── Vérification en masse : tous les hash d'un coup ──────
  // Récupère tous les hash existants pour ce médecin en 1 requête
  const checkHashesBatch = async (hashes, userId) => {
    if (!hashes.length) return new Set();
    const { data } = await supabase
      .from('categories_diagnostics')
      .select('image_hash')
      .eq('utilisateur_id', userId)
      .in('image_hash', hashes);
    return new Set((data || []).map(r => r.image_hash));
  };

  // ════════════════════════════════════════════════════════
  // Import du dossier avec vérification immédiate dans Supabase
  // ════════════════════════════════════════════════════════
  const handleFolderChange = async (e) => {
    const files = Array.from(e.target.files);
    const allowedExtensions = ['jpg', 'jpeg', 'png', 'tif', 'tiff', 'webp', 'bmp'];
    const imageFiles = files.filter(file => {
      const ext = file.name.split('.').pop().toLowerCase();
      return allowedExtensions.includes(ext) || file.type.startsWith('image/');
    });

    if (imageFiles.length === 0) return;

    // ── Étape 1 : générer les previews ──────────────────────
    setIsLoading(true);
    const queue = [];
    for (let i = 0; i < imageFiles.length; i++) {
      try {
        const preview = await processFileToPreview(imageFiles[i]);
        queue.push({
          id:      i,
          file:    imageFiles[i],
          preview,
          status:  'pending',
          name:    imageFiles[i].name,
          hash:    null,    // sera rempli à l'étape 2
        });
      } catch (err) {
        console.error("Erreur lecture:", imageFiles[i].name);
      }
    }
    setIsLoading(false);

    // Afficher la galerie immédiatement (sans attendre la vérif)
    setFileQueue(queue);
    setCurrentIndex(0);
    setSelectedFile(queue[0].file);
    setSelectedImage(queue[0].preview);
    resetAnnotationState();

    // ── Étape 2 : calculer les hash + vérifier dans Supabase ──
    setIsChecking(true);
    try {
      // Calculer tous les hash en parallèle (par lots de 10)
      const BATCH = 10;
      const withHash = [...queue];

      for (let i = 0; i < withHash.length; i += BATCH) {
        const lot = withHash.slice(i, i + BATCH);
        await Promise.all(lot.map(async (item) => {
          item.hash = await calculateHash(item.file);
        }));
      }

      // 1 seule requête Supabase pour tous les hash
      const allHashes   = withHash.map(item => item.hash);
      const existingSet = await checkHashesBatch(allHashes, currentUser?.id);

      // Marquer les images déjà présentes
      let nbExisting = 0;
      const checkedQueue = withHash.map(item => {
        const exists = existingSet.has(item.hash);
        if (exists) nbExisting++;
        return {
          ...item,
          status: exists ? 'uploaded' : 'pending',
        };
      });

      setFileQueue(checkedQueue);
      setImportStats({
        total:    checkedQueue.length,
        existing: nbExisting,
        pending:  checkedQueue.length - nbExisting,
      });

      // Sélectionner automatiquement la 1ère image NON encore traitée
      const firstPending = checkedQueue.findIndex(item => item.status === 'pending');
      if (firstPending !== -1) {
        setCurrentIndex(firstPending);
        setSelectedFile(checkedQueue[firstPending].file);
        setSelectedImage(checkedQueue[firstPending].preview);
      }

    } catch (err) {
      console.error("Erreur vérification Supabase:", err);
    } finally {
      setIsChecking(false);
    }
  };

  const canCheckDisease = (diseaseName) => {
    const selectedDiseases = Object.keys(selections);
    if (selectedDiseases.length === 0) return true;
    if (selectedDiseases.length === 1) return !!annotations[selectedDiseases[0]];
    return false;
  };

  const canDrawContour = (diseaseName) => {
    const selectedDiseases = Object.keys(selections);
    if (selectedDiseases[0] === diseaseName) return true;
    if (selectedDiseases[1] === diseaseName) return !!annotations[selectedDiseases[0]];
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
      const newAnnotations = { ...annotations };
      delete newAnnotations[diseaseName];
      setAnnotations(newAnnotations);
      if (Object.keys(newAnnotations).length > 0) {
        buildMultiAnnotatedPreview(selectedImage, newAnnotations);
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
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        Object.keys(annotationsData).forEach(diseaseName => {
          const annotation = annotationsData[diseaseName];
          const points = annotation.points_pixels || [];
          const disease = categoryOptions.find(c => c.name === diseaseName);
          if (points.length >= 3 && disease) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            points.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.closePath();
            const hexToRgba = (hex, alpha) => {
              const r = parseInt(hex.slice(1, 3), 16);
              const g = parseInt(hex.slice(3, 5), 16);
              const b = parseInt(hex.slice(5, 7), 16);
              return `rgba(${r}, ${g}, ${b}, ${alpha})`;
            };
            ctx.fillStyle = hexToRgba(disease.color, 0.3);
            ctx.fill();
            ctx.strokeStyle = disease.color;
            ctx.lineWidth = 4;
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
    // Chercher la prochaine image non encore traitée
    const nextPending = currentQueue.findIndex(
      (item, i) => i > currentIdx && item.status === 'pending'
    );
    if (nextPending !== -1) {
      setCurrentIndex(nextPending);
      setSelectedFile(currentQueue[nextPending].file);
      setSelectedImage(currentQueue[nextPending].preview);
      setSelections({});
      setAutreDescription('');
      resetAnnotationState();
      setSaveMessage('');
    } else {
      // Plus d'images en attente
      setSaveMessage('✅ Toutes les images ont été traitées !');
      setTimeout(() => handleClearQueue(), 2500);
    }
  };

  const buildRenamedFileName = async (selectedDiseases, selectionsData, docId, fileExt) => {
    const diseaseParts = selectedDiseases.map(diseaseName => {
      const stage = selectionsData[diseaseName]?.stage || 'Aucun';
      if (diseaseName === 'Autre' && autreDescription.trim()) {
        return `Autre_${autreDescription.trim().replace(/\s+/g, '-')}`;
      }
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
      setSaveMessage("⚠️ Sélectionnez au moins une maladie");
      return;
    }
    if (selectedDiseases.includes('Autre') && !autreDescription.trim()) {
      setSaveMessage("⚠️ Précisez la pathologie dans le champ « Autre »");
      return;
    }
    for (const disease of selectedDiseases) {
      if (!annotations[disease]) {
        setSaveMessage(`⚠️ Dessinez le contour pour ${disease}`);
        return;
      }
    }

    setIsSaving(true);
    try {
      const currentItem = fileQueue[currentIndex];
      const imageHash   = currentItem.hash || await calculateHash(selectedFile);

      // Vérif doublon (au cas où le hash n'était pas encore calculé)
      if (currentItem.status === 'uploaded') {
        setSaveMessage(`⚠️ Image déjà enregistrée — passage à la suivante...`);
        setTimeout(() => goToNext(fileQueue, currentIndex), 1500);
        setIsSaving(false);
        return;
      }

      const fileExt = selectedFile.name.split('.').pop();
      const doctors = sessionMode === 'collaboration' && collaborator
        ? [currentUser, collaborator]
        : [currentUser];

      let combinedAnnotBlob = null;
      if (annotationPreviewUrl) {
        combinedAnnotBlob = await (await fetch(annotationPreviewUrl)).blob();
      }

      const maladieLabel = selectedDiseases.map(d =>
        d === 'Autre' && autreDescription.trim()
          ? `Autre (${autreDescription.trim()})`
          : d
      ).join(' + ');
      const stadeLabel = selectedDiseases.map(d => selections[d]?.stage || 'Aucun').join(' / ');

      for (const doc of doctors) {
        const nomRenomme  = await buildRenamedFileName(selectedDiseases, selections, doc.id, fileExt);
        const storagePath = `diagnostics/${nomRenomme}`;

        const { error: uploadErr } = await supabase.storage
          .from('images').upload(storagePath, selectedFile);
        if (uploadErr) throw uploadErr;

        const { data: { publicUrl } } = supabase.storage
          .from('images').getPublicUrl(storagePath);

        // Si "Autre" est sélectionné, on intègre la description dans stade_nom
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

            for (const diseaseName of selectedDiseases) {
              await supabase.from('annotations_maladie').insert([{
                diagnostic_id:        diagData.id,
                image_hash:           imageHash,
                utilisateur_id:       doc.id,
                image_original_url:   publicUrl,
                annotated_image_path: annotPath,
                annotated_image_url:  annotPublicUrl,
                annotation_details:   annotations[diseaseName],
              }]);
            }
          }
        }
      }

      const updatedQueue = fileQueue.map((item, i) =>
        i === currentIndex ? { ...item, status: 'uploaded' } : item
      );
      setFileQueue(updatedQueue);

      // Mettre à jour les stats
      setImportStats(prev => prev ? {
        ...prev,
        existing: prev.existing + 1,
        pending:  Math.max(0, prev.pending - 1),
      } : null);

      setSaveMessage(`✅ Enregistré !`);
      setTimeout(() => goToNext(updatedQueue, currentIndex), 1200);

    } catch (err) {
      setSaveMessage(`❌ Erreur: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const selectedDiseases = Object.keys(selections);
  const currentItemIsAlreadyUploaded = currentIndex !== null && fileQueue[currentIndex]?.status === 'uploaded';

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] text-white font-sans overflow-hidden">
      <GlobalMenu />

      <div className="flex flex-1 gap-6 p-6 pt-[80px] overflow-hidden min-h-0">

        {/* ── GALERIE ── */}
        <div className="w-48 flex-shrink-0 flex flex-col bg-slate-800/50 rounded-3xl border border-white/10 overflow-hidden">

          {/* En-tête */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-white/10 flex-shrink-0">
            <ImageIcon size={15} className="text-cyan-400 flex-shrink-0" />
            <h2 className="text-[10px] font-bold uppercase tracking-widest truncate flex-1">
              Galerie ({fileQueue.length})
            </h2>
            {fileQueue.length > 0 && (
              <button
                onClick={handleClearQueue}
                disabled={isSaving}
                title="Vider la galerie"
                className="w-5 h-5 flex-shrink-0 flex items-center justify-center rounded-full bg-slate-600 hover:bg-red-500 transition-colors disabled:opacity-40"
              >
                <X size={11} className="text-white" />
              </button>
            )}
          </div>

          {/* ── Bandeau stats après import ── */}
          {importStats && (
            <div className="px-3 py-2 border-b border-white/10 flex-shrink-0 space-y-1">
              {isChecking ? (
                <div className="flex items-center gap-2">
                  <Activity size={11} className="animate-spin text-cyan-400" />
                  <span className="text-[9px] text-cyan-400">Vérification...</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-slate-400">Total</span>
                    <span className="text-[9px] font-bold text-white">{importStats.total}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-green-400 flex items-center gap-1">
                      <CheckCircle2 size={9} /> Déjà faites
                    </span>
                    <span className="text-[9px] font-bold text-green-400">{importStats.existing}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[9px] text-cyan-400">À traiter</span>
                    <span className="text-[9px] font-bold text-cyan-400">{importStats.pending}</span>
                  </div>
                  {/* Barre de progression */}
                  <div className="w-full bg-slate-700 rounded-full h-1 mt-1">
                    <div
                      className="bg-green-400 h-1 rounded-full transition-all"
                      style={{ width: `${(importStats.existing / importStats.total) * 100}%` }}
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Indicateur de vérification en cours */}
          {isChecking && !importStats && (
            <div className="px-3 py-2 border-b border-white/10 flex-shrink-0 flex items-center gap-2">
              <Activity size={11} className="animate-spin text-cyan-400" />
              <span className="text-[9px] text-cyan-400">Vérification Supabase...</span>
            </div>
          )}

          {/* Liste images */}
          <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar min-h-0">
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
            ) : (
              fileQueue.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    if (!isSaving) {
                      setCurrentIndex(idx);
                      setSelectedFile(item.file);
                      setSelectedImage(item.preview);
                      resetAnnotationState();
                      setSelections({});
                      setAutreDescription('');
                    }
                  }}
                  className={`relative cursor-pointer rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all ${
                    currentIndex === idx
                      ? 'border-cyan-400 opacity-100'
                      : 'border-transparent opacity-50 hover:opacity-70'
                  }`}
                >
                  <img src={item.preview} alt="mini" className="w-full h-20 object-cover" />

                  {/* ── Tic vert : image déjà dans Supabase ── */}
                  {item.status === 'uploaded' && (
                    <div className="absolute inset-0 bg-green-500/60 flex flex-col items-center justify-center gap-1">
                      <CheckCircle2 size={22} className="text-white drop-shadow" />
                      <span className="text-[7px] text-white font-bold uppercase tracking-wide">
                        Déjà enregistrée
                      </span>
                    </div>
                  )}

                  {/* Badge doublon (détecté pendant upload) */}
                  {item.status === 'duplicate' && (
                    <div className="absolute inset-0 bg-orange-500/70 flex flex-col items-center justify-center gap-1">
                      <AlertCircle size={18} className="text-white" />
                      <span className="text-[7px] text-white font-bold uppercase">Doublon</span>
                    </div>
                  )}

                  {/* Spinner pendant la vérification */}
                  {isChecking && item.status === 'pending' && (
                    <div className="absolute bottom-1 right-1">
                      <Activity size={10} className="animate-spin text-cyan-300" />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── PANNEAU CENTRAL ── */}
        <div className="flex-1 flex gap-6 min-h-0 overflow-hidden">

          {/* ── DIAGNOSTIC ── */}
          <div className="w-[360px] flex-shrink-0 flex flex-col bg-slate-800/30 rounded-3xl border border-white/10 overflow-hidden">
            <div className="px-6 pt-6 pb-2 flex-shrink-0">
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest">
                Diagnostic Médical
              </h3>
            </div>

            <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-3 custom-scrollbar min-h-0">

              {/* Message si image déjà traitée */}
              {currentItemIsAlreadyUploaded && (
                <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-2xl flex items-center gap-3">
                  <CheckCircle2 size={20} className="text-green-400 flex-shrink-0" />
                  <div>
                    <p className="text-[11px] text-green-400 font-bold">Image déjà enregistrée</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">
                      Cette image a déjà été diagnostiquée. Sélectionnez une autre image dans la galerie.
                    </p>
                  </div>
                </div>
              )}

              {selectedDiseases.length > 0 && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
                  <p className="text-[9px] text-blue-400 font-bold uppercase mb-2">Légende</p>
                  <div className="space-y-1">
                    {selectedDiseases.map(diseaseName => {
                      const disease = categoryOptions.find(c => c.name === diseaseName);
                      return (
                        <div key={diseaseName} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded border-2 flex-shrink-0"
                            style={{ backgroundColor: disease?.color, borderColor: disease?.color }} />
                          <span className="text-[10px] text-white font-bold">
                            {diseaseName === 'Autre' && autreDescription.trim()
                              ? `Autre — ${autreDescription.trim()}`
                              : diseaseName}
                          </span>
                          {annotations[diseaseName] &&
                            <span className="text-[8px] text-green-400 ml-auto">✓</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {categoryOptions.map((cat, idx) => {
                const isSelected    = !!selections[cat.name];
                const hasAnnotation = !!annotations[cat.name];
                const canCheck      = canCheckDisease(cat.name);
                const canDraw       = canDrawContour(cat.name);
                const isAutre       = cat.name === 'Autre';

                return (
                  <div
                    key={idx}
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
                      <input
                        type="checkbox"
                        className="w-5 h-5 accent-cyan-400 flex-shrink-0"
                        checked={isSelected}
                        disabled={currentItemIsAlreadyUploaded || (!isSelected && !canCheck)}
                        onChange={(e) => handleDiseaseCheck(cat.name, e.target.checked)}
                      />
                    </div>

                    {isSelected && (
                      <>
                        {isAutre && (
                          <div className="mt-3">
                            <label className="text-[9px] text-slate-400 uppercase font-bold block mb-1">
                              Préciser la pathologie *
                            </label>
                            <input
                              type="text"
                              value={autreDescription}
                              onChange={(e) => setAutreDescription(e.target.value)}
                              placeholder="Ex: Otomycose, Corps étranger..."
                              maxLength={100}
                              className={`w-full bg-slate-900 text-[11px] text-white placeholder-slate-500 
                                px-3 py-2 rounded-lg border transition-colors outline-none
                                ${autreDescription.trim()
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
                            onChange={(e) => setSelections({ ...selections, [cat.name]: { stage: e.target.value } })}
                          >
                            <option value="Aucun">Sélectionner un stade...</option>
                            {cat.options.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        )}

                        <button
                          onClick={() => handleOpenAnnotation(cat.name)}
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

          {/* ── ZONE IMAGE + BOUTON ── */}
          <div className="flex-1 flex flex-col gap-3 min-h-0 overflow-hidden">

            <div className="flex-1 min-h-0 bg-slate-950 border-2 border-dashed border-white/10 rounded-[2rem] flex items-center justify-center relative overflow-hidden">
              {!selectedImage ? (
                <label className="cursor-pointer text-center p-8 hover:scale-105 transition-transform">
                  <Upload className="text-cyan-400 mx-auto mb-4" size={44} />
                  <p className="font-black uppercase text-xs text-slate-400">Importer un dossier médical</p>
                  <p className="text-[9px] text-slate-600 mt-1">JPG · PNG · TIFF · WEBP</p>
                  <input
                    type="file" className="hidden"
                    webkitdirectory="true" directory="true" multiple
                    onChange={handleFolderChange}
                  />
                </label>
              ) : (
                <>
                  <img
                    src={annotationPreviewUrl || selectedImage}
                    className="w-full h-full object-contain"
                    alt="Current"
                  />

                  {/* Badge "déjà enregistrée" sur l'image */}
                  {currentItemIsAlreadyUploaded && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <div className="bg-green-500/90 backdrop-blur-sm rounded-2xl px-6 py-4 flex flex-col items-center gap-2 border border-green-400/50">
                        <CheckCircle2 size={36} className="text-white" />
                        <p className="text-white font-black text-sm uppercase">Déjà enregistrée</p>
                        <p className="text-green-100 text-[10px]">Cette image a déjà été diagnostiquée</p>
                      </div>
                    </div>
                  )}

                  {/* Compteur */}
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
                        {selectedDiseases.map(diseaseName => {
                          const disease    = categoryOptions.find(c => c.name === diseaseName);
                          const hasContour = annotations[diseaseName];
                          return (
                            <div key={diseaseName} className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded flex-shrink-0"
                                style={{ backgroundColor: disease?.color }} />
                              <span className="text-[9px] text-white">
                                {diseaseName === 'Autre' && autreDescription.trim()
                                  ? `Autre — ${autreDescription.trim()}`
                                  : diseaseName}
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
              <button
                onClick={handleUpload}
                disabled={
                  isSaving || isChecking || !selectedFile ||
                  currentItemIsAlreadyUploaded ||
                  selectedDiseases.length === 0 ||
                  !selectedDiseases.every(d => annotations[d]) ||
                  (selectedDiseases.includes('Autre') && !autreDescription.trim())
                }
                className={`w-full py-4 rounded-2xl font-black text-sm uppercase tracking-tighter transition-all ${
                  isSaving || isChecking || !selectedFile ||
                  currentItemIsAlreadyUploaded ||
                  selectedDiseases.length === 0 ||
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