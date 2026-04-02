const CENTER_TOLERANCE = 1e-4;
const ZOOM_TOLERANCE = 1e-4;

interface ViewportSyncCheck {
  currentCenter: [number, number];
  currentZoom: number;
  targetCenter: [number, number];
  targetZoom: number;
}

export const shouldSyncViewportTarget = ({
  currentCenter,
  currentZoom,
  targetCenter,
  targetZoom,
}: ViewportSyncCheck): boolean => (
  Math.abs(currentCenter[0] - targetCenter[0]) > CENTER_TOLERANCE
  || Math.abs(currentCenter[1] - targetCenter[1]) > CENTER_TOLERANCE
  || Math.abs(currentZoom - targetZoom) > ZOOM_TOLERANCE
);
