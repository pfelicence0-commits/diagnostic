import React, { useState, useEffect } from 'react';
import { Upload, Activity, Image as ImageIcon, CheckCircle2, X } from 'lucide-react';
import GlobalMenu from '../components/GlobalMenu';
import { supabase } from '../supabaseClient'; 
import UTIF from 'utif';

const categoryOptions = [
  { name: 'OMA', fullName: 'Otite Moyenne Aiguë', options: ['Congestive', 'Suppurée', 'Perforée'], icon: '🔴' },
  { name: 'OSM', fullName: 'Otite Séromuqueuse', options: ['Aucun'], icon: '🟡' },
  { name: 'Perfo', fullName: 'Perforation', options: ['Marginale', 'Non Marginale'], icon: '🔵' },
  { name: 'Chole', fullName: 'Cholestéatome', options: ['Atticale', 'Post-Sup', 'Attic + Post-Sup'], icon: '🟣' },
  { name: 'PDR + Atel', fullName: 'Poche de Rétraction + Atélectasie', options: ['Stade I', 'Stade II', 'Stade III'], icon: '🟠' },
  { name: 'Normal', fullName: 'Tympan Normal', options: ['Aucun'], icon: '🟢' },
  { name: 'Autre', fullName: 'Autre Pathologie', options: ['Aucun'], icon: '⚪' }
];

export default function Accueil() {
  const [fileQueue, setFileQueue] = useState([]); 
  const [currentIndex, setCurrentIndex] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [selections, setSelections] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [collaborator, setCollaborator] = useState(null);
  const [sessionMode, setSessionMode] = useState('solo');
  const [isLoadingImages, setIsLoadingImages] = useState(false);

  useEffect(() => {
    const initSession = async () => {
      const storedUser = localStorage.getItem('user');
      const storedCollab = localStorage.getItem('collaborateur');
      const storedMode = localStorage.getItem('mode_session');

      if (storedUser) {
        const userProfile = JSON.parse(storedUser);
        setCurrentUser(userProfile);
        console.log('Utilisateur chargé:', userProfile);
      }

      if (storedCollab) {
        const collabProfile = JSON.parse(storedCollab);
        setCollaborator(collabProfile);
        console.log('Collaborateur chargé:', collabProfile);
      }

      setSessionMode(storedMode || 'solo');
    };
    
    initSession();
  }, []);

  // Fonction pour convertir TIF/TIFF en PNG avec UTIF
  const convertTiffToPng = async (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          console.log(`🔄 Conversion TIF en cours: ${file.name}`);
          
          // Lire le buffer TIFF
          const buffer = e.target.result;
          const ifds = UTIF.decode(buffer);
          
          if (!ifds || ifds.length === 0) {
            throw new Error('Impossible de décoder le TIFF');
          }
          
          // Décoder la première page du TIFF
          UTIF.decodeImage(buffer, ifds[0]);
          const ifd = ifds[0];
          
          // Créer un canvas pour dessiner l'image
          const canvas = document.createElement('canvas');
          canvas.width = ifd.width;
          canvas.height = ifd.height;
          const ctx = canvas.getContext('2d');
          
          // Convertir les données TIFF en RGBA
          const rgba = UTIF.toRGBA8(ifd);
          
          // Créer ImageData et dessiner sur le canvas
          const imageData = new ImageData(
            new Uint8ClampedArray(rgba),
            ifd.width,
            ifd.height
          );
          ctx.putImageData(imageData, 0, 0);
          
          // Convertir le canvas en PNG haute qualité (1.0 = 100%)
          const pngDataUrl = canvas.toDataURL('image/png', 1.0);
          
          console.log(`✅ Conversion réussie: ${file.name} (${ifd.width}x${ifd.height})`);
          resolve(pngDataUrl);
        } catch (error) {
          console.error('❌ Erreur conversion TIFF:', error);
          reject(error);
        }
      };
      
      reader.onerror = () => reject(new Error('Erreur lecture fichier'));
      reader.readAsArrayBuffer(file);
    });
  };

  // Fonction pour créer un aperçu (avec conversion si nécessaire)
  const createImagePreview = async (file) => {
    const extension = file.name.split('.').pop().toLowerCase();
    
    // Cas 1 : TIF/TIFF - Convertir en PNG
    if (['tif', 'tiff'].includes(extension)) {
      try {
        return await convertTiffToPng(file);
      } catch (error) {
        console.warn(`⚠️ Échec conversion ${file.name}:`, error);
        // Créer un placeholder simple en cas d'échec
        return 'data:image/svg+xml;base64,' + btoa(`
          <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
            <rect fill="#1e293b" width="400" height="300"/>
            <text x="200" y="150" fill="#ef4444" font-size="14" text-anchor="middle">
              Erreur conversion TIF
            </text>
          </svg>
        `);
      }
    }
    
    // Cas 2 : Formats standards (JPG, PNG, GIF, WEBP, BMP)
    if (file.type && file.type.startsWith('image/')) {
      return URL.createObjectURL(file);
    }
    
    // Cas 3 : Autres formats non supportés
    console.warn(`Format non supporté pour l'aperçu: ${extension}`);
    return 'data:image/svg+xml;base64,' + btoa(`
      <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
        <rect fill="#1e293b" width="400" height="300"/>
        <text x="200" y="150" fill="#94a3b8" font-size="14" text-anchor="middle">
          Format ${extension.toUpperCase()} non supporté
        </text>
      </svg>
    `);
  };

  const handleFolderChange = async (e) => {
    const files = Array.from(e.target.files);
    
    // Liste des extensions d'images acceptées
    const imageExtensions = [
      'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 
      'tif', 'tiff', 'svg', 'ico', 'heic', 'heif',
      'raw', 'cr2', 'nef', 'orf', 'sr2'
    ];
    
    const imageFiles = files.filter(file => {
      if (file.type && file.type.startsWith('image/')) return true;
      const extension = file.name.split('.').pop().toLowerCase();
      return imageExtensions.includes(extension);
    });
    
    if (imageFiles.length > 0) {
      console.log(`✅ ${imageFiles.length} image(s) détectée(s):`, imageFiles.map(f => f.name));
      
      setIsLoadingImages(true);
      setSaveMessage('🔄 Conversion des images en cours...');
      
      try {
        // Créer les previews de manière asynchrone (avec conversion si nécessaire)
        const queuePromises = imageFiles.map(async (file, index) => {
          const preview = await createImagePreview(file);
          const extension = file.name.split('.').pop().toLowerCase();
          
          return {
            id: index, 
            file, 
            preview,
            status: 'pending', 
            name: file.name,
            extension: extension
          };
        });
        
        // Attendre que toutes les conversions soient terminées
        const queue = await Promise.all(queuePromises);
        
        setFileQueue(queue);
        setCurrentIndex(0);
        setSelectedFile(queue[0].file);
        setSelectedImage(queue[0].preview);
        
        setSaveMessage('');
      } catch (error) {
        console.error('Erreur lors du chargement des images:', error);
        setSaveMessage('❌ Erreur lors du chargement des images');
      } finally {
        setIsLoadingImages(false);
      }
    } else {
      console.warn('⚠️ Aucune image trouvée');
      setSaveMessage("⚠️ Aucune image trouvée. Formats acceptés: JPG, PNG, TIF, TIFF, etc.");
    }
  };

  const calculateHash = async (file) => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  };

  const handleUpload = async () => {
    if (!selectedFile || Object.keys(selections).length === 0 || !currentUser) {
      setSaveMessage("⚠️ Sélectionner une pathologie");
      return;
    }

    setIsSaving(true);
    try {
      const imageHash = await calculateHash(selectedFile);
      
      const { data: existingDiagnostics, error: checkError } = await supabase
        .from('categories_diagnostics')
        .select('utilisateur_id')
        .eq('image_hash', imageHash);

      if (checkError) throw checkError;

      const medecinsPresents = sessionMode === 'collaboration' && collaborator
        ? [currentUser, collaborator]
        : [currentUser];

      const medicinsADiagnostiquer = medecinsPresents.filter(medecin => {
        const dejaDiagnostique = existingDiagnostics?.some(
          diag => diag.utilisateur_id === medecin.id
        );
        if (dejaDiagnostique) {
          console.log(`⚠️ Le médecin ${medecin.prenom} ${medecin.nom} a déjà diagnostiqué cette image`);
        }
        return !dejaDiagnostique;
      });

      if (medicinsADiagnostiquer.length === 0) {
        setSaveMessage("⚠️ Vous avez déjà diagnostiqué cette image");
        setTimeout(() => {
          if (currentIndex < fileQueue.length - 1) {
            const next = currentIndex + 1;
            setCurrentIndex(next);
            setSelectedFile(fileQueue[next].file);
            setSelectedImage(fileQueue[next].preview);
            setSelections({});
            setSaveMessage('');
          }
        }, 2000);
        setIsSaving(false);
        return;
      }

      const { count } = await supabase
        .from('categories_diagnostics')
        .select('*', { count: 'exact', head: true })
        .eq('image_hash', imageHash);

      const nbAvisExistants = count || 0;
      const totalNombreAvis = nbAvisExistants + medicinsADiagnostiquer.length;

      const fileExtension = selectedFile.name.split('.').pop();
      const baseName = selectedFile.name.split('.').slice(0, -1).join('.');
      const diseaseKeys = Object.keys(selections);
      const modeLabel = sessionMode === 'collaboration' ? 'Conjoint' : 'Simple';
      
      const maladiesDetails = diseaseKeys.map(key => {
        const stage = selections[key].stage;
        return (stage && stage !== 'Aucun') ? `${key}_${stage}` : key;
      }).join('_');

      const records = [];

      for (const doc of medicinsADiagnostiquer) {
        const prenomMedecin = doc.prenom || '';
        const nomMedecin = doc.nom || '';
        const nomComplet = `${prenomMedecin} ${nomMedecin}`.trim() || "Médecin Inconnu";

        const nouveauNomFichier = `${baseName}_${totalNombreAvis}_${modeLabel}_${maladiesDetails}_${doc.id}.${fileExtension}`.replace(/\s+/g, '');
        const storagePath = `diagnostics/${diseaseKeys[0].toLowerCase()}/${nouveauNomFichier}`;

        const { error: uploadError } = await supabase.storage
          .from('images')
          .upload(storagePath, selectedFile, { upsert: true });

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath);

        records.push({
          image_hash: imageHash,
          image_url: publicUrl,
          utilisateur_id: doc.id,
          nom_medecin_diagnostiqueur: nomComplet,
          maladie_nom: diseaseKeys.join(' + '),
          stade_nom: diseaseKeys.map(k => selections[k].stage || 'Aucun').join(' / '),
          nom_image_originale: selectedFile.name,
          nom_image_renommee: nouveauNomFichier,
          path_image_final: storagePath,
          date_diagnostique: new Date().toISOString().split('T')[0]
        });
      }

      let successCount = 0;

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        
        if (sessionMode === 'collaboration') {
          const { error } = await supabase.rpc('insert_diagnostic_collaboration', {
            p_image_hash: record.image_hash,
            p_image_url: record.image_url,
            p_utilisateur_id: record.utilisateur_id,
            p_nom_medecin: record.nom_medecin_diagnostiqueur,
            p_maladie_nom: record.maladie_nom,
            p_stade_nom: record.stade_nom,
            p_nom_image_originale: record.nom_image_originale,
            p_nom_image_renommee: record.nom_image_renommee,
            p_path_image_final: record.path_image_final,
            p_date_diagnostique: record.date_diagnostique
          });
          
          if (error) throw error;
        } else {
          const { error } = await supabase
            .from('categories_diagnostics')
            .insert([record]);
          
          if (error) throw error;
        }
        
        successCount++;
      }

      if (successCount > 0) {
        setSaveMessage(`✅ ${successCount} avis enregistré(s) !`);
      }

      setFileQueue(prev => prev.map((item, idx) => idx === currentIndex ? { ...item, status: 'uploaded' } : item));
      
      setTimeout(() => {
         if (currentIndex < fileQueue.length - 1) {
           const next = currentIndex + 1;
           setCurrentIndex(next);
           setSelectedFile(fileQueue[next].file);
           setSelectedImage(fileQueue[next].preview);
           setSelections({});
           setSaveMessage('');
         }
      }, 1500);

    } catch (err) {
      console.error('❌ Erreur lors de l\'upload:', err);
      setSaveMessage(`❌ Erreur: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="h-screen flex flex-col bg-[#0f172a] text-white overflow-hidden">
      <GlobalMenu />
      
      <div className="flex flex-1 p-6 gap-6 mt-14 overflow-hidden h-[calc(100vh-60px)]">
        
        {/* FILE D'ATTENTE */}
        <div className="w-80 bg-slate-800/50 rounded-3xl border border-white/10 p-4 flex flex-col h-full">
          <div className="flex items-center justify-between border-b border-white/10 pb-3 shrink-0">
            <div className="flex items-center gap-2">
              <ImageIcon size={18} className="text-cyan-400" />
              <h2 className="text-xs font-bold uppercase tracking-widest">File d'attente</h2>
              {fileQueue.length > 0 && (
                <span className="bg-cyan-500/20 text-cyan-400 px-2 py-0.5 rounded-full text-[10px] font-bold">
                  {fileQueue.filter(f => f.status === 'uploaded').length}/{fileQueue.length}
                </span>
              )}
            </div>
            {fileQueue.length > 0 && (
              <button
                onClick={() => {
                  const pendingCount = fileQueue.filter(f => f.status === 'pending').length;
                  const message = pendingCount > 0 
                    ? `${pendingCount} image(s) non validée(s) seront perdues. Continuer ?`
                    : 'Vider la file d\'attente ?';
                  
                  if (window.confirm(message)) {
                    setFileQueue([]);
                    setCurrentIndex(null);
                    setSelectedFile(null);
                    setSelectedImage(null);
                    setSelections({});
                    setSaveMessage('');
                  }
                }}
                className="p-2 hover:bg-red-500/20 rounded-lg transition-all group"
                title="Vider et changer de dossier"
              >
                <X size={16} className="text-slate-400 group-hover:text-red-400 transition-colors" />
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto mt-4 space-y-3 custom-scrollbar">
            {isLoadingImages && (
              <div className="flex items-center justify-center p-8">
                <Activity className="animate-spin text-cyan-400" size={32} />
              </div>
            )}
            {fileQueue.map((item, idx) => (
              <div 
                key={idx} 
                onClick={() => { if (!isSaving && !isLoadingImages) { setCurrentIndex(idx); setSelectedFile(item.file); setSelectedImage(item.preview); }}} 
                className={`relative cursor-pointer rounded-2xl overflow-hidden border-2 transition-all ${currentIndex === idx ? 'border-cyan-400' : 'border-transparent opacity-50'}`}
              >
                <img src={item.preview} alt="mini" className="w-full h-24 object-cover" />
                {item.status === 'uploaded' && (
                  <div className="absolute inset-0 bg-green-500/60 flex items-center justify-center">
                    <CheckCircle2 size={30} className="text-white" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* COLONNE DIAGNOSTIC */}
        <div className="w-[400px] bg-slate-800/30 rounded-3xl p-6 border border-white/10 flex flex-col h-full">
          <h3 className="text-[10px] font-black text-slate-500 uppercase mb-6 tracking-widest shrink-0">Diagnostic</h3>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
            {currentUser && (
              <div className="mb-6 p-4 bg-cyan-500/10 rounded-2xl border border-cyan-500/30">
                <p className="text-[10px] font-bold text-cyan-400 uppercase mb-1">
                  {sessionMode === 'collaboration' ? 'Session Collaborative' : 'Médecin connecté'}
                </p>
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="text-[9px] text-slate-400 mb-1">Médecin 1</p>
                    <p className="text-sm font-bold text-white">Dr. {currentUser.prenom} {currentUser.nom}</p>
                  </div>
                  {sessionMode === 'collaboration' && collaborator && (
                    <>
                      <div className="w-px h-10 bg-slate-600"></div>
                      <div className="flex-1">
                        <p className="text-[9px] text-blue-400 mb-1">Médecin 2</p>
                        <p className="text-sm font-bold text-white">Dr. {collaborator.prenom} {collaborator.nom}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {categoryOptions.map((cat, idx) => (
                <div key={idx} className={`p-4 border rounded-2xl transition-all ${selections[cat.name] ? 'border-cyan-400 bg-cyan-400/10' : 'border-white/5 bg-white/5'}`}>
                  <div className="flex items-center gap-4">
                    <span className="text-xl">{cat.icon}</span>
                    <div className="flex-1">
                      <div className="text-xs font-bold">{cat.name}</div>
                      <div className="text-[9px] text-slate-400 uppercase">{cat.fullName}</div>
                    </div>
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 accent-cyan-400" 
                      checked={!!selections[cat.name]} 
                      onChange={(e) => {
                        const newSels = {...selections};
                        if(e.target.checked) newSels[cat.name] = {stage: 'Aucun'};
                        else delete newSels[cat.name];
                        setSelections(newSels);
                      }} 
                    />
                  </div>
                  {selections[cat.name] && cat.options[0] !== 'Aucun' && (
                    <select 
                      className="mt-3 bg-slate-900 text-[10px] p-3 rounded-xl border border-cyan-500/30 w-full text-white"
                      value={selections[cat.name].stage}
                      onChange={(e) => setSelections({...selections, [cat.name]: {stage: e.target.value}})}
                    >
                      <option value="Aucun">Stade...</option>
                      {cat.options.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COLONNE IMAGE + BOUTON */}
        <div className="flex-1 flex flex-col h-full min-h-0">
          
          <div className="flex-1 bg-slate-900/50 border-2 border-dashed border-white/5 rounded-[2.5rem] flex items-center justify-center relative overflow-hidden mb-4">
            {!selectedImage ? (
              <label className="cursor-pointer text-center">
                <Upload className="text-cyan-400 mx-auto mb-4" size={32} />
                <p className="font-black uppercase text-[10px] text-slate-400">Charger dossier</p>
                <input type="file" className="hidden" webkitdirectory="true" directory="true" multiple onChange={handleFolderChange} />
              </label>
            ) : (
              <img 
                src={selectedImage} 
                className="max-h-full max-w-full object-contain" 
                alt="Vue" 
              />
            )}
          </div>

          <div className="shrink-0">
            <button 
              onClick={handleUpload} 
              disabled={isSaving || isLoadingImages || !selectedFile || Object.keys(selections).length === 0} 
              className={`w-full py-5 rounded-[2rem] font-black text-xs uppercase tracking-widest transition-all ${
                (isSaving || isLoadingImages) ? 'bg-slate-700 cursor-not-allowed' : 'bg-cyan-600 hover:bg-cyan-500 active:scale-95'
              }`}
            >
              {isSaving ? <Activity className="animate-spin mx-auto" /> : 'Valider le diagnostic'}
            </button>
            
            {saveMessage && (
              <div className="mt-3 p-3 rounded-2xl text-center text-[10px] bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                {saveMessage}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}