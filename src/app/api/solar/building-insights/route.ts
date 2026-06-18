import { NextRequest, NextResponse } from "next/server";

type GeocodeResponse = {
  status: string;
  error_message?: string;
  results?: Array<{
    formatted_address: string;
    geometry: { location: { lat: number; lng: number } };
  }>;
};

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

  if (!solarKey) {
    return NextResponse.json({ error: "GOOGLE_SOLAR_API_KEY or GOOGLE_API_KEY is required." }, { status: 500 });
  }

  try {
    let location = hasCoordinates ? { lat, lng } : null;
    let formattedAddress = address || `Clicked point (${lat.toFixed(6)}, ${lng.toFixed(6)})`;

    if (!location) {
      if (!geocodingKey || !address) {
        return NextResponse.json({ error: "GOOGLE_GEOCODING_API_KEY or GOOGLE_API_KEY is required." }, { status: 500 });
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

      formattedAddress = geocode.results[0].formatted_address;
      location = geocode.results[0].geometry.location;
    }

    const solarParams = new URLSearchParams({
      "location.latitude": location.lat.toFixed(6),
      "location.longitude": location.lng.toFixed(6),
      requiredQuality: "BASE",
      key: solarKey,
    });
    const solarResponse = await fetch(
      `https://solar.googleapis.com/v1/buildingInsights:findClosest?${solarParams}`,
      { cache: "no-store" },
    );
    const insights = await solarResponse.json();

    if (!solarResponse.ok) {
      return NextResponse.json(insights, { status: solarResponse.status });
    }

    return NextResponse.json({
      query: { address, location, formattedAddress },
      ...insights,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected request failure." },
      { status: 500 },
    );
  }
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
