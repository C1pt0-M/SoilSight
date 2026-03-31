"""Spatial regression model for ML what-if prediction (space-for-time substitution).

Trains a HistGradientBoostingRegressor on raster feature data at startup,
then provides what-if predictions by modifying pixel features according to
scenario-specific deltas from lit_params.FEATURE_DELTAS.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any, Dict

import numpy as np

from ..models import SHIData
from .lit_params import FEATURE_DELTAS

logger = logging.getLogger(__name__)

# Chinese labels for feature importance display
FEATURE_LABELS: Dict[str, str] = {
    "rzsm_mean": "根区土壤水分",
    "ai_mean": "干旱指数",
    "ndvi_mean": "植被指数均值",
    "ndvi_cv": "植被指数变异",
    "soc": "有机碳",
    "ph": "土壤pH",
    "cec": "阳离子交换量",
    "clay": "黏粒含量",
    "slope": "坡度",
    "crop_fraction": "耕地比例",
    "drought_risk": "干旱风险",
    "heat_risk": "热胁迫风险",
}

# Feature names in the order they appear in the training matrix.
FEATURE_NAMES = [
    "rzsm_mean",
    "ai_mean",
    "ndvi_mean",
    "ndvi_cv",
    "soc",
    "ph",
    "cec",
    "clay",
    "slope",
    "crop_fraction",
    "drought_risk",
    "heat_risk",
]

# Map from feature name to the TIF filename suffix used in the feature directory.
_FEATURE_FILES = {
    "rzsm_mean":     "era5_rzsm_gs_mean_{tag}_on_modis.tif",
    "ai_mean":       "era5_ai_gs_mean_{tag}_on_modis.tif",
    "ndvi_mean":     "mod13a1_061_ndvi_gs_mean_{tag}.tif",
    "ndvi_cv":       "mod13a1_061_ndvi_gs_cv_{tag}.tif",
    "soc":           "soilgrids_soc_topsoil_0_30cm_on_modis.tif",
    "ph":            "soilgrids_phh2o_topsoil_0_30cm_on_modis.tif",
    "cec":           "soilgrids_cec_topsoil_0_30cm_on_modis.tif",
    "clay":          "soilgrids_clay_topsoil_0_30cm_on_modis.tif",
    "slope":         "terrain_slope_on_modis_500m.tif",
    "crop_fraction": "cropland_fraction_on_modis_500m_2023.tif",
    "drought_risk":  "era5_drought_risk_gs_{tag}_on_modis.tif",
    "heat_risk":     "era5_heat_risk_gs_{tag}_on_modis.tif",
}


class SpatialModel:
    """Trained spatial regression model for what-if SHI predictions."""

    def __init__(self) -> None:
        self.model: Any = None
        self.feature_arrays: Dict[str, np.ndarray] = {}
        self.feature_names: list[str] = []
        self.feature_importance: list[Dict[str, Any]] = []
        self.train_r2: float = 0.0
        self.train_rmse: float = 0.0
        self.n_samples: int = 0
        self.is_trained: bool = False

    def train(self, data: SHIData, feature_dir: Path) -> bool:
        """Train the spatial model from raster data on disk.

        Returns True if training succeeded.
        """
        try:
            from sklearn.ensemble import HistGradientBoostingRegressor
            from sklearn.inspection import permutation_importance
            from sklearn.metrics import r2_score, mean_squared_error
        except ImportError:
            logger.warning("scikit-learn not installed, spatial model disabled")
            return False

        t0 = time.time()
        year_tag = f"{data.baseline_start_year}_{data.baseline_end_year}"

        # Load feature arrays
        arrays: Dict[str, np.ndarray | None] = {}
        for feat_name in FEATURE_NAMES:
            tpl = _FEATURE_FILES[feat_name]
            fname = tpl.replace("{tag}", year_tag)
            path = feature_dir / fname
            if not path.exists():
                # Try without the year tag (static layers)
                fname_static = tpl.replace("_{tag}", "").replace("{tag}_", "").replace("{tag}", "")
                path_static = feature_dir / fname_static
                if path_static.exists():
                    path = path_static
                else:
                    logger.warning("Spatial model: missing feature %s (%s)", feat_name, path)
                    arrays[feat_name] = None
                    continue
            try:
                import tifffile as tiff
                arr = tiff.imread(str(path)).astype(np.float32)
                if arr.shape != data.score.shape:
                    logger.warning("Spatial model: shape mismatch for %s: %s vs %s",
                                   feat_name, arr.shape, data.score.shape)
                    arrays[feat_name] = None
                else:
                    arrays[feat_name] = arr
            except Exception as exc:
                logger.warning("Spatial model: failed to read %s: %s", feat_name, exc)
                arrays[feat_name] = None

        # Filter to features that loaded successfully
        available_features = [f for f in FEATURE_NAMES if arrays.get(f) is not None]
        if len(available_features) < 4:
            logger.warning("Spatial model: only %d features available, need at least 4", len(available_features))
            return False

        # Build training matrix: valid cropland pixels with SHI score
        score_flat = data.score.ravel()
        crop_flat = data.crop.ravel()

        # Valid mask: crop fraction > 0.1, SHI > 0, SHI < 100, not nodata
        valid = (
            (crop_flat > 0.1)
            & (score_flat > 0)
            & (score_flat < 100)
            & np.isfinite(score_flat)
        )

        # Check features for nodata
        feature_flats: list[np.ndarray] = []
        for feat_name in available_features:
            flat = arrays[feat_name].ravel()
            valid &= np.isfinite(flat) & (flat > -9000)
            feature_flats.append(flat)

        valid_idx = np.where(valid)[0]
        n_valid = len(valid_idx)
        if n_valid < 100:
            logger.warning("Spatial model: only %d valid pixels, need at least 100", n_valid)
            return False

        X = np.column_stack([flat[valid_idx] for flat in feature_flats])
        y = score_flat[valid_idx]

        # Train model
        model = HistGradientBoostingRegressor(
            max_iter=100,
            max_depth=6,
            learning_rate=0.1,
            random_state=42,
        )
        model.fit(X, y)

        # Evaluate in-sample
        y_pred = model.predict(X)
        r2 = float(r2_score(y, y_pred))
        rmse = float(np.sqrt(mean_squared_error(y, y_pred)))

        # Store results
        self.model = model
        self.feature_arrays = {f: arrays[f] for f in available_features}
        self.feature_names = list(available_features)
        self.train_r2 = r2
        self.train_rmse = rmse
        self.n_samples = n_valid
        self.is_trained = True
        self.feature_importance = []

        if hasattr(model, "feature_importances_"):
            self.feature_importance = self._format_feature_importances(
                self.feature_names,
                getattr(model, "feature_importances_", []),
            )
        else:
            try:
                sample_size = min(2000, len(y))
                sample_rng = np.random.default_rng(42)
                sample_idx = sample_rng.choice(len(y), size=sample_size, replace=False) if sample_size < len(y) else np.arange(len(y))
                perm = permutation_importance(
                    model,
                    X[sample_idx],
                    y[sample_idx],
                    n_repeats=5,
                    random_state=42,
                    scoring="r2",
                )
                self.feature_importance = self._format_feature_importances(
                    self.feature_names,
                    perm.importances_mean,
                )
            except Exception as exc:
                logger.warning("Spatial model: failed to compute permutation importance: %s", exc)

        elapsed = time.time() - t0
        logger.info(
            "Spatial model trained: R2=%.3f, RMSE=%.1f, N=%d, features=%d, time=%.1fs",
            r2, rmse, n_valid, len(available_features), elapsed,
        )
        print(
            f"Spatial model trained: R2={r2:.3f}, RMSE={rmse:.1f}, "
            f"N={n_valid}, features={len(available_features)}, time={elapsed:.1f}s"
        )
        return True

    def _format_feature_importances(
        self,
        feat_names: list[str],
        importances: Any,
    ) -> list[Dict[str, Any]]:
        result: list[Dict[str, Any]] = []
        for name, imp in zip(feat_names, importances):
            result.append({
                "feature": name,
                "label": FEATURE_LABELS.get(name, name),
                "importance": round(float(imp), 4),
            })
        result.sort(key=lambda x: x["importance"], reverse=True)
        return result

    def get_feature_importance(self) -> list[Dict[str, Any]]:
        """Return feature importances sorted by importance descending."""
        if not self.is_trained or self.model is None:
            return []
        if self.feature_importance:
            return self.feature_importance
        if hasattr(self.model, "feature_importances_"):
            feat_names = self.feature_names or list(self.feature_arrays.keys())
            return self._format_feature_importances(
                feat_names,
                getattr(self.model, "feature_importances_", []),
            )
        return []

    def predict_what_if(
        self,
        data: SHIData,
        row: int,
        col: int,
        scenario_pack_id: str,
    ) -> Dict[str, Any] | None:
        """Predict SHI for a pixel under a what-if scenario.

        Returns a dict with model info and predictions, or None if unavailable.
        """
        if not self.is_trained or self.model is None:
            return None
        if row < 0 or row >= data.grid.height or col < 0 or col >= data.grid.width:
            return None

        # Extract current features
        feat_names = list(self.feature_arrays.keys())
        current_features = np.empty(len(feat_names), dtype=np.float64)
        for i, fname in enumerate(feat_names):
            arr = self.feature_arrays[fname]
            val = float(arr[row, col])
            if not np.isfinite(val) or val <= -9000:
                return None
            current_features[i] = val

        # Predict current SHI
        current_pred = float(self.model.predict(current_features.reshape(1, -1))[0])
        current_pred = float(np.clip(current_pred, 0, 100))

        # Apply scenario deltas
        deltas = FEATURE_DELTAS.get(scenario_pack_id, {})
        modified_features = current_features.copy()
        for i, fname in enumerate(feat_names):
            if fname in deltas:
                delta_frac = deltas[fname]
                modified_features[i] = current_features[i] * (1.0 + delta_frac)

        # Predict what-if SHI
        whatif_pred = float(self.model.predict(modified_features.reshape(1, -1))[0])
        whatif_pred = float(np.clip(whatif_pred, 0, 100))

        return {
            "model_type": "SpatialHGBR",
            "train_r2": round(self.train_r2, 3),
            "train_rmse": round(self.train_rmse, 1),
            "train_n": self.n_samples,
            "current_pred_shi": round(current_pred, 3),
            "pred_end_shi": round(whatif_pred, 3),
            "pred_delta_shi": round(whatif_pred - current_pred, 3),
            "uncertainty_note": "空间回归模型基于 space-for-time 替代法，反映空间特征关联而非因果效应。",
        }


def train_spatial_model(data: SHIData, feature_dir: Path) -> SpatialModel | None:
    """Convenience function to train and return the spatial model."""
    model = SpatialModel()
    ok = model.train(data, feature_dir)
    return model if ok else None
