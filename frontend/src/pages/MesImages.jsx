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

const MALADIE_COLORS = {
  'OMA':       '#f87171',  // rouge
  'OSM':       '#fbbf24',  // jaune
  'Perfo':     '#60a5fa',  // bleu
  'Chole':     '#a78bfa',  // violet
  'PDR + Atel':'#f97316',  // orange
  'Normal':    '#34d399',  // vert
  'Autre':     '#94a3b8',  // gris
};

// Extraire les contours d'un annotation_details (ancien ou nouveau format)
const extractContours = (details) => {
  if (!details) return [];
  // Nouveau format : { contours: [...] }
  if (details.contours && Array.isArray(details.contours)) return details.contours;
  // Ancien format : { points_normalized: [...] } → contour unique sans maladie
  if (details.points_normalized?.length >= 3)
    return [{ maladie: null, color: '#22d3ee', points_normalized: details.points_normalized }];
  return [];
};

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
  const [annotationPayload, setAnnotationPayload] = useState(null);       // contour courant en cours de tracé
  const [annotationPreviewUrl, setAnnotationPreviewUrl] = useState('');
  const [annotationSourceUrl, setAnnotationSourceUrl] = useState('');
  const [contoursParMaladie, setContoursParMaladie] = useState({});       // { maladie: payload }
  const [currentAnnotMaladie, setCurrentAnnotMaladie] = useState(null);  // maladie en cours de tracé

  const [currentUser, setCurrentUser]     = useState(null);
  const [sessionMode, setSessionMode]     = useState('solo');
  const [collaborator, setCollaborator]   = useState(null);
  const [convertedImages, setConvertedImages] = useState({});

  // ── Annotations chargées depuis Supabase (hash → annotation_details) ──
  const [annotationsMap, setAnnotationsMap] = useState({});
  // ── États pour visualisation / édition contour depuis la carte ──────────
  const [editContourGroup,   setEditContourGroup]   = useState(null);
  const [editContourSrc,     setEditContourSrc]     = useState('');
  const [editContourMaladie, setEditContourMaladie] = useState(null); // maladie ciblée
  const [showEditContour,    setShowEditContour]    = useState(false);
  const [viewContourGroup,   setViewContourGroup]   = useState(null);

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

  /* ─── Image avec contour SVG superposé ─── */
  const ImageWithContour = ({ src, alt, className, annotations }) => {
    const [displaySrc, setDisplaySrc] = useState(src);
    const [isConverting, setIsConverting] = useState(false);
    const [imgSize, setImgSize] = useState({ w: 1, h: 1 });
    const imgRef = React.useRef(null);

    useEffect(() => {
      let cancelled = false;
      const load = async () => {
        if (isTiffUrl(src)) {
          setIsConverting(true);
          const converted = await convertTiffUrl(src);
          if (!cancelled) { setDisplaySrc(converted); setIsConverting(false); }
        } else { setDisplaySrc(src); }
      };
      load();
      return () => { cancelled = true; };
    }, [src]);

    const handleLoad = () => {
      if (imgRef.current)
        setImgSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight });
    };

    if (isConverting) {
      return (
        <div className={className + ' flex items-center justify-center bg-slate-700'}>
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400" />
        </div>
      );
    }

    // Extraire tous les contours de toutes les annotations reçues
    const allContours = (Array.isArray(annotations) ? annotations : annotations ? [annotations] : [])
      .flatMap(ann => extractContours(ann));
    const hasAny = allContours.some(c => c.points_normalized?.length >= 3);

    return (
      <div className={`relative ${className}`} style={{ overflow: 'hidden' }}>
        <img ref={imgRef} src={displaySrc} alt={alt} onLoad={handleLoad}
             className="w-full h-full object-cover"/>
        {hasAny && (
          <svg className="absolute inset-0 pointer-events-none"
               width={imgSize.w} height={imgSize.h}
               style={{ position: 'absolute', top: 0, left: 0 }}>
            {allContours.map((contour, idx) => {
              const pts = contour.points_normalized || [];
              if (pts.length < 3) return null;
              const color   = contour.color || '#22d3ee';
              const polyStr = pts.map(p =>
                `${(p.x * imgSize.w).toFixed(1)},${(p.y * imgSize.h).toFixed(1)}`).join(' ');
              return (
                <g key={idx}>
                  <polygon points={polyStr} fill={`${color}30`} stroke={color}
                           strokeWidth="2.5" strokeLinejoin="round"/>
                  {pts.map((p, i) => (
                    <circle key={i} cx={(p.x*imgSize.w).toFixed(1)} cy={(p.y*imgSize.h).toFixed(1)}
                            r="4" fill={color} stroke="white" strokeWidth="1.5"/>
                  ))}
                </g>
              );
            })}
          </svg>
        )}
        {!hasAny && (
          <div className="absolute inset-0 flex items-end justify-center pb-2 pointer-events-none">
            <span className="text-[9px] bg-black/50 text-slate-400 px-2 py-0.5 rounded-full uppercase tracking-wide">
              Aucun contour tracé
            </span>
          </div>
        )}
      </div>
    );
  };

  /* ─── ContourViewer : image + SVG haute qualité pour la modale ─── */
  const ContourViewer = ({ src, annotations }) => {
    const [displaySrc, setDisplaySrc] = useState(src);
    const [imgSize, setImgSize]       = useState({ w: 1, h: 1 });
    const imgRef = React.useRef(null);

    useEffect(() => {
      let cancelled = false;
      const load = async () => {
        if (isTiffUrl(src)) {
          const conv = await convertTiffUrl(src);
          if (!cancelled) setDisplaySrc(conv);
        } else setDisplaySrc(src);
      };
      load();
      return () => { cancelled = true; };
    }, [src]);

    const handleLoad = () => {
      if (imgRef.current)
        setImgSize({ w: imgRef.current.clientWidth, h: imgRef.current.clientHeight });
    };

    const allContours = (Array.isArray(annotations) ? annotations : annotations ? [annotations] : [])
      .flatMap(ann => extractContours(ann));

    return (
      <div className="relative inline-block max-h-[60vh]">
        <img ref={imgRef} src={displaySrc} alt="Tympan" onLoad={handleLoad}
             className="max-h-[60vh] max-w-full object-contain rounded-xl"/>
        {allContours.some(c => c.points_normalized?.length >= 3) && (
          <svg className="absolute inset-0 pointer-events-none"
               width={imgSize.w} height={imgSize.h}
               style={{ position: 'absolute', top: 0, left: 0 }}>
            {allContours.map((contour, idx) => {
              const pts = contour.points_normalized || [];
              if (pts.length < 3) return null;
              const color   = contour.color || '#22d3ee';
              const polyStr = pts.map(p =>
                `${(p.x*imgSize.w).toFixed(1)},${(p.y*imgSize.h).toFixed(1)}`).join(' ');
              return (
                <g key={idx}>
                  <polygon points={polyStr} fill={`${color}26`} stroke={color}
                           strokeWidth="2.5" strokeLinejoin="round"/>
                  {pts.map((p, i) => {
                    const cx = (p.x*imgSize.w).toFixed(1);
                    const cy = (p.y*imgSize.h).toFixed(1);
                    return (
                      <g key={i}>
                        <circle cx={cx} cy={cy} r="5" fill={color} stroke="white" strokeWidth="1.5"/>
                        <text x={Number(cx)+9} y={Number(cy)-8} fill="white" fontSize="11" fontWeight="bold"
                              style={{ textShadow: '0 0 3px rgba(0,0,0,0.9)' }}>{i+1}</text>
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    );
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
    if (error) { console.error('Erreur Fetch:', error.message); return; }
    setAllDataGrouped(groupData(data));

    // Charger les annotations — fetchData reçoit l'userId en paramètre
    // pour éviter le problème de closure sur currentUserId (null au premier render)
    try {
      const { data: annots, error: annotError } = await supabase
        .from('annotations_maladie')
        .select('image_hash, utilisateur_id, annotation_details, annotated_image_url');

      if (annotError) { console.error('❌ Erreur annotations:', annotError.message); return; }

      if (annots && annots.length > 0) {
        const map = {};
        annots.forEach(a => {
          const key = `${a.image_hash}__${a.utilisateur_id}`;
          if (!map[key]) map[key] = a;
        });
        setAnnotationsMap(map);
      }
    } catch (e) { console.warn('Annotations non chargées:', e); }
  };

  useEffect(() => {
    if (!currentUserId) return;
    fetchData();
  }, [currentUserId]);

  // Charger les annotations indépendamment dès le montage
  // (ne dépend pas de currentUserId — toutes les annotations sont publiques)
  useEffect(() => {
    const loadAnnotations = async () => {
      try {
        const { data: annots, error } = await supabase
          .from('annotations_maladie')
          .select('image_hash, utilisateur_id, annotation_details, annotated_image_url');
        if (error) { console.error('annotations load error:', error.message); return; }
        if (annots && annots.length > 0) {
          const map = {};
          annots.forEach(a => {
            const key = `${a.image_hash}__${a.utilisateur_id}`;
            if (!map[key]) map[key] = a;
          });
          setAnnotationsMap(map);
        }
      } catch (e) { console.warn('loadAnnotations error:', e); }
    };
    loadAnnotations();
  }, []); // ← au montage uniquement, sans dépendance

  const normalizeAvis = (maladie_nom, stade_nom) => {
    const maladies = (maladie_nom || '').split('+').map(m => m.trim());
    const stades   = (stade_nom   || '').split('/').map(s => s.trim());
    const pairs = maladies.map((m, i) => ({
      maladie: m.toLowerCase(),
      stade:   (stades[i] || 'standard').toLowerCase().replace('aucun', 'standard'),
    }));
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

  // ── Parsing multi-maladies ────────────────────────────────────────────────
  // Gère : "PDR + ATEL + CHOLE (STADE III / POST-SUP)", "OMA + Perfo", etc.
  const MALADIES_COMPOSEES_FILTRE = [
    'PDR + ATEL + CHOLE', 'PDR + Atel + Chole',   // triple → tester en premier
    'PDR + ATEL', 'PDR + Atel',                    // double
  ];

  const parseMaladiesFiltre = (maladieNom) => {
    if (!maladieNom) return [];
    // Retirer les stades entre parenthèses ex: "(STADE III / POST-SUP)"
    const nom = maladieNom.trim().replace(/\([^)]*\)/g, '').trim();
    // Tester les composées connues (plus longues en premier)
    for (const composee of MALADIES_COMPOSEES_FILTRE) {
      if (nom.toLowerCase().includes(composee.toLowerCase())) {
        const partiesComposee = new Set(
          composee.toLowerCase().split('+').map(p => p.trim())
        );
        const extras = nom
          .replace(new RegExp(composee.replace(/\+/g, '\\+'), 'i'), '')
          .split('+')
          .map(p => p.trim())
          .filter(p => p.length > 0 && !partiesComposee.has(p.toLowerCase()));
        return [composee, ...extras];
      }
    }
    // Pas de composée → split simple sur '+'
    return nom.split('+').map(p => p.trim()).filter(Boolean);
  };

  const imageAppartientAClasse = (maladieNom, classeFiltre) => {
    if (!maladieNom || !classeFiltre) return false;
    const normaliser = (s) =>
      s.trim().toLowerCase()
       .replace(/ \+ /g, '_').replace(/\+/g, '_')
       .replace(/ /g, '_');
    const filtreNorm = normaliser(classeFiltre);
    return parseMaladiesFiltre(maladieNom).some(m => {
      const mNorm = normaliser(m);
      return mNorm === filtreNorm || mNorm.includes(filtreNorm) || filtreNorm.includes(mNorm);
    });
  };
  // ─────────────────────────────────────────────────────────────────────────

  const filteredData = (activeTab === 'mes-diagnostics' ? myGroups : availableGroups).filter(group =>
    group.avis.some(avi => {
      const diseaseMatch = searchTerm   === '' || imageAppartientAClasse(avi.maladie_nom, searchTerm);
      const doctorMatch  = searchDoctor === '' || avi.nom_medecin_diagnostiqueur === searchDoctor;
      return diseaseMatch && doctorMatch;
    })
  );

  /* ─── Compteurs ─── */
  const myDiagnosticsCount = myGroups.length;       // total images dans "Mes diagnostics"
  const filteredCount      = filteredData.length;   // images affichées après filtres

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
    if (!diagnosticId) return;
    // Construire le tableau de contours depuis contoursParMaladie
    const contours = Object.entries(contoursParMaladie)
      .filter(([, payload]) => payload?.points_normalized?.length >= 3)
      .map(([maladie, payload]) => ({
        maladie,
        color:             MALADIE_COLORS[maladie] || '#22d3ee',
        points_normalized: payload.points_normalized,
        points_pixels:     payload.points_pixels,
        bounding_box:      payload.bounding_box,
        created_at:        new Date().toISOString(),
      }));
    if (contours.length === 0) return;
    const newDetails = { contours };

    // Upload preview du premier contour
    const firstPayload = Object.values(contoursParMaladie).find(p => p?.points_normalized?.length >= 3);
    const src     = annotationSourceUrl || selectedGroup?.image_url || '';
    const preview = firstPayload ? await buildAnnotatedImageDataUrl(src, firstPayload) : null;
    const fileName    = `annotation_${Date.now()}_${currentUserId}.png`;
    const storagePath = `annotations/${imageHash}/${fileName}`;

    if (preview) {
      const blob = await dataUrlToBlob(preview);
      const { error: uploadError } = await supabase.storage
        .from('images').upload(storagePath, blob, { contentType: 'image/png', upsert: true });
      if (uploadError) throw uploadError;
    }
    const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath);

    const { error: insertError } = await supabase
      .from('annotations_maladie')
      .insert([{
        diagnostic_id:        diagnosticId,
        image_hash:           imageHash,
        utilisateur_id:       currentUserId,
        image_original_url:   selectedGroup?.image_url || '',
        annotated_image_path: storagePath,
        annotated_image_url:  publicUrl,
        annotation_details:   newDetails,
      }]);
    if (insertError) throw insertError;
  };

  const handleAddAvis = async () => {
    setError('');
    const keys = Object.keys(multiSelections);
    if (keys.length === 0) { setError('Sélectionnez au moins une pathologie.'); return; }
    // Vérifier qu'au moins un contour a été tracé
    const contoursTracés = Object.keys(contoursParMaladie).filter(k => contoursParMaladie[k]);
    if (contoursTracés.length === 0) {
      setError('Veuillez tracer au moins un contour avant validation.');
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
      const medecins = [{ id: currentUserId, nom: doctorDisplayName }];
      if (sessionMode === 'collaboration' && collaborator) {
        medecins.push({ id: collaborator.id, nom: `${collaborator.prenom} ${collaborator.nom}`.trim() });
      }
      for (const medecin of medecins) {
        if (sessionMode === 'collaboration') {
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
      await saveAnnotationRecord({ diagnosticId: targetDiagnosticId, imageHash: baseData.image_hash });
      setShowModal(false);
      setMultiSelections({});
      setAnnotationPayload(null);
      setAnnotationPreviewUrl('');
      setAnnotationSourceUrl('');
      setContoursParMaladie({});
      setCurrentAnnotMaladie(null);
      fetchData();
    } catch (err) {
      console.error(err);
      setError("Erreur lors de l'enregistrement.");
    }
  };

  /* ─── Modifier contour depuis la carte (par maladie) ─── */
  const handleEditContour = async (group, maladie = null) => {
    setEditContourGroup(group);
    setEditContourMaladie(maladie);
    const src = isTiffUrl(group.image_url)
      ? await convertTiffUrl(group.image_url)
      : group.image_url;
    setEditContourSrc(src);
    setShowEditContour(true);
  };

  const handleEditContourSave = async (payload) => {
    if (!editContourGroup) return;
    try {
      const hash = editContourGroup.image_hash;
      const color = editContourMaladie ? (MALADIE_COLORS[editContourMaladie] || '#22d3ee') : '#22d3ee';

      // Récupérer l'annotation existante pour fusionner les contours
      const existingKey  = `${hash}__${currentUserId}`;
      const existingData = annotationsMap[existingKey]?.annotation_details;
      const existingContours = extractContours(existingData);

      // Remplacer le contour de cette maladie ou en ajouter un nouveau
      const newContour = {
        maladie:           editContourMaladie,
        color,
        points_normalized: payload.points_normalized,
        points_pixels:     payload.points_pixels,
        bounding_box:      payload.bounding_box,
        created_at:        new Date().toISOString(),
      };
      const updatedContours = [
        ...existingContours.filter(c => c.maladie !== editContourMaladie),
        newContour,
      ];
      const newDetails = { contours: updatedContours };

      // Upload image annotée avec TOUS les contours
      const src     = editContourSrc || editContourGroup.image_url;
      // Générer preview avec le nouveau contour uniquement
      const preview = await buildAnnotatedImageDataUrl(src, payload);
      const blob    = await dataUrlToBlob(preview);
      const fileName    = `annotation_${Date.now()}_${currentUserId}.png`;
      const storagePath = `annotations/${hash}/${fileName}`;

      const { error: upErr } = await supabase.storage
        .from('images').upload(storagePath, blob, { contentType: 'image/png', upsert: true });
      if (upErr) throw upErr;

      const { data: { publicUrl } } = supabase.storage.from('images').getPublicUrl(storagePath);
      const diagId = await getLatestDiagnosticIdForUser(hash, currentUserId);

      const { error: upsertErr } = await supabase
        .from('annotations_maladie')
        .upsert([{
          diagnostic_id:        diagId,
          image_hash:           hash,
          utilisateur_id:       currentUserId,
          image_original_url:   editContourGroup.image_url,
          annotated_image_path: storagePath,
          annotated_image_url:  publicUrl,
          annotation_details:   newDetails,
        }], { onConflict: 'image_hash,utilisateur_id' });
      if (upsertErr) throw upsertErr;

      setShowEditContour(false);
      setEditContourGroup(null);
      setEditContourMaladie(null);
      fetchData();
    } catch (e) {
      console.error('Erreur sauvegarde contour:', e);
    }
  };

  /* ─── Réinitialiser contour d'une maladie (ou tous) ─── */
  const handleResetContour = async (group, maladie = null) => {
    const hash = group.image_hash;
    try {
      if (maladie) {
        // Supprimer uniquement le contour de cette maladie
        const existingKey     = `${hash}__${currentUserId}`;
        const existingData    = annotationsMap[existingKey]?.annotation_details;
        const existingContours = extractContours(existingData);
        const updatedContours  = existingContours.filter(c => c.maladie !== maladie);
        const newDetails = { contours: updatedContours };
        const diagId = await getLatestDiagnosticIdForUser(hash, currentUserId);
        const { error } = await supabase
          .from('annotations_maladie')
          .upsert([{
            diagnostic_id:      diagId,
            image_hash:         hash,
            utilisateur_id:     currentUserId,
            image_original_url: group.image_url,
            annotation_details: newDetails,
          }], { onConflict: 'image_hash,utilisateur_id' });
        if (error) throw error;
      } else {
        // Supprimer tous les contours
        const { error } = await supabase
          .from('annotations_maladie')
          .delete()
          .eq('image_hash', hash)
          .eq('utilisateur_id', currentUserId);
        if (error) throw error;
      }
      fetchData();
    } catch (e) {
      console.error('Erreur réinitialisation contour:', e);
    }
  };

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
            <div>
              <h1 className="text-2xl font-bold uppercase tracking-widest italic">DIAGNOSTICS</h1>
              {/* ── Compteur principal sous le titre ── */}
              <p className="text-[11px] text-slate-400 mt-0.5">
                <span className="text-cyan-400 font-black">{myDiagnosticsCount}</span>
                {' '}image{myDiagnosticsCount !== 1 ? 's' : ''} diagnostiquée{myDiagnosticsCount !== 1 ? 's' : ''}
                {(searchTerm || searchDoctor) && activeTab === 'mes-diagnostics' && (
                  <span className="text-slate-500">
                    {' '}·{' '}
                    <span className="text-white font-bold">{filteredCount}</span> affichée{filteredCount !== 1 ? 's' : ''}
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Onglets avec badges compteurs */}
          <div className="flex bg-slate-800 p-1 rounded-2xl border border-white/5 shadow-2xl">
            <button
              onClick={() => setActiveTab('mes-diagnostics')}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'mes-diagnostics' ? 'bg-cyan-500 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              MES DIAGNOSTICS
              <span className={`min-w-[20px] px-1.5 py-0.5 rounded-full text-[9px] font-black text-center ${activeTab === 'mes-diagnostics' ? 'bg-white/25 text-white' : 'bg-slate-700 text-slate-400'}`}>
                {myDiagnosticsCount}
              </span>
            </button>
            <button
              onClick={() => setActiveTab('disponibles')}
              className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${activeTab === 'disponibles' ? 'bg-cyan-500 text-white' : 'text-slate-500 hover:text-slate-300'}`}
            >
              CONTRIBUER
              <span className={`min-w-[20px] px-1.5 py-0.5 rounded-full text-[9px] font-black text-center ${activeTab === 'disponibles' ? 'bg-white/25 text-white' : 'bg-slate-700 text-slate-400'}`}>
                {availableGroups.length}
              </span>
            </button>
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
        <div className="flex flex-col md:flex-row gap-4 mb-4">
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

        {/* ── Bande récap entre filtres et grille ── */}
        <div className="flex items-center justify-between mb-6 px-1">
          <p className="text-[11px] text-slate-500 uppercase font-bold tracking-wide">
            {activeTab === 'mes-diagnostics'
              ? <>
                  <span className="text-white">{filteredCount}</span>
                  {` image${filteredCount !== 1 ? 's' : ''} affichée${filteredCount !== 1 ? 's' : ''}`}
                  {(searchTerm || searchDoctor) ? ` sur ${myDiagnosticsCount} au total` : ''}
                </>
              : <>
                  <span className="text-white">{filteredCount}</span>
                  {` image${filteredCount !== 1 ? 's' : ''} disponible${filteredCount !== 1 ? 's' : ''} à diagnostiquer`}
                </>
            }
          </p>
          {(searchTerm || searchDoctor) && (
            <button
              onClick={() => { setSearchTerm(''); setSearchDoctor(''); }}
              className="text-[10px] text-cyan-400 hover:text-cyan-300 font-bold uppercase underline underline-offset-2 transition-colors"
            >
              Réinitialiser les filtres
            </button>
          )}
        </div>

        {/* Grille */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredData.length === 0 ? (
            <div className="col-span-3 flex flex-col items-center justify-center py-20 gap-3 text-slate-600">
              <ImageIcon size={48} />
              <p className="text-sm font-bold uppercase">
                {activeTab === 'mes-diagnostics' ? 'Aucun diagnostic trouvé' : 'Aucune image disponible'}
              </p>
            </div>
          ) : filteredData.map(group => {
            const status = getAvisStatus(group);
            return (
              <div key={group.image_hash} className={`relative bg-slate-800 rounded-[2.5rem] overflow-hidden border transition-all ${status === 'validated' ? 'border-purple-500/50' : status === 'divergent' ? 'border-red-500/40' : 'border-white/5'}`}>
                {(() => {
                  const myAvi        = group.avis.find(a => a.utilisateur_id === currentUserId);
                  const isMyDiag     = activeTab === 'mes-diagnostics' && !!myAvi;
                  // Récupérer TOUTES les annotations de cette image (tous médecins)
                  const allGroupAnnotations = Object.values(annotationsMap)
                    .filter(a => a.image_hash === group.image_hash)
                    .map(a => a.annotation_details)
                    .filter(Boolean);
                  // DEBUG
                  if (allGroupAnnotations.length > 0) {
                    const contourCount = allGroupAnnotations.flatMap(a => extractContours(a)).length;
                    if (contourCount !== allGroupAnnotations.length) {
                      console.log('🎨 image:', group.image_hash.slice(0,8),
                        '| annotation_details[0]:', JSON.stringify(allGroupAnnotations[0]).slice(0,120),
                        '| extractContours result:', extractContours(allGroupAnnotations[0]).length, 'contours');
                    }
                  }
                  // Annotation du médecin courant (pour savoir s'il a tracé le sien)
                  const myAnnotKey   = `${group.image_hash}__${currentUserId}`;
                  const myAnnotation = annotationsMap[myAnnotKey]?.annotation_details || null;
                  const hasContour   = allGroupAnnotations.some(a => a?.points_normalized?.length >= 3);
                  return (
                    <div
                      className={`relative h-56 ${isMyDiag ? 'cursor-pointer group/img' : ''}`}
                      onClick={isMyDiag ? () => setViewContourGroup(group) : undefined}
                      title={isMyDiag ? 'Cliquer pour voir le contour' : undefined}
                    >
                      <ImageWithContour
                        src={group.image_url}
                        alt="Tympan"
                        className="w-full h-full"
                        annotations={isMyDiag ? allGroupAnnotations : []}
                      />
                      {/* Hover hint */}
                      {isMyDiag && (
                        <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/30 transition-all flex items-center justify-center">
                          <span className="opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/70 backdrop-blur-sm text-white text-[10px] font-bold uppercase px-3 py-2 rounded-xl flex items-center gap-2">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                            Voir les contours
                          </span>
                        </div>
                      )}
                      {/* Badge statut */}
                      <div className="absolute top-3 right-3 flex gap-2 pointer-events-none">
                        {status === 'validated' && <span className="bg-purple-600 px-3 py-1 rounded-full text-[8px] font-bold uppercase shadow-lg">Validé</span>}
                        {status === 'divergent' && <span className="bg-red-600 px-3 py-1 rounded-full text-[8px] font-bold uppercase shadow-lg">Divergent</span>}
                      </div>
                      {/* Indicateur contour en bas à gauche */}
                      {isMyDiag && (
                        <div className="absolute bottom-2 left-3 pointer-events-none">
                          {(() => {
                            const myAnnotData  = annotationsMap[`${group.image_hash}__${currentUserId}`]?.annotation_details;
                            const myContours   = extractContours(myAnnotData).filter(c => c.points_normalized?.length >= 3);
                            const totalContours = allGroupAnnotations.flatMap(a => extractContours(a)).filter(c => c.points_normalized?.length >= 3).length;
                            return totalContours > 0
                              ? <span className="text-[9px] bg-cyan-500/80 backdrop-blur-sm text-white px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1">
                                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                                  {totalContours} contour{totalContours > 1 ? 's' : ''}
                                  {myContours.length > 0 && ` (${myContours.length} mien${myContours.length > 1 ? 's' : ''})`}
                                </span>
                              : <span className="text-[9px] bg-slate-700/80 backdrop-blur-sm text-slate-400 px-2 py-0.5 rounded-full font-bold uppercase">Aucun contour</span>;
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="p-6 space-y-3">
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
          <div className={`bg-slate-800 border border-white/10 shadow-2xl rounded-[2.5rem] w-full overflow-hidden flex ${modalMode === 'add' && step === 1 ? 'max-w-3xl flex-row' : 'max-w-sm flex-col p-8'}`}>

            {modalMode === 'add' && step === 1 && selectedGroup && (
              <div className="w-1/2 shrink-0 relative bg-slate-900 min-h-[440px] flex items-center justify-center p-4">
                <ImageDisplay
                  src={selectedGroup.image_url}
                  alt="Image à diagnostiquer"
                  className="w-full h-full object-contain"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-5">
                  <p className="text-[9px] text-cyan-400 uppercase font-bold tracking-widest mb-1">Image à diagnostiquer</p>
                  <p className="text-xs text-white font-bold truncate">
                    {selectedGroup.avis[0]?.nom_image_originale || 'Image'}
                  </p>
                </div>
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

            <div className={`flex flex-col justify-center ${modalMode === 'add' && step === 1 ? 'w-1/2 p-8' : 'w-full'}`}>
              <h2 className="text-xl font-black mb-8 text-center uppercase tracking-tighter">
                {step === 1 ? (modalMode === 'edit' ? 'Modifier le diagnostic' : 'Donner mon avis') : 'Confirmation'}
              </h2>

              {step === 1 ? (
                <div className="space-y-5">
                  {modalMode === 'edit' && (
                    <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/30 rounded-2xl">
                      <Info size={20} className="text-blue-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Information</p>
                        <p className="text-xs text-blue-300">L'image source sera conservée. Seul le diagnostic sera modifié.</p>
                      </div>
                    </div>
                  )}

                  {modalMode === 'add' ? (
                    <div className="space-y-4">
                      {/* Bouton de contour par maladie cochée */}
                      <div className="space-y-2">
                        <p className="text-[10px] font-black text-slate-400 uppercase ml-1">Contours par maladie</p>
                        {Object.keys(multiSelections).length === 0 ? (
                          <p className="text-[10px] text-slate-500 italic px-1">Cochez d'abord une pathologie ci-dessous</p>
                        ) : Object.keys(multiSelections).map(maladie => {
                          const color   = MALADIE_COLORS[maladie] || '#22d3ee';
                          const traced  = !!contoursParMaladie[maladie];
                          return (
                            <div key={maladie}
                              className="flex items-center justify-between gap-3 p-3 rounded-2xl border"
                              style={{ borderColor: `${color}60`, backgroundColor: `${color}15` }}
                            >
                              <div className="flex items-center gap-2">
                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}/>
                                <div>
                                  <p className="text-[10px] font-bold uppercase" style={{ color }}>
                                    {maladie}
                                  </p>
                                  <p className="text-[9px] text-slate-400">
                                    {traced ? '✓ Contour tracé' : 'Non tracé'}
                                  </p>
                                </div>
                              </div>
                              <button
                                onClick={() => openAnnotationModal(maladie)}
                                className="px-3 py-1.5 text-[10px] font-black uppercase rounded-xl text-white transition-all hover:opacity-80"
                                style={{ backgroundColor: color }}
                              >
                                {traced ? 'Modifier' : 'Tracer'}
                              </button>
                            </div>
                          );
                        })}
                      </div>
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
                    <button onClick={() => setStep(1)}    className="flex-1 py-5 bg-slate-700 rounded-2xl font-black uppercase text-xs hover:bg-slate-600">Retour</button>
                    <button onClick={handleConfirmAction} className="flex-1 py-5 bg-cyan-600 rounded-2xl font-black uppercase text-xs hover:bg-cyan-500">Valider</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── MODALE VISUALISATION CONTOUR (clic sur image) ─── */}
      {viewContourGroup && (() => {
        const hash         = viewContourGroup.image_hash;
        const annotKey     = `${hash}__${currentUserId}`;
        const myAnnotation = annotationsMap[annotKey]?.annotation_details || null;
        // Toutes les annotations de cette image
        const allAnnotations = Object.values(annotationsMap)
          .filter(a => a.image_hash === hash)
          .map(a => a.annotation_details)
          .filter(Boolean);
        const points       = allAnnotations.flatMap(a => a?.points_normalized || []);
        const hasContour   = allAnnotations.some(a => (a?.points_normalized?.length || 0) >= 3);
        const imgUrl       = viewContourGroup.image_url;
        const myAvi        = viewContourGroup.avis.find(a => a.utilisateur_id === currentUserId);

        return (
          <div
            className="fixed inset-0 z-[55] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-4"
            onClick={e => { if (e.target === e.currentTarget) setViewContourGroup(null); }}
          >
            <div className="w-full max-w-3xl bg-slate-800 border border-white/10 rounded-[2rem] overflow-hidden shadow-2xl flex flex-col">

              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
                <div className="flex items-center gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full ${hasContour ? 'bg-cyan-400' : 'bg-slate-500'}`} />
                  <div>
                    <p className="text-sm font-black uppercase tracking-wider text-white">
                      {myAvi?.maladie_nom || 'Diagnostic'}
                      {myAvi?.stade_nom && myAvi.stade_nom !== 'Standard' ? ` (${myAvi.stade_nom})` : ''}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5 uppercase">
                      {hasContour ? `${points.length} points · Contour tracé` : 'Aucun contour pour cette image'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setViewContourGroup(null)}
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-xl transition-all"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
              </div>

              {/* Image + contour SVG plein écran */}
              <div className="relative bg-slate-900 flex items-center justify-center" style={{ minHeight: '400px' }}>
                <ContourViewer src={imgUrl} annotations={allAnnotations} />
                {!hasContour && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="bg-slate-800/80 backdrop-blur-sm border border-white/10 rounded-2xl px-6 py-4 text-center">
                      <p className="text-slate-400 text-xs font-bold uppercase">Aucun contour tracé</p>
                      <p className="text-slate-500 text-[10px] mt-1">Cliquez sur "Tracer le contour" pour commencer</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Légende couleurs médecins */}
              {hasContour && (() => {
                const COLORS = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#f87171'];
                const annotEntries = Object.values(annotationsMap).filter(a => a.image_hash === hash);
                return (
                  <div className="px-6 py-3 border-t border-white/5 flex flex-wrap gap-3">
                    {annotEntries.map((a, i) => {
                      const doc = viewContourGroup.avis.find(v => v.utilisateur_id === a.utilisateur_id);
                      return (
                        <div key={i} className="flex items-center gap-1.5">
                          <div className="w-3 h-3 rounded-full border-2 border-white/30"
                               style={{ backgroundColor: COLORS[i % COLORS.length] }}/>
                          <span className="text-[10px] text-slate-400">
                            {doc ? `Dr. ${doc.nom_medecin_diagnostiqueur}` : 'Médecin'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* Actions — un bouton par maladie diagnostiquée */}
              <div className="p-5 border-t border-white/10 space-y-3">
                {(() => {
                  const myAnnotData  = annotationsMap[`${hash}__${currentUserId}`]?.annotation_details;
                  const myContours   = extractContours(myAnnotData);
                  // Maladies diagnostiquées par le médecin courant sur cette image
                  const maladies = (myAvi?.maladie_nom || '')
                    .split('+').map(m => m.trim()).filter(Boolean);
                  const targets = maladies.length > 0 ? maladies : [null];
                  return (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {targets.map(maladie => {
                          const color    = maladie ? (MALADIE_COLORS[maladie] || '#22d3ee') : '#22d3ee';
                          const existing = myContours.find(c => c.maladie === maladie);
                          return (
                            <button key={maladie || 'global'}
                              onClick={async () => {
                                setViewContourGroup(null);
                                await handleEditContour(viewContourGroup, maladie);
                              }}
                              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl text-[11px] font-black uppercase tracking-wide transition-all text-white"
                              style={{ backgroundColor: color, minWidth: '140px' }}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828A2 2 0 0110 16.414H8v-2a2 2 0 01.586-1.414z"/>
                              </svg>
                              {existing ? `Modifier` : `Tracer`} {maladie || 'contour'}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        {myContours.length > 0 && (
                          <button
                            onClick={async () => {
                              if (window.confirm('Supprimer tous les contours de cette image ?')) {
                                await handleResetContour(viewContourGroup, null);
                                setViewContourGroup(null);
                              }
                            }}
                            className="flex items-center gap-2 px-4 py-2.5 bg-red-600/80 hover:bg-red-500 rounded-2xl text-[11px] font-black uppercase tracking-wide transition-all"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a1 1 0 001-1h4a1 1 0 001 1m-6 0h6"/>
                            </svg>
                            Tout réinitialiser
                          </button>
                        )}
                        <button onClick={() => setViewContourGroup(null)}
                          className="ml-auto px-5 py-2.5 bg-slate-700 hover:bg-slate-600 rounded-2xl text-[11px] font-black uppercase tracking-wide transition-all text-slate-300">
                          Fermer
                        </button>
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ─── MODALE ÉDITION CONTOUR DEPUIS LA CARTE ─── */}
      {showEditContour && editContourSrc && (
        <AnnotationCanvas
          imageSrc={editContourSrc}
          initialPoints={(() => {
            if (!editContourGroup) return [];
            const key     = `${editContourGroup.image_hash}__${currentUserId}`;
            const details = annotationsMap[key]?.annotation_details;
            const contours = extractContours(details);
            const match   = contours.find(c => c.maladie === editContourMaladie);
            return match?.points_normalized || [];
          })()}
          annotationColor={editContourMaladie ? (MALADIE_COLORS[editContourMaladie] || '#22d3ee') : '#22d3ee'}
          diseaseName={editContourMaladie || ''}
          onClose={() => { setShowEditContour(false); setEditContourGroup(null); setEditContourMaladie(null); }}
          onSave={handleEditContourSave}
        />
      )}

      {showAnnotationModal && annotationSourceUrl && (
        <AnnotationCanvas
          imageSrc={annotationSourceUrl}
          initialPoints={annotationPayload?.points_normalized || []}
          annotationColor={currentAnnotMaladie ? (MALADIE_COLORS[currentAnnotMaladie] || '#22d3ee') : '#22d3ee'}
          diseaseName={currentAnnotMaladie || ''}
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