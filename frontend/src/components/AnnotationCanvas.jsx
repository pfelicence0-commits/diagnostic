import React, { useEffect, useMemo, useRef, useState } from 'react';

const AnnotationCanvas = ({ 
  imageSrc, 
  onClose, 
  onSave, 
  initialPoints = [],
  annotationColor = '#22d3ee',
  diseaseName = ''
}) => {
  const imageRef = useRef(null);
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [displaySize, setDisplaySize] = useState({ width: 0, height: 0 });
  const [points, setPoints] = useState(initialPoints);
  const [error, setError] = useState('');

  useEffect(() => {
    setPoints(initialPoints);
  }, [initialPoints]);

  const hexToRgba = (hex, alpha) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  };

  const handleImageLoad = () => {
    if (!imageRef.current) return;
    setNaturalSize({
      width: imageRef.current.naturalWidth,
      height: imageRef.current.naturalHeight,
    });
    setDisplaySize({
      width: imageRef.current.clientWidth,
      height: imageRef.current.clientHeight,
    });
  };

  useEffect(() => {
    const handleResize = () => {
      if (!imageRef.current) return;
      setDisplaySize({
        width: imageRef.current.clientWidth,
        height: imageRef.current.clientHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const pointsForDisplay = useMemo(() => {
    return points.map((point) => ({
      x: point.x * displaySize.width,
      y: point.y * displaySize.height,
    }));
  }, [points, displaySize.width, displaySize.height]);

  const handleAddPoint = (event) => {
    if (!imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    setError('');
    setPoints((prev) => [...prev, { x, y }]);
  };

  const handleUndo = () => setPoints((prev) => prev.slice(0, -1));

  const handleReset = () => {
    setPoints([]);
    setError('');
  };

  const buildAnnotationPayload = () => {
    const pixelPoints = points.map((point) => ({
      x: Math.round(point.x * naturalSize.width),
      y: Math.round(point.y * naturalSize.height),
    }));

    const xs = pixelPoints.map((p) => p.x);
    const ys = pixelPoints.map((p) => p.y);

    return {
      version: 1,
      shape: 'polygon',
      image: { width: naturalSize.width, height: naturalSize.height },
      points_normalized: points,
      points_pixels: pixelPoints,
      bounding_box: {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(0, Math.max(...xs) - Math.min(...xs)),
        height: Math.max(0, Math.max(...ys) - Math.min(...ys)),
      },
      color: annotationColor,
      disease_name: diseaseName,
      created_at: new Date().toISOString(),
    };
  };

  const handleSave = () => {
    if (points.length < 3) {
      setError('Le contour doit contenir au moins 3 points.');
      return;
    }
    if (!naturalSize.width || !naturalSize.height) {
      setError('Image non chargée correctement.');
      return;
    }
    onSave(buildAnnotationPayload());
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/90 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-5xl bg-slate-800 border border-white/10 rounded-[2rem] overflow-hidden">
        
        {/* En-tête */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div 
              className="w-6 h-6 rounded border-2" 
              style={{ backgroundColor: annotationColor, borderColor: annotationColor }}
            />
            <div>
              <h3 className="text-sm font-black uppercase tracking-wider text-cyan-400">
                Dessiner le contour {diseaseName && `- ${diseaseName}`}
              </h3>
              <p className="text-[9px] text-slate-400 uppercase mt-0.5">
                Cliquez sur l'image pour tracer le polygone
              </p>
            </div>
          </div>
          
          {points.length > 0 && (
            <div className="flex items-center gap-2 bg-slate-700/50 px-3 py-1.5 rounded-lg">
              <span className="text-[10px] text-slate-400 uppercase">Points:</span>
              <span className="text-sm font-bold" style={{ color: annotationColor }}>
                {points.length}
              </span>
            </div>
          )}
        </div>

        <div className="p-6">
          <div className="relative w-full bg-slate-900 rounded-2xl border border-white/10 p-3 min-h-[420px] flex items-center justify-center">
            <div className="relative inline-block max-h-[70vh]">
              <img
                ref={imageRef}
                src={imageSrc}
                alt="Annotation"
                onLoad={handleImageLoad}
                className="max-h-[65vh] w-auto object-contain rounded-xl"
              />

              <svg
                width={displaySize.width}
                height={displaySize.height}
                className="absolute inset-0 cursor-crosshair"
                onClick={handleAddPoint}
              >
                {pointsForDisplay.length > 1 && (
                  <polyline
                    points={pointsForDisplay.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={annotationColor}
                    strokeWidth="2"
                  />
                )}

                {pointsForDisplay.length > 2 && (
                  <polygon
                    points={pointsForDisplay.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill={hexToRgba(annotationColor, 0.2)}
                    stroke={annotationColor}
                    strokeWidth="3"
                  />
                )}

                {pointsForDisplay.map((point, index) => (
                  <g key={`${point.x}-${point.y}-${index}`}>
                    <circle 
                      cx={point.x} cy={point.y} r="5" 
                      fill={annotationColor} stroke="white" strokeWidth="1.5"
                    />
                    <text 
                      x={point.x + 10} y={point.y - 10} 
                      fill="white" fontSize="11" fontWeight="bold"
                      style={{ textShadow: '0 0 3px rgba(0,0,0,0.8)' }}
                    >
                      {index + 1}
                    </text>
                  </g>
                ))}
              </svg>
            </div>
          </div>

          {/* Instructions */}
          {points.length === 0 && (
            <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl">
              <p className="text-[10px] text-blue-300 text-center">
                💡 <span className="font-bold">Cliquez sur l'image</span> pour placer les points du contour (minimum 3 points)
              </p>
            </div>
          )}

          {points.length > 0 && points.length < 3 && (
            <div className="mt-4 p-3 bg-orange-500/10 border border-orange-500/30 rounded-xl">
              <p className="text-[10px] text-orange-300 text-center">
                ⚠️ Il faut au moins <span className="font-bold">3 points</span> pour former un contour (actuellement: {points.length})
              </p>
            </div>
          )}

          {points.length >= 3 && (
            <div className="mt-4 p-3 bg-green-500/10 border border-green-500/30 rounded-xl">
              <p className="text-[10px] text-green-300 text-center">
                ✓ Contour valide avec <span className="font-bold">{points.length} points</span>. Vous pouvez sauvegarder ou ajouter d'autres points.
              </p>
            </div>
          )}

          {/* Boutons */}
          <div className="mt-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex gap-2">
              <button 
                onClick={handleUndo}
                disabled={points.length === 0}
                className="px-4 py-2 text-xs font-bold uppercase bg-slate-700 rounded-xl hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                ↶ Annuler point
              </button>
              <button 
                onClick={handleReset}
                disabled={points.length === 0}
                className="px-4 py-2 text-xs font-bold uppercase bg-slate-700 rounded-xl hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                🗑️ Réinitialiser
              </button>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={onClose} 
                className="px-4 py-2 text-xs font-bold uppercase bg-slate-700 rounded-xl hover:bg-slate-600 transition-all"
              >
                Fermer
              </button>
              <button 
                onClick={handleSave}
                disabled={points.length < 3}
                className="px-5 py-2 text-xs font-bold uppercase rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  backgroundColor: points.length >= 3 ? annotationColor : '#334155',
                  color: 'white'
                }}
              >
                ✓ Sauvegarder contour
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-xl">
              <p className="text-[11px] text-red-400 font-bold text-center">❌ {error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AnnotationCanvas;