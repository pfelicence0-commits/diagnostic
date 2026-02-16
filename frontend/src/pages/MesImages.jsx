import React, { useEffect, useState } from 'react';
import { Edit, Image as ImageIcon, Trash2, CheckCircle, X, AlertTriangle, Info } from 'lucide-react';
import GlobalMenu from '../components/GlobalMenu';
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
  const [activeTab, setActiveTab] = useState('mes-diagnostics');
  const [allDataGrouped, setAllDataGrouped] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState(null); 
  const [modalMode, setModalMode] = useState('edit'); 
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [newDiseaseName, setNewDiseaseName] = useState('OMA');
  const [newDiseaseType, setNewDiseaseType] = useState('Standard');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [searchTerm, setSearchTerm] = useState(''); 
  const [searchDoctor, setSearchDoctor] = useState(''); 

  const [currentUser, setCurrentUser] = useState(null);
  const [sessionMode, setSessionMode] = useState('solo');
  const [collaborator, setCollaborator] = useState(null);
  
  // Cache pour les images converties
  const [convertedImages, setConvertedImages] = useState({});

  useEffect(() => {
    const storedUser = localStorage.getItem("user");
    const storedMode = localStorage.getItem("mode_session");
    const storedCollab = localStorage.getItem("collaborateur");
    
    if (storedUser) {
      const userProfile = JSON.parse(storedUser);
      setCurrentUser(userProfile);
    }
    
    setSessionMode(storedMode || 'solo');
    
    if (storedCollab) {
      const collabProfile = JSON.parse(storedCollab);
      setCollaborator(collabProfile);
    }
  }, []);

  const currentUserId = currentUser?.id || null;
  const doctorDisplayName = currentUser 
    ? `${currentUser.prenom || ''} ${currentUser.nom || ''}`.trim() 
    : "Médecin non identifié";

  // Fonction pour convertir une URL TIF en PNG
  const convertTiffUrl = async (url) => {
    // Vérifier si déjà converti
    if (convertedImages[url]) {
      return convertedImages[url];
    }

    try {
      console.log('🔄 Conversion TIF depuis URL:', url);
      
      // Télécharger l'image TIF
      const response = await fetch(url);
      const blob = await response.blob();
      const arrayBuffer = await blob.arrayBuffer();
      
      // Décoder avec UTIF
      const ifds = UTIF.decode(arrayBuffer);
      if (!ifds || ifds.length === 0) {
        throw new Error('Impossible de décoder le TIFF');
      }
      
      UTIF.decodeImage(arrayBuffer, ifds[0]);
      const ifd = ifds[0];
      
      // Créer un canvas
      const canvas = document.createElement('canvas');
      canvas.width = ifd.width;
      canvas.height = ifd.height;
      const ctx = canvas.getContext('2d');
      
      // Convertir en RGBA
      const rgba = UTIF.toRGBA8(ifd);
      const imageData = new ImageData(
        new Uint8ClampedArray(rgba),
        ifd.width,
        ifd.height
      );
      ctx.putImageData(imageData, 0, 0);
      
      // Convertir en PNG
      const pngDataUrl = canvas.toDataURL('image/png', 1.0);
      
      // Mettre en cache
      setConvertedImages(prev => ({ ...prev, [url]: pngDataUrl }));
      
      console.log('✅ Conversion réussie');
      return pngDataUrl;
    } catch (error) {
      console.error('❌ Erreur conversion TIF:', error);
      return url; // Retourner l'URL originale en cas d'erreur
    }
  };

  // Vérifier si une URL est un fichier TIF
  const isTiffUrl = (url) => {
    if (!url) return false;
    const lowerUrl = url.toLowerCase();
    return lowerUrl.includes('.tif') || lowerUrl.includes('.tiff');
  };

  // Composant pour afficher une image (avec conversion TIF si nécessaire)
  const ImageDisplay = ({ src, alt, className }) => {
    const [displaySrc, setDisplaySrc] = useState(src);
    const [isConverting, setIsConverting] = useState(false);

    useEffect(() => {
      const loadImage = async () => {
        if (isTiffUrl(src)) {
          setIsConverting(true);
          const converted = await convertTiffUrl(src);
          setDisplaySrc(converted);
          setIsConverting(false);
        } else {
          setDisplaySrc(src);
        }
      };
      
      loadImage();
    }, [src]);

    if (isConverting) {
      return (
        <div className={className + " flex items-center justify-center bg-slate-700"}>
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mx-auto mb-2"></div>
            <p className="text-xs text-slate-400">Conversion TIF...</p>
          </div>
        </div>
      );
    }

    return <img src={displaySrc} alt={alt} className={className} />;
  };

  const groupData = (data) => {
    if (!data || !Array.isArray(data)) return [];
    const groups = data.reduce((acc, current) => {
      const hash = current.image_hash;
      if (!acc[hash]) {
        acc[hash] = {
          image_url: current.image_url,
          image_hash: hash,
          avis: []
        };
      }
      acc[hash].avis.push(current);
      return acc;
    }, {});
    return Object.values(groups);
  };

  const fetchData = async () => {
    const { data, error } = await supabase
      .from('categories_diagnostics')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error("Erreur Fetch:", error.message);
    } else {
      setAllDataGrouped(groupData(data));
    }
  };

  useEffect(() => { 
    if (currentUserId) {
      fetchData();
    }
  }, [currentUserId]);

  const getAvisStatus = (group) => {
    const avis = group.avis;
    if (avis.length < 2) return 'pending';

    const counts = {};
    
    avis.forEach(item => {
      const key = `${item.maladie_nom}-${item.stade_nom}`;
      counts[key] = (counts[key] || 0) + 1;
    });

    const hasConsensus = Object.values(counts).some(count => count >= 2);

    if (hasConsensus) {
      return 'validated';
    } else {
      return 'divergent';
    }
  };

  const myGroups = allDataGrouped.filter(g => 
    g.avis.some(a => a.utilisateur_id === currentUserId)
  );
  
  const availableGroups = allDataGrouped.filter(g => 
    !g.avis.some(a => a.utilisateur_id === currentUserId) && 
    getAvisStatus(g) !== 'validated'
  );

  const filteredData = (activeTab === 'mes-diagnostics' ? myGroups : availableGroups).filter(group => {
    return group.avis.some(avi => {
      const diseaseMatch = searchTerm === '' || avi.maladie_nom === searchTerm;
      const doctorMatch = searchDoctor === '' || avi.nom_medecin_diagnostiqueur === searchDoctor;
      return diseaseMatch && doctorMatch;
    });
  });

  const verifyPassword = async (pwd) => {
    if (!currentUser?.email) return false;
    const { error } = await supabase.auth.signInWithPassword({
      email: currentUser.email,
      password: pwd
    });
    return !error;
  };

  const handleEditClick = (avi) => {
    setSelectedImage(avi);
    setModalMode('edit');
    setNewDiseaseName(avi.maladie_nom || 'OMA');
    setNewDiseaseType(avi.stade_nom || 'Standard');
    setPassword('');
    setError('');
    setStep(1);
    setShowModal(true);
  };

  const handleDeleteClick = (avi) => {
    setDeleteTarget(avi);
    setDeletePassword('');
    setDeleteError('');
    setShowDeleteModal(true);
  };

  const handleConfirmAction = async () => {
    setError("");
    const isValid = await verifyPassword(password.trim());
    if (!isValid) { 
      setError("Mot de passe incorrect."); 
      return; 
    }

    try {
      if (modalMode === 'edit') {
        const { error } = await supabase
          .from('categories_diagnostics')
          .update({ 
            maladie_nom: newDiseaseName, 
            stade_nom: newDiseaseType 
          })
          .eq('id', selectedImage.id);
        if (error) throw error;
      } else {
        const originalFileName = selectedGroup.avis[0]?.nom_image_originale || "Non défini";
        const renamedFileName = selectedGroup.avis[0]?.nom_image_renommee || "";
        const today = new Date().toISOString().split('T')[0];

        const rowsToInsert = [{
          image_hash: selectedGroup.image_hash,
          image_url: selectedGroup.image_url,
          maladie_nom: newDiseaseName,
          stade_nom: newDiseaseType,
          utilisateur_id: currentUserId,
          nom_medecin_diagnostiqueur: doctorDisplayName,
          nom_image_originale: originalFileName,
          nom_image_renommee: renamedFileName,
          date_diagnostique: today
        }];

        if (sessionMode === 'collaboration' && collaborator) {
          rowsToInsert.push({
            image_hash: selectedGroup.image_hash,
            image_url: selectedGroup.image_url,
            maladie_nom: newDiseaseName,
            stade_nom: newDiseaseType,
            utilisateur_id: collaborator.id,
            nom_medecin_diagnostiqueur: `${collaborator.prenom} ${collaborator.nom}`.trim(),
            nom_image_originale: originalFileName,
            nom_image_renommee: renamedFileName,
            date_diagnostique: today
          });
        }

        const { error } = await supabase
          .from('categories_diagnostics')
          .insert(rowsToInsert);
        if (error) throw error;
      }
      setShowModal(false); 
      fetchData();
    } catch (err) {
      console.error(err);
      setError("Erreur lors de l'enregistrement.");
    }
  };

  const handleDeleteConfirm = async () => {
    setDeleteError("");
    const isValid = await verifyPassword(deletePassword.trim());
    if (!isValid) { 
      setDeleteError("Mot de passe incorrect."); 
      return; 
    }

    const { error } = await supabase
      .from('categories_diagnostics')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      setDeleteError("Erreur de suppression.");
    } else {
      setShowDeleteModal(false); 
      fetchData();
    }
  };

  const currentCategory = categoryOptions.find(c => c.name === newDiseaseName);
  const uniqueDiseases = categoryOptions.map(cat => cat.name);
  const uniqueDoctors = [...new Set(allDataGrouped.flatMap(group => group.avis.map(avi => avi.nom_medecin_diagnostiqueur)))].filter(Boolean).sort();

  return (
    <div className="min-h-screen bg-slate-900 text-white p-6">
      <GlobalMenu />
      <div className="max-w-6xl mx-auto mt-12">
        <header className="flex justify-between items-center mb-8">
          <div className="flex items-center gap-4">
            <ImageIcon className="text-cyan-400" size={30} />
            <h1 className="text-2xl font-bold uppercase tracking-widest italic">DIAGNOSTICS</h1>
          </div>
          <div className="flex bg-slate-800 p-1 rounded-2xl border border-white/5 shadow-2xl">
            <button onClick={() => setActiveTab('mes-diagnostics')} className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'mes-diagnostics' ? 'bg-cyan-500 text-white' : 'text-slate-500'}`}>MES DIAGNOSTICS</button>
            <button onClick={() => setActiveTab('disponibles')} className={`px-6 py-2 rounded-xl text-xs font-bold transition-all ${activeTab === 'disponibles' ? 'bg-cyan-500 text-white' : 'text-slate-500'}`}>CONTRIBUER</button>
          </div>
        </header>

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
                <div className="w-px h-10 bg-slate-600"></div>
                <div className="flex-1">
                  <p className="text-xs text-blue-400 mb-1">Médecin 2</p>
                  <p className="text-sm font-bold text-white">Dr. {collaborator.prenom} {collaborator.nom}</p>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="flex-1">
            <label className="text-[10px] font-black text-slate-500 uppercase ml-2 mb-1 block">Filtrer par Maladie</label>
            <select className="w-full bg-slate-800 border border-white/5 p-4 rounded-2xl text-xs font-bold outline-none" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)}>
              <option value="">Toutes les pathologies</option>
              {uniqueDiseases.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[10px] font-black text-slate-500 uppercase ml-2 mb-1 block">Filtrer par Médecin</label>
            <select className="w-full bg-slate-800 border border-white/5 p-4 rounded-2xl text-xs font-bold outline-none" value={searchDoctor} onChange={(e) => setSearchDoctor(e.target.value)}>
              <option value="">Tous les médecins</option>
              {uniqueDoctors.map(doc => <option key={doc} value={doc}>Dr. {doc}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredData.map(group => {
            const status = getAvisStatus(group);
            return (
              <div key={group.image_hash} className={`relative bg-slate-800 rounded-[2.5rem] overflow-hidden border transition-all ${status === 'validated' ? 'border-purple-500/50' : status === 'divergent' ? 'border-red-500/40' : 'border-white/5'}`}>
                <div className="relative h-56">
                  <ImageDisplay 
                    src={group.image_url} 
                    alt="Tympan" 
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-4 right-4 flex gap-2">
                    {status === 'validated' && <span className="bg-purple-600 px-3 py-1 rounded-full text-[8px] font-bold uppercase">Validé</span>}
                    {status === 'divergent' && <span className="bg-red-600 px-3 py-1 rounded-full text-[8px] font-bold uppercase">Divergent</span>}
                  </div>
                </div>

                <div className="p-6 space-y-3">
                  {group.avis.map((avi) => (
                    <div key={avi.id} className={`p-4 rounded-2xl border ${avi.utilisateur_id === currentUserId ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-slate-900 border-transparent'}`}>
                      <div className="flex justify-between items-start">
                        <div>
                          <p className="text-xs font-black text-cyan-400 uppercase">{avi.maladie_nom} {avi.stade_nom && avi.stade_nom !== 'Standard' ? `(${avi.stade_nom})` : ''}</p>
                          <p className="text-[10px] text-slate-500 italic mt-1">Dr. {avi.nom_medecin_diagnostiqueur}</p>
                        </div>
                        {avi.utilisateur_id === currentUserId && (
                          <div className="flex gap-1">
                            <button onClick={() => handleEditClick(avi)} className="p-2 text-slate-400 hover:text-cyan-400"><Edit size={14}/></button>
                            <button onClick={() => handleDeleteClick(avi)} className="p-2 text-red-400/50 hover:text-red-500"><Trash2 size={14}/></button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {activeTab === 'disponibles' && (
                    <button onClick={() => { setSelectedGroup(group); setModalMode('add'); setShowModal(true); setStep(1); }} className="w-full py-4 mt-2 bg-cyan-600 rounded-2xl font-black text-[10px] uppercase tracking-widest hover:bg-cyan-500 transition-all">Donner mon avis</button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 p-8 rounded-[2.5rem] w-full max-w-sm border border-white/10 shadow-2xl">
            <h2 className="text-xl font-black mb-8 text-center uppercase tracking-tighter">
              {step === 1 ? (modalMode === 'edit' ? "Modifier" : "Contribuer") : "Validation"}
            </h2>
            {step === 1 ? (
              <div className="space-y-6">
                {modalMode === 'edit' && (
                  <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl">
                    <Info size={20} className="text-blue-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Information</p>
                      <p className="text-xs text-blue-300">L'image source sera conservée. Seul votre diagnostic sera modifié.</p>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-500 uppercase ml-2">Pathologie</label>
                  <select value={newDiseaseName} onChange={(e) => { setNewDiseaseName(e.target.value); setNewDiseaseType('Standard'); }} className="w-full bg-slate-900 p-4 rounded-2xl border border-white/5 outline-none">
                    {categoryOptions.map(opt => <option key={opt.name} value={opt.name}>{opt.fullName}</option>)}
                  </select>
                </div>
                {currentCategory?.options.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-500 uppercase ml-2">Stade / Type</label>
                    <select value={newDiseaseType} onChange={(e) => setNewDiseaseType(e.target.value)} className="w-full bg-slate-900 p-4 rounded-2xl border border-white/5 outline-none">
                      <option value="Standard">Standard</option>
                      {currentCategory.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </div>
                )}
                <button onClick={() => setStep(2)} className="w-full py-5 bg-cyan-600 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-cyan-500">Continuer</button>
                <button onClick={() => setShowModal(false)} className="w-full text-slate-500 text-[10px] font-bold uppercase mt-4">Annuler</button>
              </div>
            ) : (
              <div className="space-y-6">
                <p className="text-[10px] text-slate-400 text-center uppercase font-bold px-4">Confirmez avec votre mot de passe</p>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Mot de passe" className="w-full bg-slate-900 p-4 rounded-2xl border border-white/5 outline-none text-center" autoFocus />
                {error && <p className="text-red-400 text-center text-[10px] font-bold uppercase">{error}</p>}
                <div className="flex gap-4">
                  <button onClick={() => setStep(1)} className="flex-1 py-5 bg-slate-700 rounded-2xl font-black uppercase text-xs">Retour</button>
                  <button onClick={handleConfirmAction} className="flex-1 py-5 bg-cyan-600 rounded-2xl font-black uppercase text-xs">Valider</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-slate-800 p-8 rounded-[2.5rem] w-full max-w-md border border-red-500/20">
            <h2 className="text-xl font-black text-red-500 mb-6 text-center uppercase">Supprimer le diagnostic ?</h2>
            <div className="flex items-start gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-2xl mb-6">
              <AlertTriangle size={24} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-400 uppercase mb-2">⚠️ Attention</p>
                <p className="text-sm text-red-300 mb-2">L'image source sera <span className="font-bold">définitivement supprimée</span>.</p>
                <p className="text-xs text-red-400">Cette action est <span className="font-bold">irréversible</span>.</p>
              </div>
            </div>
            <input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)} placeholder="Mot de passe" className="w-full bg-slate-900 p-4 rounded-2xl border border-white/5 outline-none text-center mb-4" autoFocus />
            {deleteError && <p className="text-red-400 text-xs text-center mb-4 font-bold uppercase">{deleteError}</p>}
            <div className="flex gap-4">
              <button onClick={() => setShowDeleteModal(false)} className="flex-1 py-5 bg-slate-700 rounded-2xl font-black uppercase text-xs hover:bg-slate-600">Annuler</button>
              <button onClick={handleDeleteConfirm} className="flex-1 py-5 bg-red-600 rounded-2xl font-black uppercase text-xs hover:bg-red-500">Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MesImages;