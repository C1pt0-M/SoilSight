"""Reverse geocoding via local GeoJSON admin boundaries (prefecture + county)."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class AdminFeature:
    name: str
    polygons: Sequence[Sequence[Tuple[float, float]]]  # list of rings (exterior only)
    centroid: Tuple[float, float] = (0.0, 0.0)  # (lon, lat)
    bbox: Tuple[float, float, float, float] = (0.0, 0.0, 0.0, 0.0)  # (min_lon, min_lat, max_lon, max_lat)


def _point_in_ring(px: float, py: float, ring: Sequence[Tuple[float, float]]) -> bool:
    """Ray-casting algorithm for point-in-polygon (exterior ring only)."""
    n = len(ring)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > py) != (yj > py)) and (px < (xj - xi) * (py - yi) / (yj - yi) + xi):
            inside = not inside
        j = i
    return inside


def _point_in_multipolygon(px: float, py: float, feature: AdminFeature) -> bool:
    for ring in feature.polygons:
        if _point_in_ring(px, py, ring):
            return True
    return False


def _build_spatial_index(
    features: List[AdminFeature], cell_size: float = 1.0
) -> Tuple[Dict[Tuple[int, int], List[AdminFeature]], Dict[str, float]]:
    index: Dict[Tuple[int, int], List[AdminFeature]] = {}
    if not features:
        return index, {}

    min_lon = min(f.bbox[0] for f in features)
    min_lat = min(f.bbox[1] for f in features)
    max_lon = max(f.bbox[2] for f in features)
    max_lat = max(f.bbox[3] for f in features)

    if not (min_lon < max_lon and min_lat < max_lat):
        return index, {}

    for feat in features:
        if not feat.bbox:
            continue
        fmin_lon, fmin_lat, fmax_lon, fmax_lat = feat.bbox
        ix0 = int((fmin_lon - min_lon) // cell_size)
        ix1 = int((fmax_lon - min_lon) // cell_size)
        iy0 = int((fmin_lat - min_lat) // cell_size)
        iy1 = int((fmax_lat - min_lat) // cell_size)
        for ix in range(ix0, ix1 + 1):
            for iy in range(iy0, iy1 + 1):
                index.setdefault((ix, iy), []).append(feat)

    meta = {
        "min_lon": min_lon,
        "min_lat": min_lat,
        "max_lon": max_lon,
        "max_lat": max_lat,
        "cell_size": float(cell_size),
    }
    return index, meta


def _index_candidates(
    index: Dict[Tuple[int, int], List[AdminFeature]],
    meta: Dict[str, float],
    lon: float,
    lat: float,
) -> List[AdminFeature] | None:
    if not index or not meta:
        return None
    min_lon = meta.get("min_lon")
    min_lat = meta.get("min_lat")
    max_lon = meta.get("max_lon")
    max_lat = meta.get("max_lat")
    cell_size = meta.get("cell_size")
    if (
        min_lon is None
        or min_lat is None
        or max_lon is None
        or max_lat is None
        or cell_size is None
    ):
        return None
    if lon < min_lon or lon > max_lon or lat < min_lat or lat > max_lat:
        return []
    ix = int((lon - min_lon) // cell_size)
    iy = int((lat - min_lat) // cell_size)
    return index.get((ix, iy), [])


def _load_features(path: Path) -> List[AdminFeature]:
    if not path.exists():
        logger.warning("GeoJSON not found: %s", path)
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    features: List[AdminFeature] = []
    for feat in data.get("features", []):
        name = feat.get("properties", {}).get("name", "")
        geom = feat.get("geometry", {})
        geom_type = geom.get("type", "")
        polygons: List[Sequence[Tuple[float, float]]] = []
        if geom_type == "Polygon":
            # First ring is exterior
            polygons.append([(c[0], c[1]) for c in geom["coordinates"][0]])
        elif geom_type == "MultiPolygon":
            for poly in geom["coordinates"]:
                polygons.append([(c[0], c[1]) for c in poly[0]])
        else:
            continue
        if name and polygons:
            # Compute centroid (average of all exterior ring coordinates) and bbox
            all_lons: List[float] = []
            all_lats: List[float] = []
            for ring in polygons:
                for lon, lat in ring:
                    all_lons.append(lon)
                    all_lats.append(lat)
            if all_lons and all_lats:
                centroid = (sum(all_lons) / len(all_lons), sum(all_lats) / len(all_lats))
                bbox = (min(all_lons), min(all_lats), max(all_lons), max(all_lats))
            else:
                centroid = (0.0, 0.0)
                bbox = (0.0, 0.0, 0.0, 0.0)
            features.append(AdminFeature(name=name, polygons=polygons, centroid=centroid, bbox=bbox))
    logger.info("Loaded %d admin features from %s", len(features), path.name)
    return features


@dataclass
class GeoLookup:
    prefectures: List[AdminFeature]
    counties: List[AdminFeature]
    pref_index: Dict[Tuple[int, int], List[AdminFeature]] = field(default_factory=dict)
    pref_meta: Dict[str, float] = field(default_factory=dict)
    county_index: Dict[Tuple[int, int], List[AdminFeature]] = field(default_factory=dict)
    county_meta: Dict[str, float] = field(default_factory=dict)

    def lookup(self, lon: float, lat: float) -> dict[str, str | None]:
        prefecture = None
        county = None
        pref_candidates = _index_candidates(self.pref_index, self.pref_meta, lon, lat)
        if pref_candidates is None:
            pref_candidates = self.prefectures
        for feat in pref_candidates:
            if feat.bbox and not (feat.bbox[0] <= lon <= feat.bbox[2] and feat.bbox[1] <= lat <= feat.bbox[3]):
                continue
            if _point_in_multipolygon(lon, lat, feat):
                prefecture = feat.name
                break
        county_candidates = _index_candidates(self.county_index, self.county_meta, lon, lat)
        if county_candidates is None:
            county_candidates = self.counties
        for feat in county_candidates:
            if feat.bbox and not (feat.bbox[0] <= lon <= feat.bbox[2] and feat.bbox[1] <= lat <= feat.bbox[3]):
                continue
            if _point_in_multipolygon(lon, lat, feat):
                county = feat.name
                break
        return {"prefecture": prefecture, "county": county}

    def search(self, query: str, limit: int = 10) -> list[dict]:
        """Search admin features by name or coordinate string.

        Coordinate patterns: "39.7, 77.1" or "39.7 77.1".
        If the first number is in 30-50 range, treat as lat,lon; otherwise lon,lat.
        """
        query = query.strip()
        if not query:
            return []

        # Try to parse as coordinates
        coord_match = re.match(
            r"^(-?\d+(?:\.\d+)?)[,\s]+(-?\d+(?:\.\d+)?)$", query
        )
        if coord_match:
            a = float(coord_match.group(1))
            b = float(coord_match.group(2))
            # If first number looks like latitude (30-50 for Xinjiang region)
            if 30 <= a <= 50:
                lat, lon = a, b
            else:
                lon, lat = a, b
            return [{"name": f"坐标: {lon}, {lat}", "lon": lon, "lat": lat, "type": "coordinate"}]

        # Substring match against feature names
        results: list[dict] = []
        query_lower = query.lower()

        # Prefectures first
        for feat in self.prefectures:
            if query_lower in feat.name.lower():
                results.append({
                    "name": feat.name,
                    "lon": feat.centroid[0],
                    "lat": feat.centroid[1],
                    "bbox": list(feat.bbox),
                    "type": "prefecture",
                })
            if len(results) >= limit:
                return results

        # Then counties
        for feat in self.counties:
            if query_lower in feat.name.lower():
                results.append({
                    "name": feat.name,
                    "lon": feat.centroid[0],
                    "lat": feat.centroid[1],
                    "bbox": list(feat.bbox),
                    "type": "county",
                })
            if len(results) >= limit:
                return results

        return results


def load_geo_lookup(admin_dir: Path) -> GeoLookup:
    prefectures = _load_features(admin_dir / "xj_prefectures.geojson")
    counties = _load_features(admin_dir / "xj_counties.geojson")
    pref_index, pref_meta = _build_spatial_index(prefectures, cell_size=1.0)
    county_index, county_meta = _build_spatial_index(counties, cell_size=0.5)
    return GeoLookup(
        prefectures=prefectures,
        counties=counties,
        pref_index=pref_index,
        pref_meta=pref_meta,
        county_index=county_index,
        county_meta=county_meta,
    )
