import React, { useEffect, useState } from 'react';
import { Edit, Image as ImageIcon, Trash2, AlertTriangle, Info } from 'lucide-react';
import GlobalMenu from '../components/GlobalMenu';
import AnnotationCanvas from '../components/AnnotationCanvas';
import { supabase } from '../supabaseClient';
import UTIF from 'utif';

const categoryOptions = [
  { name: 'OMA', fullName: 'Otite Moyenne Aiguë', options: ['Congestive', 'Suppurée', 'Perforée'] },
  { name: 'OSM', fullName: 'Otite Séromuqueuse', options: [] },
  { name: 'Perfo', fullName: 'Perforation', options: ['Marginale', 'Non Marginale'] },
  { name: 'Chole', fullName: 'Cholestéatome', options: ['Atticale', 'Post-Sup', 'Attic + Post-Sup'] },
  { name: 'PDR + Atel', fullName: 'Poche de Rétraction + Atélectasie', options: ['Stade I', 'Stade II', 'Stade III'] },
  { name: 'Normal', fullName: 'Tympan Normal', options: [] },
  { name: 'Autre', fullName: 'Autre Pathologie', options: [] }
];

const MesImages = () => {
  const [activeTab, setActiveTab]         = useState('mes-diagnostics');
  const [allDataGrouped, setAllDataGrouped] = useState([]);
  const [showModal, setShowModal]         = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [modalMode, setModalMode]         = useState('edit');
  const [deleteTarget, setDeleteTarget]   = useState(null);

  const [newDiseaseName, setNewDiseaseName] = useState('OMA');
  const [newDiseaseType, setNewDiseaseType] = useState('Standard');
  // Sélections multiples pour le mode ajout d'avis
  const [multiSelections, setMultiSelections] = useState({});
  const [showAvisInfo, setShowAvisInfo] = useState(false);
  const [password, setPassword]           = useState('');
  const [error, setError]                 = useState('');
  const [step, setStep]                   = useState(1);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError]     = useState('');
  const [searchTerm, setSearchTerm]       = useState('');
  const [searchDoctor, setSearchDoctor]   = useState('');
  const [showAnnotationModal, setShowAnnotationModal] = useState(false);
  const [annotationPayload, setAnnotationPayload] = useState(null);
  const [annotationPreviewUrl, setAnnotationPreviewUrl] = useState('');
  const [annotationSourceUrl, setAnnotationSourceUrl] = useState('');

  const [currentUser, setCurrentUser]     = useState(null);
  const [sessionMode, setSessionMode]     = useState('solo');
  const [collaborator, setCollaborator]   = useState(null);
  const [convertedImages, setConvertedImages] = useState({});

  useEffect(() => {
    const storedUser  = localStorage.getItem('user');
    const storedMode  = localStorage.getItem('mode_session');
    const storedCollab = localStorage.getItem('collaborateur');
    if (storedUser)  setCurrentUser(JSON.parse(storedUser));
    if (storedCollab) setCollaborator(JSON.parse(storedCollab));
    setSessionMode(storedMode || 'solo');
  }, []);

  const currentUserId    = currentUser?.id || null;
  const doctorDisplayName = currentUser
    ? `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim()
    : 'Médecin non identifié';

  /* ─── Conversion TIF ─── */
  const isTiffUrl = (url) => {
    if (!url) return false;
    return url.toLowerCase().includes('.tif');
  };

  const convertTiffUrl = async (url) => {
    if (convertedImages[url]) return convertedImages[url];
    try {
      const response    = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const ifds        = UTIF.decode(arrayBuffer);
      if (!ifds || ifds.length === 0) throw new Error('TIFF vide');
      UTIF.decodeImage(arrayBuffer, ifds[0]);
      const ifd    = ifds[0];
      const canvas = document.createElement('canvas');
      canvas.width  = ifd.width;
      canvas.height = ifd.height;
      const ctx   = canvas.getContext('2d');
      const rgba  = UTIF.toRGBA8(ifd);
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), ifd.width, ifd.height), 0, 0);
      const png = canvas.toDataURL('image/png', 1.0);
      setConvertedImages(prev => ({ ...prev, [url]: png }));
      return png;
    } catch (e) {
      console.error('Erreur TIF:', e);
      return url;
    }
  };

  /* ─── Composant image avec support TIF ─── */
  const ImageDisplay = ({ src, alt, className }) => {
    const [displaySrc, setDisplaySrc]     = useState(src);
    const [isConverting, setIsConverting] = useState(false);

    useEffect(() => {
      let cancelled = false;
      const load = async () => {
        if (isTiffUrl(src)) {
          setIsConverting(true);
          const converted = await convertTiffUrl(src);
          if (!cancelled) { setDisplaySrc(converted); setIsConverting(false); }
        } else {
          setDisplaySrc(src);
        }
      };
      load();
      return () => { cancelled = true; };
    }, [src]);

    if (isConverting) {
      return (
        <div className={className + ' flex items-center justify-center bg-slate-700'}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto mb-2" />
            <p className="text-xs text-slate-400">Conversion TIF...</p>
          </div>
        </div>
      );
    }
    return <img src={displaySrc} alt={alt} className={className} />;
  };

  /* ─── Données ─── */
  const groupData = (data) => {
    if (!data || !Array.isArray(data)) return [];
    const groups = data.reduce((acc, cur) => {
      const hash = cur.image_hash;
      if (!acc[hash]) acc[hash] = { image_url: cur.image_url, image_hash: hash, avis: [] };
      acc[hash].avis.push(cur);
      return acc;
    }, {});
    return Object.values(groups);
  };

  const fetchData = async () => {
    const { data, error } = await supabase
      .from('categories_diagnostics')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) console.error('Erreur Fetch:', error.message);
    else setAllDataGrouped(groupData(data));
  };

  useEffect(() => { if (currentUserId) fetchData(); }, [currentUserId]);

  const normalizeAvis = (maladie_nom, stade_nom) => {
    // Séparer les maladies et les stades
    const maladies = (maladie_nom || '').split('+').map(m => m.trim());
    const stades   = (stade_nom   || '').split('/').map(s => s.trim());

    // Associer chaque maladie à son stade correspondant
    const pairs = maladies.map((m, i) => ({
      maladie: m.toLowerCase(),
      stade:   (stades[i] || 'standard').toLowerCase().replace('aucun', 'standard'),
    }));

    // Trier par nom de maladie pour ignorer l'ordre d'ajout
    pairs.sort((a, b) => a.maladie.localeCompare(b.maladie));

    return pairs.map(p => `${p.maladie}|${p.stade}`).join('::');
  };

  const getAvisStatus = (group) => {
    if (group.avis.length < 2) return 'pending';
    const counts = {};
    group.avis.forEach(item => {
      const key = normalizeAvis(item.maladie_nom, item.stade_nom);
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.values(counts).some(c => c >= 2) ? 'validated' : 'divergent';
  };

  const myGroups        = allDataGrouped.filter(g => g.avis.some(a => a.utilisateur_id === currentUserId));
  const availableGroups = allDataGrouped.filter(g => !g.avis.some(a => a.utilisateur_id === currentUserId) && getAvisStatus(g) !== 'validated');

  const filteredData = (activeTab === 'mes-diagnostics' ? myGroups : availableGroups).filter(group =>
    group.avis.some(avi => {
      const diseaseMatch = searchTerm  === '' || avi.maladie_nom === searchTerm;
      const doctorMatch  = searchDoctor === '' || avi.nom_medecin_diagnostiqueur === searchDoctor;
      return diseaseMatch && doctorMatch;
    })
  );

  /* ─── Auth ─── */
  const verifyPassword = async (pwd) => {
    if (!currentUser?.email) return false;
    const { error } = await supabase.auth.signInWithPassword({ email: currentUser.email, password: pwd });
    return !error;
  };

  /* ─── Handlers ─── */
  const handleEditClick = (avi) => {
    setSelectedImage(avi);
    setModalMode('edit');
    setNewDiseaseName(avi.maladie_nom || 'OMA');
    setNewDiseaseType(avi.stade_nom  || 'Standard');
    setPassword(''); setError(''); setStep(1);
    setShowModal(true);
  };

  const handleDeleteClick = (avi) => {
    setDeleteTarget(avi);
    setDeletePassword(''); setDeleteError('');
    setShowDeleteModal(true);
  };

  const dataUrlToBlob = async (dataUrl) => {
    const response = await fetch(dataUrl);
    return response.blob();
  };

  const buildAnnotatedImageDataUrl = (src, payload) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0);

          const points = payload.points_pixels || [];
          if (points.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].y);
            for (let index = 1; index < points.length; index += 1) {
              ctx.lineTo(points[index].x, points[index].y);
            }
            ctx.closePath();
            ctx.fillStyle = 'rgba(34, 211, 238, 0.25)';
            ctx.fill();
            ctx.strokeStyle = '#22d3ee';
            ctx.lineWidth = Math.max(2, Math.round(Math.min(img.naturalWidth, img.naturalHeight) * 0.003));
            ctx.stroke();
          }

          resolve(canvas.toDataURL('image/png', 1.0));
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = () => reject(new Error('Impossible de générer l\'image annotée.'));
      img.src = src;
    });
  };

  const openAnnotationModal = async () => {
    if (!selectedGroup?.image_url) {
      setError('Image introuvable pour l\'annotation.');
      return;
    }
    setError('');
    const src = isTiffUrl(selectedGroup.image_url)
      ? await convertTiffUrl(selectedGroup.image_url)
      : selectedGroup.image_url;
    setAnnotationSourceUrl(src);
    setShowAnnotationModal(true);
  };

  const handleAnnotationSave = async (payload) => {
    try {
      const source = annotationSourceUrl || selectedGroup?.image_url;
      const preview = await buildAnnotatedImageDataUrl(source, payload);
      setAnnotationPayload(payload);
      setAnnotationPreviewUrl(preview);
      setShowAnnotationModal(false);
    } catch (e) {
      console.error(e);
      setError('Erreur lors de la génération de l\'image annotée.');
    }
  };

  const getLatestDiagnosticIdForUser = async (imageHash, userId) => {
    const { data, error } = await supabase
      .from('categories_diagnostics')
      .select('id')
      .eq('image_hash', imageHash)
      .eq('utilisateur_id', userId)
      .order('id', { ascending: false })
      .limit(1)
      .single();

    if (error) throw error;
    return data?.id;
  };

  const saveAnnotationRecord = async ({ diagnosticId, imageHash }) => {
    if (!annotationPayload || !annotationPreviewUrl || !diagnosticId) return;

    const fileName = `annotation_${Date.now()}_${currentUserId}.png`;
    const storagePath = `annotations/${imageHash}/${fileName}`;
    const blob = await dataUrlToBlob(annotationPreviewUrl);

    const { error: uploadError } = await supabase.storage
      .from('images')
      .upload(storagePath, blob, {
        contentType: 'image/png',
        upsert: true,
      });
    if (uploadError) throw uploadError;

    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath);

    const { error: annotationInsertError } = await supabase
      .from('annotations_maladie')
      .insert([{
        diagnostic_id: diagnosticId,
        image_hash: imageHash,
        utilisateur_id: currentUserId,
        image_original_url: selectedGroup?.image_url || '',
        annotated_image_path: storagePath,
        annotated_image_url: publicUrl,
        annotation_details: annotationPayload,
      }]);

    if (annotationInsertError) throw annotationInsertError;
  };

  // Soumission directe SANS mot de passe (mode ajout d'avis) — multi-maladies
  const handleAddAvis = async () => {
    setError('');
    const keys = Object.keys(multiSelections);
    if (keys.length === 0) { setError('Sélectionnez au moins une pathologie.'); return; }
    if (!annotationPayload) {
      setError('Veuillez tracer le contour de la maladie avant validation.');
      return;
    }
    try {
      const today       = new Date().toISOString().split('T')[0];
      const maladieNom  = keys.join(' + ');
      const stadeNom    = keys.map(k => multiSelections[k].stage || 'Standard').join(' / ');
      const insertedDiagnosticIds = [];
      
      const baseData = {
        image_hash:          selectedGroup.image_hash,
        image_url:           selectedGroup.image_url,
        maladie_nom:         maladieNom,
        stade_nom:           stadeNom,
        nom_image_originale: selectedGroup.avis[0]?.nom_image_originale || '',
        nom_image_renommee:  selectedGroup.avis[0]?.nom_image_renommee  || '',
        date_diagnostique:   today,
      };
      
      // Liste des médecins à insérer
      const medecins = [
        { id: currentUserId, nom: doctorDisplayName }
      ];
      if (sessionMode === 'collaboration' && collaborator) {
        medecins.push({ 
          id: collaborator.id, 
          nom: `${collaborator.prenom} ${collaborator.nom}`.trim() 
        });
      }

      // Insérer pour chaque médecin (RPC en mode collaboration)
      for (const medecin of medecins) {
        if (sessionMode === 'collaboration') {
          // Utiliser RPC pour contourner RLS
          const { error } = await supabase.rpc('insert_diagnostic_collaboration', {
            p_image_hash:         baseData.image_hash,
            p_image_url:          baseData.image_url,
            p_utilisateur_id:     medecin.id,
            p_nom_medecin:        medecin.nom,
            p_maladie_nom:        baseData.maladie_nom,
            p_stade_nom:          baseData.stade_nom,
            p_nom_image_originale: baseData.nom_image_originale,
            p_nom_image_renommee:  baseData.nom_image_renommee,
            p_path_image_final:    baseData.nom_image_renommee,
            p_date_diagnostique:   baseData.date_diagnostique
          });
          if (error) throw error;

          if (medecin.id === currentUserId) {
            const latestId = await getLatestDiagnosticIdForUser(baseData.image_hash, currentUserId);
            if (latestId) insertedDiagnosticIds.push(latestId);
          }
        } else {
          // Mode solo : insertion normale
          const { data, error } = await supabase.from('categories_diagnostics').insert([{
            ...baseData,
            utilisateur_id: medecin.id,
            nom_medecin_diagnostiqueur: medecin.nom
          }]).select('id').single();
          if (error) throw error;
          if (medecin.id === currentUserId && data?.id) insertedDiagnosticIds.push(data.id);
        }
      }

      const targetDiagnosticId = insertedDiagnosticIds[0] || await getLatestDiagnosticIdForUser(baseData.image_hash, currentUserId);
      await saveAnnotationRecord({
        diagnosticId: targetDiagnosticId,
        imageHash: baseData.image_hash,
      });
      
      setShowModal(false);
      setMultiSelections({});
      setAnnotationPayload(null);
      setAnnotationPreviewUrl('');
      setAnnotationSourceUrl('');
      fetchData();
    } catch (err) {
      console.error(err);
      setError("Erreur lors de l'enregistrement.");
    }
  };

  // Confirmation AVEC mot de passe (mode modification uniquement)
  const handleConfirmAction = async () => {
    setError('');
    const isValid = await verifyPassword(password.trim());
    if (!isValid) { setError('Mot de passe incorrect.'); return; }
    try {
      const { error } = await supabase.from('categories_diagnostics')
        .update({ maladie_nom: newDiseaseName, stade_nom: newDiseaseType })
        .eq('id', selectedImage.id);
      if (error) throw error;
      setShowModal(false);
      fetchData();
    } catch (err) {
      console.error(err);
      setError("Erreur lors de l'enregistrement.");
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleteError('');
    const isValid = await verifyPassword(deletePassword.trim());
    if (!isValid) { setDeleteError('Mot de passe incorrect.'); return; }
    const { error } = await supabase.from('categories_diagnostics').delete().eq('id', deleteTarget.id);
    if (error) setDeleteError('Erreur de suppression.');
    else { setShowDeleteModal(false); fetchData(); }
  };

  const currentCategory = categoryOptions.find(c => c.name === newDiseaseName);
  const uniqueDiseases  = categoryOptions.map(c => c.name);
  const uniqueDoctors   = [...new Set(allDataGrouped.flatMap(g => g.avis.map(a => a.nom_medecin_diagnostiqueur)))].filter(Boolean).sort();

  /* ─── RENDU ─── */
  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      <GlobalMenu />
      <div className="max-w-6xl mx-auto mt-12">

        {/* En-tête */}
        <header className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <ImageIcon className="text-cyan-400" size={30} />
            <h1 className="text-2xl font-bold uppercase tracking-widest italic">DIAGNOSTICS</h1>
          </div>
          <div className="flex bg-slate-800 p-1 rounded-2xl border border-white/5 shadow-2xl">
            <button onClick={() => setActiveTab('mes-diagnostics')} className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'mes-diagnostics' ? 'bg-cyan-500 text-white' : 'text-slate-500'}`}>MES DIAGNOSTICS</button>
            <button onClick={() => setActiveTab('disponibles')}    className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'disponibles'    ? 'bg-cyan-500 text-white' : 'text-slate-500'}`}>CONTRIBUER</button>
          </div>
        </header>

        {/* Médecins connectés */}
        <div className="mb-6 p-4 bg-cyan-500/10 rounded-2xl border border-cyan-500/30">
          <p className="text-[10px] font-bold text-cyan-400 uppercase">
            {sessionMode === 'collaboration' ? 'Session Collaborative' : 'Médecin connecté'}
          </p>
          <div className="flex items-center gap-4 mt-1">
            <div className="flex-1">
              <p className="text-xs text-slate-400 mb-1">Médecin 1</p>
              <p className="text-sm font-bold text-white">Dr. {currentUser?.prenom} {currentUser?.nom}</p>
            </div>
            {sessionMode === 'collaboration' && collaborator && (
              <>
                <div className="w-px h-10 bg-slate-600" />
                <div className="flex-1">
                  <p className="text-xs text-blue-400 mb-1">Médecin 2</p>
                  <p className="text-sm font-bold text-white">Dr. {collaborator.prenom} {collaborator.nom}</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Filtres */}
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="flex-1">
            <label className="text-[10px] font-black text-slate-500 uppercase ml-2 mb-1 block">Filtrer par Maladie</label>
            <select className="w-full bg-slate-800 border border-white/5 p-4 rounded-2xl text-xs font-bold outline-none" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}>
              <option value="">Toutes les pathologies</option>
              {uniqueDiseases.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[10px] font-black text-slate-500 uppercase ml-2 mb-1 block">Filtrer par Médecin</label>
            <select className="w-full bg-slate-800 border border-white/5 p-4 rounded-2xl text-xs font-bold outline-none" value={searchDoctor} onChange={e => setSearchDoctor(e.target.value)}>
              <option value="">Tous les médecins</option>
              {uniqueDoctors.map(d => <option key={d} value={d}>Dr. {d}</option>)}
            </select>
          </div>
        </div>

        {/* Grille */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredData.map(group => {
            const status = getAvisStatus(group);
            return (
              <div key={group.image_hash} className={`relative bg-slate-800 rounded-[2.5rem] overflow-hidden border transition-all ${status === 'validated' ? 'border-purple-500/50' : status === 'divergent' ? 'border-red-500/40' : 'border-white/5'}`}>
                <div className="relative h-56">
                  <ImageDisplay src={group.image_url} alt="Tympan" className="w-full h-full object-cover" />
                  <div className="absolute top-4 right-4 flex gap-2">
                    {status === 'validated' && <span className="bg-purple-600 px-3 py-1 rounded-full text-[8px] font-bold uppercase">Validé</span>}
                    {status === 'divergent' && <span className="bg-red-600    px-3 py-1 rounded-full text-[8px] font-bold uppercase">Divergent</span>}
                  </div>
                </div>
                <div className="p-6 space-y-3">
                  {/* Afficher les avis SEULEMENT dans "Mes diagnostics" */}
                  {activeTab === 'mes-diagnostics' && group.avis.map(avi => (
                    <div key={avi.id} className={`p-4 rounded-2xl border ${avi.utilisateur_id === currentUserId ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-slate-900 border-transparent'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-xs font-black text-cyan-400 uppercase">{avi.maladie_nom}{avi.stade_nom && avi.stade_nom !== 'Standard' ? ` (${avi.stade_nom})` : ''}</p>
                          <p className="text-[10px] text-slate-500 italic mt-1">Dr. {avi.nom_medecin_diagnostiqueur}</p>
                        </div>
                        {avi.utilisateur_id === currentUserId && (
                          <div className="flex gap-1">
                            <button onClick={() => handleEditClick(avi)}   className="p-2 text-slate-400 hover:text-cyan-400"><Edit  size={14}/></button>
                            <button onClick={() => handleDeleteClick(avi)} className="p-2 text-red-400/50 hover:text-red-500"><Trash2 size={14}/></button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  {/* Message informatif dans "Contribuer" */}
                  {activeTab === 'disponibles' && (
                    <>
                      <div className="p-4 rounded-2xl bg-slate-900 border border-slate-700">
                        <p className="text-[10px] text-slate-400 text-center uppercase font-bold mb-2">
                          👁️ {group.avis.length} avis déjà donné{group.avis.length > 1 ? 's' : ''}
                        </p>
                        <p className="text-[9px] text-slate-500 text-center italic">
                          Donnez votre diagnostic en toute indépendance
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedGroup(group);
                          setModalMode('add');
                          setMultiSelections({});
                          setShowAvisInfo(false);
                          setStep(1);
                          setAnnotationPayload(null);
                          setAnnotationPreviewUrl('');
                          setAnnotationSourceUrl('');
                          setShowModal(true);
                        }}
                        className="w-full py-4 bg-cyan-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-cyan-500 transition-all"
                      >
                        Donner mon avis
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── MODALE AJOUT / ÉDITION ─── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">

          {/* Largeur adaptative : large si ajout d'avis (image visible) sinon compact */}
          <div className={`bg-slate-800 border border-white/10 shadow-2xl rounded-[2.5rem] w-full overflow-hidden flex ${modalMode === 'add' && step === 1 ? 'max-w-3xl flex-row' : 'max-w-sm flex-col p-8'}`}>

            {/* ── IMAGE (gauche) — uniquement mode ajout étape 1 ── */}
            {modalMode === 'add' && step === 1 && selectedGroup && (
              <div className="w-1/2 shrink-0 relative bg-slate-900 min-h-[440px] flex items-center justify-center p-4">
                <ImageDisplay
                  src={selectedGroup.image_url}
                  alt="Image à diagnostiquer"
                  className="w-full h-full object-contain"
                />
                {/* Overlay bas : nom du fichier uniquement */}
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-5">
                  <p className="text-[9px] text-cyan-400 uppercase font-bold tracking-widest mb-1">Image à diagnostiquer</p>
                  <p className="text-xs text-white font-bold truncate">
                    {selectedGroup.avis[0]?.nom_image_originale || 'Image'}
                  </p>
                </div>

                {/* Badge info cliquable en haut à droite */}
                {selectedGroup.avis.length > 0 && (
                  <div className="absolute top-4 right-4">
                    <button
                      onMouseEnter={() => setShowAvisInfo(true)}
                      onMouseLeave={() => setShowAvisInfo(false)}
                      className="bg-cyan-500/80 hover:bg-cyan-500 backdrop-blur-sm px-3 py-2 rounded-full flex items-center gap-2 transition-all"
                    >
                      <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd"/>
                      </svg>
                      <span className="text-[10px] font-bold text-white">{selectedGroup.avis.length} avis</span>
                    </button>

                    {/* Bulle d'information au survol */}
                    {showAvisInfo && (
                      <div className="absolute top-full right-0 mt-2 w-72 bg-slate-800/95 backdrop-blur-md border border-cyan-500/30 rounded-2xl p-4 shadow-2xl z-50">
                        <p className="text-[9px] text-cyan-400 uppercase font-bold mb-2 tracking-wider">👁️ Avis existants (optionnel)</p>
                        <div className="space-y-2">
                          {selectedGroup.avis.map(a => (
                            <div key={a.id} className="flex items-start gap-2 p-2 bg-slate-900/50 rounded-lg">
                              <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 shrink-0 mt-1.5" />
                              <div className="flex-1 min-w-0">
                                <p className="text-[9px] text-slate-400">Dr. {a.nom_medecin_diagnostiqueur}</p>
                                <p className="text-[10px] text-cyan-300 font-bold truncate">
                                  {a.maladie_nom}{a.stade_nom && a.stade_nom !== 'Standard' ? ` (${a.stade_nom})` : ''}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                        <p className="text-[8px] text-slate-500 mt-3 italic text-center">
                          Consultez si besoin, mais formez votre propre avis
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ── FORMULAIRE (droite ou seul si edit) ── */}
            <div className={`flex flex-col justify-center ${modalMode === 'add' && step === 1 ? 'w-1/2 p-8' : 'w-full'}`}>
              <h2 className="text-xl font-black mb-8 text-center uppercase tracking-tighter">
                {step === 1 ? (modalMode === 'edit' ? 'Modifier le diagnostic' : 'Donner mon avis') : 'Confirmation'}
              </h2>

              {step === 1 ? (
                <div className="space-y-5">
                  {/* Alerte info pour modification */}
                  {modalMode === 'edit' && (
                    <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl">
                      <Info size={20} className="text-blue-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Information</p>
                        <p className="text-xs text-blue-300">L'image source sera conservée. Seul le diagnostic sera modifié.</p>
                      </div>
                    </div>
                  )}

                  {/* ── Mode AJOUT : checkboxes multi-sélection ── */}
                  {modalMode === 'add' ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-cyan-500/30 bg-cyan-500/10">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-cyan-400">Contour maladie</p>
                          <p className="text-[10px] text-slate-300">Tracer la zone malade avant validation.</p>
                        </div>
                        <button
                          onClick={openAnnotationModal}
                          className="px-4 py-2 text-[10px] font-black uppercase bg-cyan-600 rounded-xl hover:bg-cyan-500"
                        >
                          {annotationPayload ? 'Modifier contour' : 'Tracer contour'}
                        </button>
                      </div>

                      {annotationPreviewUrl && (
                        <div className="rounded-2xl border border-white/10 overflow-hidden">
                          <img src={annotationPreviewUrl} alt="Aperçu annotation" className="w-full h-32 object-cover" />
                        </div>
                      )}

                      <div className="space-y-2 overflow-y-auto max-h-[260px] pr-1 custom-scrollbar">
                        {categoryOptions.map(cat => {
                          const isChecked = !!multiSelections[cat.name];
                          const icons = { OMA:'🔴', OSM:'🟡', Perfo:'🔵', Chole:'🟣', 'PDR + Atel':'🟠', Normal:'🟢', Autre:'⚪' };
                          return (
                            <div key={cat.name} className={`rounded-2xl border transition-all ${isChecked ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/5 bg-white/5'}`}>
                              <div className="flex items-center gap-3 p-3">
                                <span className="text-lg">{icons[cat.name]}</span>
                                <div className="flex-1">
                                  <p className="text-xs font-bold">{cat.name}</p>
                                  <p className="text-[9px] text-slate-400 uppercase">{cat.fullName}</p>
                                </div>
                                <input
                                  type="checkbox"
                                  className="w-5 h-5 accent-cyan-400"
                                  checked={isChecked}
                                  onChange={e => {
                                    const s = { ...multiSelections };
                                    if (e.target.checked) s[cat.name] = { stage: 'Standard' };
                                    else delete s[cat.name];
                                    setMultiSelections(s);
                                  }}
                                />
                              </div>
                              {/* Stade déroulant si coché et options disponibles */}
                              {isChecked && cat.options.length > 0 && (
                                <div className="px-3 pb-3">
                                  <select
                                    className="w-full bg-slate-900 text-[10px] p-2.5 rounded-xl border border-cyan-500/30 text-white outline-none"
                                    value={multiSelections[cat.name].stage}
                                    onChange={e => setMultiSelections({ ...multiSelections, [cat.name]: { stage: e.target.value } })}
                                  >
                                    <option value="Standard">Stade...</option>
                                    {cat.options.map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* ── Mode EDIT : menus déroulants simples ── */
                    <>
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-500 uppercase ml-2">Pathologie</label>
                        <select
                          value={newDiseaseName}
                          onChange={e => { setNewDiseaseName(e.target.value); setNewDiseaseType('Standard'); }}
                          className="w-full bg-slate-900 p-4 rounded-2xl border border-white/5 outline-none text-white"
                        >
                          {categoryOptions.map(opt => <option key={opt.name} value={opt.name}>{opt.fullName}</option>)}
                        </select>
                      </div>
                      {currentCategory?.options.length > 0 && (
                        <div className="space-y-2">
                          <label className="text-[10px] font-black text-slate-500 uppercase ml-2">Stade / Type</label>
                          <select
                            value={newDiseaseType}
                            onChange={e => setNewDiseaseType(e.target.value)}
                            className="w-full bg-slate-900 p-4 rounded-2xl border border-white/5 outline-none text-white"
                          >
                            <option value="Standard">Standard</option>
                            {currentCategory.options.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        </div>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => { if (modalMode === 'add') handleAddAvis(); else setStep(2); }}
                    className="w-full py-5 bg-cyan-600 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-cyan-500 transition-all"
                  >
                    {modalMode === 'add' ? 'Valider mon avis' : 'Continuer'}
                  </button>
                  <button onClick={() => setShowModal(false)} className="w-full text-slate-500 text-[10px] font-bold uppercase">
                    Annuler
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  <p className="text-[10px] text-slate-400 text-center uppercase font-bold">Confirmez avec votre mot de passe</p>
                  <input
                    type="password" value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Mot de passe"
                    className="w-full bg-slate-900 p-4 rounded-2xl border border-white/5 outline-none text-center"
                    autoFocus
                  />
                  {error && <p className="text-red-400 text-center text-[10px] font-bold uppercase">{error}</p>}
                  <div className="flex gap-4">
                    <button onClick={() => setStep(1)}          className="flex-1 py-5 bg-slate-700 rounded-2xl font-black uppercase text-xs hover:bg-slate-600">Retour</button>
                    <button onClick={handleConfirmAction}       className="flex-1 py-5 bg-cyan-600 rounded-2xl font-black uppercase text-xs hover:bg-cyan-500">Valider</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showAnnotationModal && annotationSourceUrl && (
        <AnnotationCanvas
          imageSrc={annotationSourceUrl}
          initialPoints={annotationPayload?.points_normalized || []}
          onClose={() => setShowAnnotationModal(false)}
          onSave={handleAnnotationSave}
        />
      )}

      {/* ─── MODALE SUPPRESSION ─── */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-slate-800 p-8 rounded-[2.5rem] w-full max-w-md border border-red-500/20">
            <h2 className="text-xl font-black text-red-500 mb-6 text-center uppercase">Supprimer le diagnostic ?</h2>
            <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl mb-6">
              <AlertTriangle size={24} className="text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-400 uppercase mb-2">⚠️ Attention</p>
                <p className="text-sm text-red-300 mb-2">L'image source sera <span className="font-bold">définitivement supprimée</span>.</p>
                <p className="text-xs text-red-400">Cette action est <span className="font-bold">irréversible</span>.</p>
              </div>
            </div>
            <input
              type="password" value={deletePassword} onChange={e => setDeletePassword(e.target.value)}
              placeholder="Mot de passe pour confirmer"
              className="w-full bg-slate-900 p-4 rounded-2xl border border-white/5 outline-none text-center mb-4"
              autoFocus
            />
            {deleteError && <p className="text-red-400 text-xs text-center mb-4 font-bold uppercase">{deleteError}</p>}
            <div className="flex gap-4">
              <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-5 bg-slate-700 rounded-2xl font-black uppercase text-xs hover:bg-slate-600">Annuler</button>
              <button onClick={handleDeleteConfirm}            className="flex-1 py-5 bg-red-600   rounded-2xl font-black uppercase text-xs hover:bg-red-500">Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MesImages;