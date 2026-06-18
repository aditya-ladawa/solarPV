import { NextRequest, NextResponse } from "next/server";

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
  postalCode?: string;
  administrativeArea?: string;
  regionCode?: string;
  imageryQuality?: "HIGH" | "MEDIUM" | "BASE";
  solarPotential: {
    maxArrayPanelsCount: number;
    panelCapacityWatts: number;
    panelHeightMeters: number;
    panelWidthMeters: number;
    maxSunshineHoursPerYear: number;
    maxArrayAreaMeters2: number;
    roofSegmentStats: RoofSegment[];
    solarPanels: SolarPanel[];
  };
};

type GeocodeResponse = {
  status: string;
  error_message?: string;
  results?: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
};

const mockCenter = { latitude: 52.2799, longitude: 10.5236 };

export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address")?.trim();
  const latParam = request.nextUrl.searchParams.get("lat");
  const lngParam = request.nextUrl.searchParams.get("lng");
  const biasLatParam = request.nextUrl.searchParams.get("biasLat");
  const biasLngParam = request.nextUrl.searchParams.get("biasLng");
  const lat = latParam === null ? NaN : Number(latParam);
  const lng = lngParam === null ? NaN : Number(lngParam);
  const biasLat = biasLatParam === null ? NaN : Number(biasLatParam);
  const biasLng = biasLngParam === null ? NaN : Number(biasLngParam);
  const hasCoordinates = latParam !== null && lngParam !== null && Number.isFinite(lat) && Number.isFinite(lng);
  const hasBias = biasLatParam !== null && biasLngParam !== null && Number.isFinite(biasLat) && Number.isFinite(biasLng);

  if (!address && !hasCoordinates) {
    return NextResponse.json({ error: "Address or lat/lng is required." }, { status: 400 });
  }

  const geocodingKey = process.env.GOOGLE_GEOCODING_API_KEY || process.env.GOOGLE_API_KEY;
  const solarKey = process.env.GOOGLE_SOLAR_API_KEY || process.env.GOOGLE_API_KEY;

  if (!solarKey || (!hasCoordinates && !geocodingKey)) {
    return NextResponse.json({
      address: address || "Clicked map point",
      formattedAddress: `${address || "Clicked map point"} (mock location)`,
      location: mockCenter,
      insights: createMockInsights(),
      mock: true,
    });
  }

  try {
    if (hasCoordinates) {
      const insights = await findClosestSolarBuilding(lat, lng, solarKey);

      return NextResponse.json({
        address: address || "Clicked map point",
        formattedAddress: `Clicked roof point (${lat.toFixed(6)}, ${lng.toFixed(6)})`,
        location: { latitude: lat, longitude: lng },
        insights,
        mock: false,
      });
    }

    if (!address || !geocodingKey) {
      return NextResponse.json({ error: "Address geocoding key is required." }, { status: 400 });
    }

    const geocodeParams = new URLSearchParams({ address, key: geocodingKey });

    if (hasBias) {
      geocodeParams.set("bounds", geocodeBounds(biasLat, biasLng));
    }

    const geocodeResponse = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?${geocodeParams}`,
      { cache: "no-store" },
    );
    const geocode = (await geocodeResponse.json()) as GeocodeResponse;

    if (!geocodeResponse.ok || geocode.status !== "OK" || !geocode.results?.[0]) {
      return NextResponse.json(
        { error: geocode.error_message || `Geocoding failed: ${geocode.status}` },
        { status: 502 },
      );
    }

    const result = geocode.results[0];
    const location = result.geometry.location;
    let insights: BuildingInsights | null = null;
    let solarError = "";

    try {
      insights = await findClosestSolarBuildingNearby(location.lat, location.lng, solarKey);
    } catch (error) {
      solarError = error instanceof Error ? error.message : "Solar API could not find a building for this address.";
    }

    return NextResponse.json({
      address,
      formattedAddress: result.formatted_address,
      location: { latitude: location.lat, longitude: location.lng },
      insights,
      solarError,
      mock: false,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected request failure." },
      { status: 500 },
    );
  }
}

async function findClosestSolarBuildingNearby(latitude: number, longitude: number, apiKey: string) {
  const offsets = [
    [0, 0],
    [12, 0],
    [-12, 0],
    [0, 12],
    [0, -12],
    [24, 0],
    [-24, 0],
    [0, 24],
    [0, -24],
    [18, 18],
    [18, -18],
    [-18, 18],
    [-18, -18],
  ];
  let lastError: unknown;

  for (const [northMeters, eastMeters] of offsets) {
    const point = offsetCoordinate(latitude, longitude, northMeters, eastMeters);

    try {
      return await findClosestSolarBuilding(point.latitude, point.longitude, apiKey);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Solar API request failed.");
}

function offsetCoordinate(latitude: number, longitude: number, northMeters: number, eastMeters: number) {
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos((latitude * Math.PI) / 180);

  return {
    latitude: latitude + northMeters / metersPerDegreeLat,
    longitude: longitude + eastMeters / metersPerDegreeLng,
  };
}

function geocodeBounds(latitude: number, longitude: number) {
  const southWest = offsetCoordinate(latitude, longitude, -18_000, -18_000);
  const northEast = offsetCoordinate(latitude, longitude, 18_000, 18_000);

  return `${southWest.latitude},${southWest.longitude}|${northEast.latitude},${northEast.longitude}`;
}

async function findClosestSolarBuilding(latitude: number, longitude: number, apiKey: string) {
  const solarParams = new URLSearchParams({
    "location.latitude": latitude.toFixed(6),
    "location.longitude": longitude.toFixed(6),
    requiredQuality: "BASE",
    key: apiKey,
  });

  const solarResponse = await fetch(
    `https://solar.googleapis.com/v1/buildingInsights:findClosest?${solarParams}`,
    { cache: "no-store" },
  );
  const insights = (await solarResponse.json()) as BuildingInsights | { error?: { message?: string } };

  if (!solarResponse.ok || !("solarPotential" in insights)) {
    throw new Error(
      "error" in insights ? insights.error?.message || "Solar API request failed." : "Solar API request failed.",
    );
  }

  return insights;
}

function createMockInsights(): BuildingInsights {
  const panels: SolarPanel[] = Array.from({ length: 24 }, (_, index) => {
    const col = index % 6;
    const row = Math.floor(index / 6);

    return {
      center: {
        latitude: mockCenter.latitude + (row - 1.5) * 0.000012,
        longitude: mockCenter.longitude + (col - 2.5) * 0.000018,
      },
      orientation: "LANDSCAPE",
      segmentIndex: 0,
      yearlyEnergyDcKwh: 410,
    };
  });

  return {
    center: mockCenter,
    boundingBox: {
      sw: { latitude: mockCenter.latitude - 0.00008, longitude: mockCenter.longitude - 0.0001 },
      ne: { latitude: mockCenter.latitude + 0.00008, longitude: mockCenter.longitude + 0.0001 },
    },
    postalCode: "38114",
    administrativeArea: "Lower Saxony",
    regionCode: "DE",
    imageryQuality: "BASE",
    solarPotential: {
      maxArrayPanelsCount: panels.length,
      panelCapacityWatts: 400,
      panelHeightMeters: 1.879,
      panelWidthMeters: 1.045,
      maxSunshineHoursPerYear: 950,
      maxArrayAreaMeters2: 47,
      roofSegmentStats: [
        {
          pitchDegrees: 28,
          azimuthDegrees: 170,
          center: mockCenter,
          planeHeightAtCenterMeters: 11,
        },
      ],
      solarPanels: panels,
    },
  };
}
