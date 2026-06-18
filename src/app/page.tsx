"use client";

import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { FormEvent, useEffect, useEffectEvent, useMemo, useRef, useState, useTransition } from "react";

type LatLng = {
  latitude: number;
  longitude: number;
};

type RoofSegment = {
  pitchDegrees: number;
  azimuthDegrees: number;
  center: LatLng;
  planeHeightAtCenterMeters: number;
};

type SolarPanel = {
  center: LatLng;
  orientation: "LANDSCAPE" | "PORTRAIT";
  segmentIndex: number;
  yearlyEnergyDcKwh: number;
};

type BuildingInsights = {
  center: LatLng;
  boundingBox?: { sw: LatLng; ne: LatLng };
  imageryQuality?: "HIGH" | "MEDIUM" | "BASE";
  postalCode?: string;
  administrativeArea?: string;
  regionCode?: string;
  solarPotential: {
    maxArrayPanelsCount: number;
    panelCapacityWatts: number;
    panelHeightMeters: number;
    panelWidthMeters: number;
    maxSunshineHoursPerYear: number;
    maxArrayAreaMeters2: number;
    wholeRoofStats?: { areaMeters2: number; sunshineQuantiles: number[]; groundAreaMeters2: number };
    buildingStats?: { areaMeters2: number; sunshineQuantiles: number[]; groundAreaMeters2: number };
    roofSegmentStats: RoofSegment[];
    solarPanels: SolarPanel[];
    solarPanelConfigs?: { panelsCount: number; yearlyEnergyDcKwh: number }[];
  };
};

type SolarResponse = {
  address: string;
  formattedAddress: string;
  location: LatLng;
  insights: BuildingInsights | null;
  solarError?: string;
  mock: boolean;
};

const initialAddress = "Hamburger Str. 37, 38114 Braunschweig, Germany";
const initialViewState = {
  longitude: 10.5185961,
  latitude: 52.2801583,
  zoom: 19.4,
  tilt: 68,
  bearing: -25,
};
const default3dRange = 260;

export default function Home() {
  const [address, setAddress] = useState(initialAddress);
  const [data, setData] = useState<SolarResponse | null>(null);
  const [error, setError] = useState("");
  const [panelCount, setPanelCount] = useState(24);
  const [viewMode, setViewMode] = useState<"panels" | "3d">("panels");
  const [mapReady, setMapReady] = useState(false);
  const [isPending, startTransition] = useTransition();
  const mapElementRef = useRef<HTMLDivElement | null>(null);
  const googleMapRef = useRef<google.maps.Map | null>(null);
  const panelPolygonsRef = useRef<google.maps.Polygon[]>([]);
  const buildingBoundsRef = useRef<google.maps.Rectangle | null>(null);
  const clickedCircleRef = useRef<google.maps.Circle | null>(null);
  const map3dElementRef = useRef<HTMLDivElement | null>(null);
  const map3dRef = useRef<google.maps.maps3d.Map3DElement | null>(null);
  const map3dPanelsRef = useRef<HTMLElement[]>([]);

  const mapKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const mapId = process.env.NEXT_PUBLIC_GOOGLE_MAP_ID || "DEMO_MAP_ID";
  const insights = data?.insights;
  const potential = insights?.solarPotential;
  const maxPanels = potential?.solarPanels.length || 0;
  const selectedPanels = Math.min(panelCount, maxPanels);
  const annualEnergy = useMemo(
    () =>
      potential?.solarPanelConfigs?.find((config) => config.panelsCount === selectedPanels)?.yearlyEnergyDcKwh ||
      potential?.solarPanels.slice(0, selectedPanels).reduce((total, panel) => total + panel.yearlyEnergyDcKwh, 0) ||
      0,
    [potential, selectedPanels],
  );
  const sunshineQuantiles = potential?.wholeRoofStats?.sunshineQuantiles || potential?.buildingStats?.sunshineQuantiles || [];

  function submitAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    lookupAddress(address);
  }

  function clearMap3dPanels() {
    map3dPanelsRef.current.forEach((panel) => panel.remove());
    map3dPanelsRef.current = [];
  }

  function recenterMap3d(location: LatLng, range = default3dRange) {
    const map3d = map3dRef.current;

    if (!map3d) {
      return;
    }

    map3d.center = { lat: location.latitude, lng: location.longitude, altitude: 0 };
    map3d.range = range;
    map3d.tilt = 67;
  }

  function getSearchBias(): LatLng | null {
    if (viewMode === "3d" && map3dRef.current?.center) {
      return {
        latitude: map3dRef.current.center.lat,
        longitude: map3dRef.current.center.lng,
      };
    }

    const center = googleMapRef.current?.getCenter();

    if (!center) {
      return null;
    }

    return { latitude: center.lat(), longitude: center.lng() };
  }

  function lookupAddress(nextAddress: string) {
    setError("");

    startTransition(async () => {
      const params = new URLSearchParams({ address: nextAddress });
      const bias = getSearchBias();

      if (bias) {
        params.set("biasLat", String(bias.latitude));
        params.set("biasLng", String(bias.longitude));
      }

      const response = await fetch(`/api/solar?${params}`);
      const body = await response.json();

      if (!response.ok) {
        setError(body.error || "Solar lookup failed.");
        return;
      }

      const nextData = body as SolarResponse;
      const nextPotential = nextData.insights?.solarPotential;
      const nextPanelCount = Math.min(32, nextPotential?.solarPanels.length || 0);

      setData(nextData);
      setPanelCount(nextPanelCount);
      setViewMode("panels");
      clearMap3dPanels();

      googleMapRef.current?.setCenter({ lat: nextData.location.latitude, lng: nextData.location.longitude });
      googleMapRef.current?.setZoom(21);
      recenterMap3d(nextData.location, 260);

      if (!nextData.insights && nextData.solarError) {
        setError(`${nextData.solarError} Click the exact roof on the map to pinpoint the building.`);
      }
    });
  }

  function lookupCoordinates(latitude: number, longitude: number) {
    const modeAfterLookup = viewMode;

    setError("");

    startTransition(async () => {
      const response = await fetch(`/api/solar?lat=${latitude.toFixed(7)}&lng=${longitude.toFixed(7)}`);
      const body = await response.json();

      if (!response.ok) {
        setError(body.error || "Solar lookup failed for clicked point.");
        return;
      }

      const nextData = body as SolarResponse;
      const nextPotential = nextData.insights?.solarPotential;
      const nextPanelCount = Math.min(32, nextPotential?.solarPanels.length || 0);

      setData(nextData);
      setPanelCount(nextPanelCount);
      setViewMode(modeAfterLookup);

      googleMapRef.current?.setCenter({
        lat: nextData.insights?.center.latitude || latitude,
        lng: nextData.insights?.center.longitude || longitude,
      });
      googleMapRef.current?.setZoom(21);

      if (modeAfterLookup !== "3d") {
        recenterMap3d(nextData.insights?.center || { latitude, longitude }, default3dRange);
      }
    });
  }

  const lookupCoordinatesEvent = useEffectEvent((latitude: number, longitude: number) => {
    lookupCoordinates(latitude, longitude);
  });

  function drawGoogleMapPanels(nextInsights: BuildingInsights | undefined, count: number) {
    const map = googleMapRef.current;

    panelPolygonsRef.current.forEach((polygon) => polygon.setMap(null));
    panelPolygonsRef.current = [];
    buildingBoundsRef.current?.setMap(null);
    buildingBoundsRef.current = null;

    if (!map || !nextInsights || !google.maps.geometry?.spherical) {
      return;
    }

    const { solarPanels, roofSegmentStats, panelWidthMeters, panelHeightMeters } = nextInsights.solarPotential;
    const energies = solarPanels.map((panel) => panel.yearlyEnergyDcKwh);
    const minEnergy = Math.min(...energies);
    const maxEnergy = Math.max(...energies);

    solarPanels.slice(0, count).forEach((panel) => {
      const segment = roofSegmentStats[panel.segmentIndex] || roofSegmentStats[0];
      const halfWidth = panelWidthMeters / 2;
      const halfHeight = panelHeightMeters / 2;
      const orientation = panel.orientation === "PORTRAIT" ? 90 : 0;
      const azimuth = segment?.azimuthDegrees || 0;
      const center = { lat: panel.center.latitude, lng: panel.center.longitude };
      const panelColor = panelEnergyColor(panel.yearlyEnergyDcKwh, minEnergy, maxEnergy);

      const corners = [
        { x: halfWidth, y: halfHeight },
        { x: halfWidth, y: -halfHeight },
        { x: -halfWidth, y: -halfHeight },
        { x: -halfWidth, y: halfHeight },
      ].map(({ x, y }) =>
        google.maps.geometry.spherical.computeOffset(
          center,
          Math.sqrt(x * x + y * y),
          Math.atan2(y, x) * (180 / Math.PI) + orientation + azimuth,
        ),
      );

      const polygon = new google.maps.Polygon({
        paths: corners,
        strokeColor: "#f8fafc",
        strokeOpacity: 1,
        strokeWeight: 1,
        fillColor: panelColor,
        fillOpacity: 0.92,
        map,
      });

      panelPolygonsRef.current.push(polygon);
    });

    if (nextInsights.boundingBox) {
      buildingBoundsRef.current = new google.maps.Rectangle({
        bounds: {
          south: nextInsights.boundingBox.sw.latitude,
          west: nextInsights.boundingBox.sw.longitude,
          north: nextInsights.boundingBox.ne.latitude,
          east: nextInsights.boundingBox.ne.longitude,
        },
        strokeColor: "#facc15",
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillColor: "#facc15",
        fillOpacity: 0.08,
        map,
      });

      map.fitBounds(buildingBoundsRef.current.getBounds()!, 80);
    } else {
      map.setCenter({ lat: nextInsights.center.latitude, lng: nextInsights.center.longitude });
      map.setZoom(21);
    }
  }

  useEffect(() => {
    if (!mapKey || !mapElementRef.current || googleMapRef.current) {
      return;
    }

    setOptions({ key: mapKey, v: "alpha", libraries: ["geometry"], mapIds: [mapId] });
    Promise.all([importLibrary("maps"), importLibrary("geometry")]).then(([maps]) => {
      if (!mapElementRef.current || googleMapRef.current) {
        return;
      }

      googleMapRef.current = new maps.Map(mapElementRef.current, {
        center: { lat: initialViewState.latitude, lng: initialViewState.longitude },
        zoom: 21,
        mapId,
        mapTypeId: "satellite",
        renderingType: google.maps.RenderingType.VECTOR,
        tilt: 0,
        heading: initialViewState.bearing,
        mapTypeControl: false,
        fullscreenControl: false,
        streetViewControl: false,
      });

      googleMapRef.current.addListener("click", (event: google.maps.MapMouseEvent) => {
        const clicked = event.latLng;

        if (!clicked) {
          return;
        }

        if ((googleMapRef.current?.getTilt() || 0) < 1) {
          clickedCircleRef.current?.setMap(null);
          clickedCircleRef.current = new google.maps.Circle({
            center: clicked,
            radius: 2.8,
            map: googleMapRef.current,
            strokeColor: "#ffffff",
            strokeOpacity: 1,
            strokeWeight: 2,
            fillColor: "#facc15",
            fillOpacity: 0.95,
          });
        }

        lookupCoordinatesEvent(clicked.lat(), clicked.lng());
      });

      setMapReady(true);
    });
  }, [mapId, mapKey]);

  useEffect(() => {
    if (viewMode !== "panels") {
      panelPolygonsRef.current.forEach((polygon) => polygon.setMap(null));
      panelPolygonsRef.current = [];
      buildingBoundsRef.current?.setMap(null);
      buildingBoundsRef.current = null;
      return;
    }

    drawGoogleMapPanels(data?.insights || undefined, selectedPanels);
  }, [data?.insights, mapReady, selectedPanels, viewMode]);

  useEffect(() => {
    if (!mapKey || !map3dElementRef.current || map3dRef.current) {
      return;
    }

    Promise.all([importLibrary("maps3d"), importLibrary("geometry")]).then(([maps3d]) => {
      if (!map3dElementRef.current || map3dRef.current) {
        return;
      }

      const map3d = new maps3d.Map3DElement({
        center: { lat: initialViewState.latitude, lng: initialViewState.longitude, altitude: 0 },
        range: default3dRange,
        tilt: 67,
        heading: initialViewState.bearing,
        mode: maps3d.MapMode.SATELLITE,
        mapId,
        defaultUIHidden: true,
        gestureHandling: maps3d.GestureHandling.GREEDY,
      });
      map3d.style.display = "block";
      map3d.style.height = "100%";
      map3d.style.width = "100%";

      map3d.addEventListener("gmp-click", (event) => {
        const position = (event as google.maps.maps3d.LocationClickEvent).position;

        if (!position) {
          return;
        }

        lookupCoordinatesEvent(position.lat, position.lng);
      });

      map3dElementRef.current.append(map3d);
      map3dRef.current = map3d;
    });
  }, [mapId, mapKey]);

  useEffect(() => {
    if (viewMode !== "3d") {
      return;
    }

    panelPolygonsRef.current.forEach((polygon) => polygon.setMap(null));
    buildingBoundsRef.current?.setMap(null);
    buildingBoundsRef.current = null;
    clickedCircleRef.current?.setMap(null);
    clickedCircleRef.current = null;
  }, [viewMode]);

  useEffect(() => {
    const map3d = map3dRef.current;

    if (!map3d || viewMode !== "3d" || !insights || !google.maps.geometry?.spherical) {
      clearMap3dPanels();
      return;
    }

    clearMap3dPanels();
    map3dPanelsRef.current = createMap3dPanelElements(insights, selectedPanels);
    map3dPanelsRef.current.forEach((panel) => map3d.append(panel));
  }, [insights, selectedPanels, viewMode]);

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <section className="grid min-h-screen grid-cols-1 lg:grid-cols-[380px_1fr]">
        <aside className="z-10 border-b border-white/10 bg-[#080b12]/95 p-5 shadow-2xl backdrop-blur lg:border-b-0 lg:border-r">
          <div className="mb-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.32em] text-cyan-300">
              Solar building viewer
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              Photorealistic roof + panel simulation
            </h1>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Enter an address, fetch Google Solar building insights, and overlay simulated panels on native Google photorealistic 3D maps.
            </p>
          </div>

          <form onSubmit={submitAddress} className="space-y-3">
            <label className="block text-sm font-medium text-slate-200" htmlFor="address">
              Building address
            </label>
            <textarea
              id="address"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              rows={3}
              className="w-full rounded-2xl border border-white/10 bg-white/8 px-4 py-3 text-sm text-white outline-none ring-cyan-300/40 transition focus:border-cyan-300 focus:ring-4"
            />
            <button
              type="submit"
              disabled={isPending}
              className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? "Searching..." : "Search and simulate"}
            </button>
          </form>

          {error ? (
            <div className="mt-4 rounded-2xl border border-red-400/40 bg-red-950/50 p-4 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          {potential ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Matched building</p>
                <p className="mt-2 text-sm text-slate-100">{data?.formattedAddress}</p>
                <div className="mt-3 flex gap-2 text-xs text-slate-300">
                  <span className="rounded-full bg-white/10 px-3 py-1">{insights?.imageryQuality || "BASE"}</span>
                  <span className="rounded-full bg-white/10 px-3 py-1">{insights?.regionCode || "--"}</span>
                  {data?.mock ? <span className="rounded-full bg-amber-300/20 px-3 py-1 text-amber-100">Mock data</span> : null}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">
                  Panel mode uses the same approach as solarpoints: Google Maps polygons from Solar API panel centers, dimensions, orientation, and roof azimuth.
                  If the address chooses the wrong roof, click the exact roof in the map.
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-slate-100" htmlFor="panels">
                    Simulated panels
                  </label>
                  <span className="text-lg font-semibold text-cyan-200">{selectedPanels}</span>
                </div>
                <input
                  id="panels"
                  type="range"
                  min="0"
                  max={maxPanels}
                  value={selectedPanels}
                  onChange={(event) => setPanelCount(Number(event.target.value))}
                  className="w-full accent-cyan-300"
                />
                <p className="mt-2 text-xs text-slate-400">Max from Solar API: {maxPanels} panels</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <Metric label="Annual DC energy" value={`${Math.round(annualEnergy).toLocaleString()} kWh`} />
                <Metric label="Panel capacity" value={`${potential.panelCapacityWatts} W`} />
                <Metric label="Roof segments" value={`${potential.roofSegmentStats.length}`} />
                <Metric label="Max sunshine" value={`${Math.round(potential.maxSunshineHoursPerYear)} h/yr`} />
                <Metric label="Roof area" value={`${Math.round(potential.wholeRoofStats?.areaMeters2 || potential.maxArrayAreaMeters2)} m2`} />
                <Metric label="Sun quality" value={confidenceLabel(insights?.imageryQuality)} />
              </div>
              {sunshineQuantiles.length ? <SunshineBars quantiles={sunshineQuantiles} /> : null}
            </div>
          ) : (
            <div className="mt-6 rounded-3xl border border-dashed border-white/15 p-4 text-sm leading-6 text-slate-300">
              Search an address, or click the exact roof on the satellite map if Google geocoding selects the wrong building.
            </div>
          )}
        </aside>

        <section className="relative min-h-[62vh] lg:min-h-screen">
          <div
            className={`absolute inset-0 transition-opacity ${viewMode === "panels" ? "z-10 opacity-100" : "z-0 opacity-0 pointer-events-none"}`}
            ref={mapElementRef}
          />
          <div
            className={`absolute inset-0 transition-opacity ${viewMode === "3d" ? "z-10 opacity-100" : "z-0 opacity-0 pointer-events-none"}`}
            ref={map3dElementRef}
          />
          {!mapKey ? (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/90 p-8 text-center">
              <div className="max-w-md rounded-3xl border border-white/10 bg-white/10 p-6">
                <h2 className="text-xl font-semibold">Missing public Maps key</h2>
                <p className="mt-2 text-sm text-slate-300">
                  Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to show Google photorealistic 3D maps. For production, also set NEXT_PUBLIC_GOOGLE_MAP_ID.
                </p>
              </div>
            </div>
          ) : null}
          <div className="pointer-events-none absolute bottom-4 left-4 right-4 z-20 rounded-2xl border border-white/10 bg-black/45 px-4 py-3 text-xs text-slate-200 backdrop-blur">
            Click a roof in Panels or 3D mode to pinpoint the building. 3D mode uses native gmp-map-3d-style photorealistic maps plus Solar API panel polygons.
          </div>
          <div className="absolute right-4 top-4 z-20 flex flex-col gap-2 rounded-2xl border border-white/10 bg-black/45 p-2 text-xs backdrop-blur">
            <div className="grid grid-cols-2 gap-2">
                <CameraButton active={viewMode === "panels"} label="Panels" onClick={() => setViewMode("panels")} />
                <CameraButton active={viewMode === "3d"} label="3D view" onClick={() => setViewMode("3d")} />
            </div>
            {viewMode === "3d" ? <p className="max-w-48 px-2 pb-1 text-slate-300">Drag, scroll, and use touch gestures to move freely.</p> : null}
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/8 p-4">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 font-semibold text-white">{value}</p>
    </div>
  );
}

function SunshineBars({ quantiles }: { quantiles: number[] }) {
  const max = Math.max(...quantiles, 1);

  return (
    <div className="rounded-3xl border border-white/10 bg-white/8 p-4">
      <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Sunshine distribution</p>
      <div className="mt-4 flex h-16 items-end gap-1.5">
        {quantiles.map((value, index) => (
          <div
            key={`${value}-${index}`}
            className="flex-1 rounded-t bg-cyan-300/80"
            style={{ height: `${Math.max(8, (value / max) * 100)}%` }}
            title={`${Math.round(value)} sunshine hours`}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">From Solar API roof sunshine quantiles. Treat as pre-assessment, not final engineering design.</p>
    </div>
  );
}

function CameraButton({ active = false, label, onClick }: { active?: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-3 py-2 font-semibold transition ${
        active ? "border-cyan-200 bg-cyan-300 text-slate-950" : "border-white/10 bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {label}
    </button>
  );
}

function panelEnergyColor(energy: number, min: number, max: number) {
  const value = max === min ? 1 : Math.max(0, Math.min(1, (energy - min) / (max - min)));
  const hue = 205 - value * 165;

  return `hsl(${hue} 95% 55%)`;
}

function confidenceLabel(quality: BuildingInsights["imageryQuality"] | undefined) {
  if (quality === "HIGH") {
    return "High";
  }

  if (quality === "MEDIUM") {
    return "Medium";
  }

  return "Directional";
}

function createMap3dPanelElements(insights: BuildingInsights, count: number) {
  const { panelHeightMeters, panelWidthMeters, roofSegmentStats, solarPanels } = insights.solarPotential;
  const energies = solarPanels.map((panel) => panel.yearlyEnergyDcKwh);
  const minEnergy = Math.min(...energies);
  const maxEnergy = Math.max(...energies);

  return solarPanels.slice(0, count).map((panel, index) => {
    const segment = roofSegmentStats[panel.segmentIndex] || roofSegmentStats[0];
    const halfWidth = (panel.orientation === "PORTRAIT" ? panelHeightMeters : panelWidthMeters) / 2;
    const halfHeight = (panel.orientation === "PORTRAIT" ? panelWidthMeters : panelHeightMeters) / 2;
    const azimuth = segment?.azimuthDegrees || 0;
    const center = { lat: panel.center.latitude, lng: panel.center.longitude };
    const altitude = 0.75 + index * 0.002;
    const path = [
      { x: halfWidth, y: halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: -halfWidth, y: -halfHeight },
      { x: -halfWidth, y: halfHeight },
    ].map(({ x, y }) => {
      const alongSlope = google.maps.geometry.spherical.computeOffset(center, y, azimuth);
      const corner = google.maps.geometry.spherical.computeOffset(alongSlope, x, azimuth + 90);

      return { lat: corner.lat(), lng: corner.lng(), altitude };
    });

    return new google.maps.maps3d.Polygon3DElement({
      path,
      altitudeMode: google.maps.maps3d.AltitudeMode.RELATIVE_TO_MESH,
      fillColor: panelEnergyColor(panel.yearlyEnergyDcKwh, minEnergy, maxEnergy),
      strokeColor: "#ecfeff",
      strokeWidth: 1.2,
      drawsOccludedSegments: false,
      geodesic: false,
      zIndex: index + 1,
    });
  });
}
