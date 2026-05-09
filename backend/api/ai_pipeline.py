"""
AIPipeline — YOLO v8 classification + Segmentation ensemble sélective
Compatible avec le checkpoint ensemble_tympan.pth (v8 corrigé)
"""
import io, inspect, types, cv2, base64
import numpy as np
from pathlib import Path
from PIL import Image

import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms.functional as TF

import segmentation_models_pytorch as smp
import timm
from ultralytics import YOLO as UltralyticsYOLO

from config import settings

# ── Constantes ────────────────────────────────────────────────────────────────
MEAN = [0.485, 0.456, 0.406]
STD  = [0.229, 0.224, 0.225]

CIRCLE_MARGIN = 0.08
ALPHA         = 0.55

YOLO_TO_SEG = {
    'Normal_Aucun'        : 'Normal',
    'OSM_Aucun'           : 'OSM',
    'OMA_Suppuree'        : 'OMA',
    'OMA_Congestive'      : 'OMA',
    'OMA_Perforee'        : 'Perfo',
    'Perfo_Non_Marginale' : 'Perfo',
    'Perfo_Marginale'     : 'Perfo',
    'PDR_Atel_StadeI'     : 'PDR + Atel',
    'PDR_Atel_StadeII'    : 'PDR + Atel',
    'PDR_Atel_StadeIII'   : 'PDR + Atel',
    'Chole_Atticale'      : 'Chole',
    'Chole_PostSup'       : 'Chole',
    'Chole_Attic_PostSup' : 'Chole',
}

SEG_CLASS_NAMES = {
    0: 'Fond', 1: 'Normal', 2: 'OSM', 3: 'OMA',
    4: 'Perfo', 5: 'PDR + Atel', 6: 'Chole'
}
SEG_CLASS_TO_ID = {v: k for k, v in SEG_CLASS_NAMES.items() if k > 0}
NUM_SEG_CLASSES = 7

CLASS_COLORS_RGB = {
    0: (38,  38,  38),
    1: (51,  153, 255),   # Normal  : bleu
    2: (51,  217, 114),   # OSM     : vert
    3: (255, 140, 26),    # OMA     : orange
    4: (242, 51,  51),    # Perfo   : rouge
    5: (191, 51,  230),   # PDR+Atel: violet
    6: (255, 217, 26),    # Chole   : jaune
}


# ══════════════════════════════════════════════════════════════════════════════
# Architectures segmentation (identiques au pipeline_tympan_v8.py)
# ══════════════════════════════════════════════════════════════════════════════

def _decode(model, features):
    """Compatible smp < 0.3 (*features) et smp >= 0.3 (features)."""
    sig     = inspect.signature(model.decoder.forward)
    params  = list(sig.parameters.values())
    has_var = any(p.kind == inspect.Parameter.VAR_POSITIONAL for p in params)
    return model.decoder(*features) if has_var else model.decoder(features)


class ChannelAttention(nn.Module):
    def __init__(self, in_ch, ratio=16):
        super().__init__()
        self.avg = nn.AdaptiveAvgPool2d(1)
        self.max = nn.AdaptiveMaxPool2d(1)
        self.fc  = nn.Sequential(
            nn.Conv2d(in_ch, max(1, in_ch // ratio), 1, bias=False),
            nn.ReLU(),
            nn.Conv2d(max(1, in_ch // ratio), in_ch, 1, bias=False),
        )
        self.sig = nn.Sigmoid()

    def forward(self, x):
        return x * self.sig(self.fc(self.avg(x)) + self.fc(self.max(x)))


class SpatialAttention(nn.Module):
    def __init__(self):
        super().__init__()
        self.conv = nn.Conv2d(2, 1, 7, padding=3, bias=False)
        self.sig  = nn.Sigmoid()

    def forward(self, x):
        a = torch.cat([x.mean(1, keepdim=True), x.max(1, keepdim=True)[0]], dim=1)
        return x * self.sig(self.conv(a))


class CBAM(nn.Module):
    def __init__(self, in_ch, ratio=16):
        super().__init__()
        self.ca = ChannelAttention(in_ch, ratio)
        self.sa = SpatialAttention()

    def forward(self, x):
        return self.sa(self.ca(x))


class SegFormerHead(nn.Module):
    def __init__(self, in_channels, num_classes, embed_dim=256):
        super().__init__()
        self.linears = nn.ModuleList([nn.Conv2d(c, embed_dim, 1) for c in in_channels])
        self.fuse = nn.Sequential(
            nn.Conv2d(embed_dim * len(in_channels), embed_dim, 1, bias=False),
            nn.BatchNorm2d(embed_dim),
            nn.ReLU(inplace=True),
            nn.Dropout2d(0.1),
        )
        self.cls = nn.Conv2d(embed_dim, num_classes, 1)

    def forward(self, features, target_size):
        h, w = target_size
        outs = [F.interpolate(lin(feat), size=(h, w), mode='bilinear', align_corners=False)
                for lin, feat in zip(self.linears, features)]
        return self.cls(self.fuse(torch.cat(outs, dim=1)))


class SegFormerModel(nn.Module):
    def __init__(self, backbone='pvt_v2_b3', num_classes=2):
        super().__init__()
        self.encoder = timm.create_model(
            backbone, pretrained=False, features_only=True, out_indices=(0, 1, 2, 3))
        self.decoder = SegFormerHead(
            self.encoder.feature_info.channels(), num_classes, embed_dim=256)

    def forward(self, x):
        feats = self.encoder(x)
        return self.decoder(feats, (x.shape[2], x.shape[3]))


def _diagnose(state_dict):
    keys = set(state_dict.keys())
    return {
        'cbam_final': any(k.startswith('cbam_final.')             for k in keys),
        'seg_cbam':   any(k.startswith('segmentation_head.cbam.') for k in keys),
        'seg_head':   any(k.startswith('segmentation_head.head.') for k in keys),
        'seg_0':      any(k.startswith('segmentation_head.0.')    for k in keys),
    }


def _build_unet(encoder_name, state_dict, num_classes):
    info  = _diagnose(state_dict)
    model = smp.Unet(
        encoder_name=encoder_name, encoder_weights=None,
        in_channels=3, classes=num_classes,
        decoder_channels=(256, 128, 64, 32, 16),
        decoder_attention_type='scse', activation=None,
    )
    if info['cbam_final']:
        model.cbam_final = CBAM(16)

    if info['seg_cbam'] and info['seg_head']:
        oh = model.segmentation_head
        class _H(nn.Module):
            def __init__(self, h): super().__init__(); self.cbam = CBAM(16); self.head = h
            def forward(self, x): return self.head(self.cbam(x))
        model.segmentation_head = _H(oh)
    elif info['seg_head'] and not info['seg_cbam']:
        oh = model.segmentation_head
        class _H(nn.Module):
            def __init__(self, h): super().__init__(); self.head = h
            def forward(self, x): return self.head(x)
        model.segmentation_head = _H(oh)

    if info['cbam_final']:
        def _fwd(self, x):
            return self.segmentation_head(
                self.cbam_final(_decode(self, self.encoder(x))))
        model.forward = types.MethodType(_fwd, model)
    elif info['seg_cbam'] or info['seg_head']:
        def _fwd(self, x):
            return self.segmentation_head(_decode(self, self.encoder(x)))
        model.forward = types.MethodType(_fwd, model)

    return model


def _build_model(arch, state_dict, num_classes=2):
    if arch == 'segformer_b3':
        return SegFormerModel(num_classes=num_classes)
    if arch == 'unetpp_b4':
        return smp.UnetPlusPlus(
            encoder_name='efficientnet-b4', encoder_weights=None,
            in_channels=3, classes=num_classes,
            decoder_channels=(256, 128, 64, 32, 16),
            decoder_attention_type='scse', activation=None,
        )
    if arch == 'unet_b4_cbam':
        return _build_unet('efficientnet-b4', state_dict, num_classes)
    if arch == 'unet_b5_cbam':
        return _build_unet('efficientnet-b5', state_dict, num_classes)
    raise ValueError(f'Architecture inconnue : {arch}')


# ── Ensemble sélectif ─────────────────────────────────────────────────────────
class SelectiveEnsemble(nn.Module):
    """
    active_ids=None  → tous les sous-modèles actifs
    active_ids=[2,5] → uniquement OSM et PDR+Atel
    Canal fond (0) fixe à 0.0 — jamais écrasé par logits background.
    """
    def __init__(self, models_info, global_num_classes=7):
        super().__init__()
        self.models             = nn.ModuleList([m['model']    for m in models_info])
        self.class_ids_list     = [m['class_ids'] for m in models_info]
        self.global_num_classes = global_num_classes

    def forward(self, x, active_ids=None):
        B, _, H, W = x.shape
        acc        = torch.full((B, self.global_num_classes, H, W), -1e4, device=x.device)
        acc[:, 0]  = 0.0   # fond = référence fixe

        for model, class_ids in zip(self.models, self.class_ids_list):
            gid = class_ids[1]
            if active_ids is not None and gid not in active_ids:
                continue
            out = model(x)
            if out.shape[-2:] != (H, W):
                out = F.interpolate(out, size=(H, W), mode='bilinear', align_corners=False)
            acc[:, gid] = torch.max(acc[:, gid], out[:, 1])

        return acc


# ══════════════════════════════════════════════════════════════════════════════
# AIPipeline — singleton chargé au démarrage FastAPI
# ══════════════════════════════════════════════════════════════════════════════
class AIPipeline:

    def __init__(self):
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        print(f"   Device : {self.device}")
        self.yolo = self._load_yolo()
        self.seg  = self._load_ensemble()

    # ── Chargement YOLO ───────────────────────────────────────────────────────
    def _load_yolo(self):
        path = settings.YOLO_MODEL_PATH
        if not Path(path).exists():
            print(f"⚠️  YOLO introuvable : {path}")
            return None
        try:
            model = UltralyticsYOLO(path)
            print(f"✅ YOLO chargé — {len(model.names)} classes")
            return model
        except Exception as e:
            print(f"❌ YOLO erreur : {e}")
            return None

    # ── Chargement Ensemble segmentation ─────────────────────────────────────
    def _load_ensemble(self):
        path = settings.ENSEMBLE_MODEL_PATH
        if not Path(path).exists():
            print(f"⚠️  Ensemble introuvable : {path}")
            return None

        ck = None
        for kwargs in [
            dict(map_location='cpu', weights_only=False),
            dict(map_location='cpu'),
        ]:
            try:
                ck = torch.load(path, **kwargs)
                break
            except Exception:
                continue
        if ck is None:
            print("❌ Impossible de charger le checkpoint ensemble")
            return None

        cfg         = ck.get('cfg', {})
        class_to_id = cfg.get('class_to_id',
                              {'Normal':1,'OSM':2,'OMA':3,
                               'Perfo':4,'PDR + Atel':5,'Chole':6})
        arch_map    = ck.get('architectures',
                              {'Normal':'unet_b4_cbam','OSM':'segformer_b3',
                               'OMA':'segformer_b3','Perfo':'unetpp_b4',
                               'PDR + Atel':'segformer_b3','Chole':'unet_b5_cbam'})
        n_binary    = cfg.get('num_classes_binary', 2)
        global_n    = cfg.get('num_classes_total', 6) + 1

        models_info = []
        for name in ck.get('class_order', list(ck['models'].keys())):
            state = ck['models'].get(name)
            arch  = arch_map.get(name, '?')
            gid   = class_to_id.get(name, -1)
            if state is None or gid < 0:
                continue
            try:
                m = _build_model(arch, state, n_binary)
                try:
                    m.load_state_dict(state, strict=True)
                except Exception:
                    inc     = m.load_state_dict(state, strict=False)
                    missing = [k for k in inc.missing_keys   if 'num_batches_tracked' not in k]
                    unexpect= [k for k in inc.unexpected_keys if 'num_batches_tracked' not in k]
                    if missing or unexpect:
                        print(f"   ⚠️  {name} — missing={len(missing)} unexpected={len(unexpect)}")
                m.to(self.device).eval()
                models_info.append({'model': m, 'class_ids': [0, gid], 'name': name})
                print(f"   ✅ {name:12s} ({arch})")
            except Exception as e:
                print(f"   ❌ {name} : {e}")

        if not models_info:
            print("❌ Aucun sous-modèle chargé")
            return None

        ens = SelectiveEnsemble(models_info, global_n).to(self.device)
        ens.eval()
        print(f"✅ Ensemble prêt — {len(models_info)}/6 modèles")
        return ens

    # ── Helpers image ─────────────────────────────────────────────────────────
    def _load_img(self, img_bytes: bytes) -> np.ndarray:
        arr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img is not None:
            return cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        return np.array(Image.open(io.BytesIO(img_bytes)).convert('RGB'))

    def _preprocess_seg(self, img_rgb: np.ndarray) -> torch.Tensor:
        size = settings.IMAGE_SIZE
        pil  = Image.fromarray(img_rgb).resize((size, size), Image.BILINEAR)
        t    = TF.to_tensor(pil)
        return TF.normalize(t, MEAN, STD).unsqueeze(0)

    def _circle_mask(self, pred: np.ndarray, W: int, H: int) -> np.ndarray:
        cx, cy = W / 2., H / 2.
        r      = min(W, H) / 2. * (1. - CIRCLE_MARGIN)
        Y, X   = np.ogrid[:H, :W]
        pred[((X - cx) ** 2 + (Y - cy) ** 2) > r ** 2] = 0
        return pred

    def _make_overlay(self, img_rgb: np.ndarray, pred: np.ndarray) -> np.ndarray:
        img_f   = img_rgb.astype(np.float32) / 255.
        overlay = img_f.copy()
        for cid, rgb in CLASS_COLORS_RGB.items():
            if cid == 0:
                continue
            m = (pred == cid)
            if not m.any():
                continue
            c = np.array(rgb, np.float32) / 255.
            overlay[m] = (1 - ALPHA) * img_f[m] + ALPHA * c
        res = (np.clip(overlay, 0, 1) * 255).astype(np.uint8)
        # Contours
        for cid, rgb in CLASS_COLORS_RGB.items():
            if cid == 0 or not (pred == cid).any():
                continue
            cnts, _ = cv2.findContours(
                (pred == cid).astype(np.uint8),
                cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(res, cnts, -1, rgb, 2)
        return res

    @staticmethod
    def _to_b64_png(img_rgb: np.ndarray) -> str:
        pil = Image.fromarray(img_rgb)
        buf = io.BytesIO()
        pil.save(buf, 'PNG')
        buf.seek(0)
        return base64.b64encode(buf.read()).decode()

    @staticmethod
    def _mask_to_b64(pred: np.ndarray) -> str:
        h, w  = pred.shape
        color = np.zeros((h, w, 3), np.uint8)
        for cid, rgb in CLASS_COLORS_RGB.items():
            if cid == 0:
                continue
            color[pred == cid] = rgb
        pil = Image.fromarray(color)
        buf = io.BytesIO()
        pil.save(buf, 'PNG')
        buf.seek(0)
        return base64.b64encode(buf.read()).decode()

    # ── Pipeline principal ────────────────────────────────────────────────────
    def run(self, img_bytes: bytes) -> dict:
        """
        Entrée  : bytes bruts de l'image otoscopique
        Sortie  : dict { classification, segmentation, images, image_size }
        """
        if self.yolo is None:
            raise RuntimeError("Modèle YOLO non chargé")
        if self.seg is None:
            raise RuntimeError("Modèle segmentation non chargé")

        img_rgb = self._load_img(img_bytes)
        H, W    = img_rgb.shape[:2]

        # ── 1. Classification YOLO ─────────────────────────────────────────
        yolo_res   = self.yolo.predict(
            source=img_rgb, imgsz=settings.YOLO_IMG_SIZE, verbose=False)[0]
        yolo_names = yolo_res.names
        probs_np   = yolo_res.probs.data.cpu().numpy()
        top1_idx   = int(yolo_res.probs.top1)
        yolo_class = yolo_names[top1_idx]
        yolo_conf  = float(probs_np[top1_idx])
        seg_class  = YOLO_TO_SEG.get(yolo_class, 'Normal')
        seg_id     = SEG_CLASS_TO_ID.get(seg_class, 1)

        top3 = [
            {
                "yolo_class": yolo_names[i],
                "confidence": round(float(probs_np[i]), 4),
                "seg_class":  YOLO_TO_SEG.get(yolo_names[i], '?'),
            }
            for i in np.argsort(probs_np)[::-1][:3]
        ]
        all_probs = {
            yolo_names[i]: round(float(probs_np[i]), 4)
            for i in range(len(yolo_names))
        }

        # ── 2. Décision sous-modèles actifs ───────────────────────────────
        if yolo_conf >= settings.CONF_HIGH:
            active_ids = [seg_id]
            mode       = "ciblé"
        elif yolo_conf >= settings.CONF_LOW:
            ids = {
                SEG_CLASS_TO_ID.get(t['seg_class'], -1)
                for t in top3
                if t['confidence'] >= settings.CONF_LOW * 0.5
            }
            ids.add(seg_id)
            active_ids = sorted(i for i in ids if i > 0)
            mode       = "élargi"
        else:
            active_ids = list(range(1, NUM_SEG_CLASSES))
            mode       = "complet"

        # ── 3. Segmentation ────────────────────────────────────────────────
        x = self._preprocess_seg(img_rgb).to(self.device)
        with torch.no_grad():
            with torch.amp.autocast('cuda', enabled=(self.device.type == 'cuda')):
                logits = self.seg(x, active_ids=active_ids)

        logits = F.interpolate(logits, size=(H, W), mode='bilinear', align_corners=False)
        pred   = logits.argmax(1).squeeze(0).cpu().numpy().astype(np.uint8)
        pred   = self._circle_mask(pred, W, H)

        # ── 4. Stats masque ────────────────────────────────────────────────
        detected = [int(c) for c in range(1, NUM_SEG_CLASSES) if (pred == c).any()]
        n_valid  = max(int((pred > 0).sum()), 1)
        seg_stats = {
            SEG_CLASS_NAMES[c]: {
                "pixels":  int((pred == c).sum()),
                "percent": round(float((pred == c).sum()) / n_valid * 100, 1),
            }
            for c in detected
        }

        # ── 5. Images encodées base64 ──────────────────────────────────────
        overlay      = self._make_overlay(img_rgb, pred)
        overlay_b64  = self._to_b64_png(overlay)
        mask_b64     = self._mask_to_b64(pred)

        return {
            "classification": {
                "yolo_class": yolo_class,
                "confidence": round(yolo_conf, 4),
                "seg_class":  seg_class,
                "seg_id":     seg_id,
                "mode":       mode,
                "top3":       top3,
                "all_probs":  all_probs,
            },
            "segmentation": {
                "active_models": [SEG_CLASS_NAMES.get(i, '?') for i in active_ids],
                "detected":      [SEG_CLASS_NAMES[c] for c in detected],
                "stats":         seg_stats,
            },
            "images": {
                "overlay_b64": overlay_b64,
                "mask_b64":    mask_b64,
            },
            "image_size": {"width": W, "height": H},
        }