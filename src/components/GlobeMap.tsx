import { useEffect, useMemo, useRef, useState } from 'react';
import { geoOrthographic, geoPath, geoDistance, geoGraticule10 } from 'd3-geo';
import type { Photo } from '../types';
import landGeo from '../data/land-geo.json';

interface Props {
  photos: Photo[];
}

interface LocationGroup {
  lat: number;
  lng: number;
  name: string;
  country: string;
  photos: Photo[];
}

const COUNTRY_CENTROIDS: Record<string, [number, number]> = {
  Austria: [47.594, 14.1246],
  Canada: [61.0667, -107.9917],
  'Cape Verde': [16.0001, -24.0084],
  Czechia: [49.7439, 15.3381],
  Denmark: [55.6702, 10.3333],
  France: [46.6034, 1.8883],
  Germany: [51.1638, 10.4478],
  Greece: [38.9954, 21.9877],
  Luxembourg: [49.8159, 6.1297],
  Norway: [61.1529, 8.7877],
  Poland: [52.2159, 19.1344],
  Portugal: [39.6622, -8.1354],
  Spain: [39.3261, -4.838],
  Svalbard: [78.7199, 20.3493],
  Switzerland: [46.7986, 8.232],
  'United Kingdom': [54.7024, -3.2766],
};

function groupByLocation(photos: Photo[]): LocationGroup[] {
  const groups = new Map<string, Photo[]>();
  for (const p of photos) {
    if (!p.location) continue;
    const c = p.country || 'Unknown';
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(p);
  }
  return [...groups.entries()].map(([country, countryPhotos]) => {
    const [lat, lng] = COUNTRY_CENTROIDS[country] || [0, 0];
    return { lat, lng, name: country, country, photos: countryPhotos };
  });
}

const W = 1000;
const H = 1000;
const ROTATION_SPEED = 4.5;
const DRAG_SENSITIVITY = 0.25;
const BASE_SCALE = W / 2.15;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;

const landFc = { type: 'FeatureCollection', features: landGeo } as any;
const graticule = geoGraticule10();

export default function GlobeMap({ photos }: Props) {
  const groups = useMemo(() => groupByLocation(photos), [photos]);

  const [rotation, setRotation] = useState<[number, number, number]>([0, -20, 0]);
  const [hovered, setHovered] = useState<{ group: LocationGroup; x: number; y: number } | null>(
    null,
  );
  const [zoom, setZoom] = useState(1);
  const [selected, setSelected] = useState<LocationGroup | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);

  const rotationRef = useRef(rotation);
  const autoSpinRef = useRef(true); // whether idle auto-rotation should be running
  const hoveredRef = useRef(false);
  const rafRef = useRef<number>();
  const lastRef = useRef<number | null>(null);

  // drag state
  const dragRef = useRef<{
    dragging: boolean;
    startX: number;
    startY: number;
    startRotation: [number, number, number];
  }>({ dragging: false, startX: 0, startY: 0, startRotation: rotation });

  // non-passive wheel listener for zoom
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomRef.current + delta));
      zoomRef.current = next;
      setZoom(next);
      autoSpinRef.current = false;
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, []);

  useEffect(() => {
    const tick = (t: number) => {
      if (lastRef.current == null) lastRef.current = t;
      const dt = (t - lastRef.current) / 1000;
      lastRef.current = t;

      if (autoSpinRef.current && !dragRef.current.dragging && !hoveredRef.current) {
        const [lambda, phi, gamma] = rotationRef.current;
        rotationRef.current = [lambda + ROTATION_SPEED * dt, phi, gamma];
        setRotation(rotationRef.current);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const projection = useMemo(() => {
    return geoOrthographic()
      .scale(BASE_SCALE * zoom)
      .translate([W / 2, H / 2])
      .clipAngle(90)
      .rotate(rotation);
  }, [rotation, zoom]);

  const pathGen = useMemo(() => geoPath(projection), [projection]);

  const landPath = useMemo(() => pathGen(landFc), [pathGen]);
  const graticulePath = useMemo(() => pathGen(graticule), [pathGen]);

  const center: [number, number] = [-rotation[0], -rotation[1]];

  const visibleGroups = groups
    .map(g => {
      const dist = geoDistance([g.lng, g.lat], center);
      const coords = projection([g.lng, g.lat]);
      return { g, dist, coords };
    })
    .filter(v => v.dist < Math.PI / 2 && v.coords);

  // Convert a point in SVG user space (0..1000) to pixel coords relative to the container div,
  // so the tooltip (positioned with plain CSS left/top) lines up regardless of how the SVG is scaled.
  function svgToContainerPoint(x: number, y: number) {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return { x, y };
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x, y };
    const pt = svg.createSVGPoint();
    pt.x = x;
    pt.y = y;
    const screenPt = pt.matrixTransform(ctm);
    const containerRect = container.getBoundingClientRect();
    return { x: screenPt.x - containerRect.left, y: screenPt.y - containerRect.top };
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startRotation: rotationRef.current,
    };
    autoSpinRef.current = false;
    setHovered(null);
    setSelected(null);
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const [startLambda, startPhi, gamma] = dragRef.current.startRotation;
    const nextLambda = startLambda + dx * DRAG_SENSITIVITY;
    const nextPhi = Math.max(-90, Math.min(90, startPhi - dy * DRAG_SENSITIVITY));
    rotationRef.current = [nextLambda, nextPhi, gamma];
    setRotation(rotationRef.current);
  }

  function handlePointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current.dragging) {
      (e.target as Element).releasePointerCapture(e.pointerId);
    }
    dragRef.current.dragging = false;
  }

  function handleDoubleClick() {
    zoomRef.current = zoomRef.current === 1 ? 2.5 : 1;
    setZoom(zoomRef.current);
    autoSpinRef.current = true;
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        background: '#202020',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        style={{
          width: '100%',
          height: '100%',
          touchAction: 'none',
          cursor: dragRef.current.dragging ? 'grabbing' : 'grab',
        }}
        xmlns="http://www.w3.org/2000/svg"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onDoubleClick={handleDoubleClick}
      >
        <rect width={W} height={H} fill="#202020" onClick={() => setSelected(null)} />

        <circle
          cx={W / 2}
          cy={H / 2}
          r={W / 2.15}
          fill="rgba(255,255,255,0.03)"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={0.75}
        />

        <path
          d={graticulePath ?? undefined}
          fill="none"
          stroke="rgba(255,255,255,0.05)"
          strokeWidth={0.5}
        />

        <path
          d={landPath ?? undefined}
          fill="rgba(255,255,255,0.77)"
          stroke="rgba(100,100,100,0.5)"
          strokeWidth={0.5}
        />

        {visibleGroups.map(({ g, dist, coords }, i) => {
          const [cx, cy] = coords!;
          const isActive = hovered?.group === g || selected === g;
          const edgeFade = 1 - Math.pow(dist / (Math.PI / 2), 6) * 0.6;
          return (
            <g key={i} style={{ opacity: edgeFade }}>
              {/* outer glow, purely visual */}
              <circle
                cx={cx}
                cy={cy}
                r={isActive ? 10 : 8}
                fill={isActive ? 'rgba(254,92,53,0.3)' : 'rgba(254,92,53,0.2)'}
                stroke="none"
                pointerEvents="none"
              />
              {/* visual dot, purely visual */}
              <circle
                cx={cx}
                cy={cy}
                r={isActive ? 5 : 4}
                fill="rgba(254,92,53,0.85)"
                stroke="none"
                pointerEvents="none"
              />
              {/* invisible, larger hit area — this is what actually catches clicks/hover */}
              <circle
                cx={cx}
                cy={cy}
                r={14}
                fill="transparent"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  if (selected === g) {
                    window.location.href = `/photo/?location=${encodeURIComponent(g.country || g.name)}`;
                  } else {
                    setSelected(g);
                    autoSpinRef.current = false;
                  }
                }}
                onMouseEnter={() => {
                  hoveredRef.current = true;
                  const { x, y } = svgToContainerPoint(cx, cy);
                  setHovered({ group: g, x, y });
                }}
                onMouseLeave={() => {
                  hoveredRef.current = false;
                  setHovered(null);
                }}
              />
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div
          style={{
            position: 'absolute',
            left: hovered.x + 14,
            top: hovered.y - 10,
            background: '#1a1a1a',
            border: '1px solid rgba(254,92,53,0.3)',
            borderRadius: '4px',
            padding: '0.4rem 0.65rem',
            pointerEvents: selected === hovered.group ? 'auto' : 'none',
            cursor: selected === hovered.group ? 'pointer' : 'default',
            whiteSpace: 'nowrap',
            zIndex: 20,
            boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          }}
          onClick={() => {
            if (selected === hovered.group) {
              window.location.href = `/photo/?location=${encodeURIComponent(hovered.group.country || hovered.group.name)}`;
            }
          }}
        >
          <div
            style={{
              fontSize: '0.8rem',
              color: 'rgba(255,255,255,0.8)',
              fontFamily: "'Lato', sans-serif",
              fontWeight: 300,
            }}
          >
            {hovered.group.country || 'Unknown'}
          </div>
          <div
            style={{
              fontSize: '0.7rem',
              color: 'rgba(255,255,255,0.5)',
              fontFamily: "'IBM Plex Mono', monospace",
              marginTop: '1px',
            }}
          >
            {hovered.group.lat.toFixed(4)}, {hovered.group.lng.toFixed(4)}
          </div>
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--accent)',
              fontFamily: "'IBM Plex Mono', monospace",
              marginTop: '2px',
            }}
          >
            {selected === hovered.group ? 'View →' : `${hovered.group.photos.length} photo${hovered.group.photos.length !== 1 ? 's' : ''}`}
          </div>
        </div>
      )}
    </div>
  );
}
