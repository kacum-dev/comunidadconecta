import "server-only";

import type { AuthContext } from "./auth";
import { ApiError } from "./api";
import { withTenant } from "./db";
import { getEnabledIntegrationCredential } from "./settings";
import {
  deriveForecastAlert,
  weatherDescription,
  weatherIcon,
  type WeatherAlert,
  type WeatherAlertLevel,
  type WeatherForecastSeries,
  type WeatherSnapshot
} from "./weather-domain";

type CommunityLocation = {
  postalCode: string;
  city: string;
  province: string;
  countryCode: string;
};

type GeocodingResponse = {
  results?: Array<{
    name: string;
    latitude: number;
    longitude: number;
    admin1?: string;
  }>;
};

type ForecastResponse = {
  current?: {
    temperature_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    precipitation?: number;
    weather_code?: number;
    wind_gusts_10m?: number;
  };
  hourly?: {
    weather_code?: number[];
    temperature_2m?: number[];
    precipitation?: number[];
    wind_gusts_10m?: number[];
  };
};

type CachedWeather = { value: WeatherSnapshot; freshUntil: number; staleUntil: number };

declare global {
  var comunidadConectaWeatherCache: Map<string, CachedWeather> | undefined;
}

const weatherCache = global.comunidadConectaWeatherCache ?? new Map<string, CachedWeather>();
global.comunidadConectaWeatherCache = weatherCache;

const AEMET_AREA_BY_PROVINCE: Record<string, string> = {
  almeria: "61", cadiz: "61", cordoba: "61", granada: "61", huelva: "61", jaen: "61", malaga: "61", sevilla: "61",
  huesca: "62", teruel: "62", zaragoza: "62",
  asturias: "63",
  baleares: "64", "illes balears": "64",
  "las palmas": "65", "santa cruz de tenerife": "65",
  cantabria: "66",
  avila: "67", burgos: "67", leon: "67", palencia: "67", salamanca: "67", segovia: "67", soria: "67", valladolid: "67", zamora: "67",
  albacete: "68", "ciudad real": "68", cuenca: "68", guadalajara: "68", toledo: "68",
  barcelona: "69", girona: "69", lerida: "69", lleida: "69", tarragona: "69",
  badajoz: "70", caceres: "70",
  "a coruna": "71", coruna: "71", lugo: "71", ourense: "71", pontevedra: "71",
  madrid: "72",
  murcia: "73",
  navarra: "74",
  alava: "75", araba: "75", bizkaia: "75", vizcaya: "75", gipuzkoa: "75", guipuzcoa: "75",
  "la rioja": "76", rioja: "76",
  alicante: "77", castello: "77", castellon: "77", valencia: "77",
  ceuta: "78", melilla: "79"
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function asNumber(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function getCommunityLocation(context: AuthContext): Promise<CommunityLocation> {
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query<{
      postal_code: string | null;
      city: string | null;
      province: string | null;
      country_code: string;
    }>(
      `SELECT postal_code, city, province, country_code
         FROM communities
        WHERE id=$1`,
      [context.current.communityId]
    );
    const row = result.rows[0];
    if (!row) throw new ApiError(404, "La comunidad no está disponible.", "not_found");
    return {
      postalCode: row.postal_code?.trim() ?? "",
      city: row.city?.trim() ?? "",
      province: row.province?.trim() ?? "",
      countryCode: row.country_code.trim().toLowerCase()
    };
  });
}

async function fetchJson<T>(url: URL, timeoutMs = 7_000): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Comunidad-Conecta/1.0" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Weather provider returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function geocode(location: CommunityLocation, apiKey: string | null) {
  const searchTerms = [location.postalCode, location.city, location.province].filter(Boolean);
  for (const searchTerm of searchTerms) {
    const url = new URL(apiKey ? "https://customer-geocoding-api.open-meteo.com/v1/search" : "https://geocoding-api.open-meteo.com/v1/search");
    url.searchParams.set("name", searchTerm);
    url.searchParams.set("count", "5");
    url.searchParams.set("language", "es");
    url.searchParams.set("format", "json");
    if (location.countryCode) url.searchParams.set("countryCode", location.countryCode);
    if (apiKey) url.searchParams.set("apikey", apiKey);
    const response = await fetchJson<GeocodingResponse>(url);
    const result = response.results?.[0];
    if (result && Number.isFinite(result.latitude) && Number.isFinite(result.longitude)) return result;
  }
  throw new ApiError(422, "Configura el municipio o el código postal de la comunidad para mostrar el tiempo.", "weather_location_missing");
}

function decodeXml(value: string) {
  return value
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function xmlTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function tarEntries(buffer: Buffer) {
  const entries: Array<{ name: string; content: string }> = [];
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isFinite(size) || size < 0 || offset + 512 + size > buffer.length) break;
    const content = buffer.subarray(offset + 512, offset + 512 + size).toString("utf8");
    entries.push({ name, content });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function aemetAlertFromXml(xml: string): WeatherAlert | null {
  const infoBlocks = Array.from(xml.matchAll(/<(?:\w+:)?info\b[^>]*>([\s\S]*?)<\/(?:\w+:)?info>/gi), (match) => match[1]);
  const info = infoBlocks.find((block) => /^es/i.test(xmlTag(block, "language"))) ?? infoBlocks[0];
  if (!info) return null;
  const severity = xmlTag(info, "severity").toLowerCase();
  const levelBySeverity: Record<string, WeatherAlertLevel> = { moderate: "yellow", severe: "orange", extreme: "red" };
  const level = levelBySeverity[severity];
  if (!level) return null;
  const expires = xmlTag(info, "expires");
  if (expires && Date.parse(expires) < Date.now()) return null;
  const title = xmlTag(info, "headline") || xmlTag(info, "event") || "Aviso meteorológico";
  const area = xmlTag(info, "areaDesc");
  const description = xmlTag(info, "description");
  return {
    title,
    detail: area || description || "Consulta las recomendaciones oficiales.",
    level,
    official: true,
    source: "AEMET",
    validUntil: expires || null
  };
}

async function fetchAemetAlert(context: AuthContext, province: string) {
  const area = AEMET_AREA_BY_PROVINCE[normalize(province)];
  if (!area) return null;
  const credential = await getEnabledIntegrationCredential(context, "weather", "AEMET");
  if (!credential) return null;

  const metadataUrl = new URL(`https://opendata.aemet.es/opendata/api/avisos_cap/ultimoelaborado/area/${area}`);
  metadataUrl.searchParams.set("api_key", credential);
  const metadata = await fetchJson<{ estado?: number; datos?: string }>(metadataUrl);
  if (metadata.estado !== 200 || !metadata.datos) return null;
  const dataUrl = new URL(metadata.datos);
  if (dataUrl.protocol !== "https:" || dataUrl.hostname !== "opendata.aemet.es") return null;
  const response = await fetch(dataUrl, { signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return null;
  const entries = tarEntries(Buffer.from(await response.arrayBuffer()));
  const alerts = entries.map((entry) => aemetAlertFromXml(entry.content)).filter((alert): alert is WeatherAlert => Boolean(alert));
  const priority: Record<WeatherAlertLevel, number> = { yellow: 1, orange: 2, red: 3 };
  return alerts.sort((a, b) => priority[b.level] - priority[a.level])[0] ?? null;
}

async function loadWeather(context: AuthContext): Promise<WeatherSnapshot> {
  const location = await getCommunityLocation(context);
  const openMeteoCredential = await getEnabledIntegrationCredential(context, "weather", "Open-Meteo").catch(() => null);
  const coordinates = await geocode(location, openMeteoCredential);
  const forecastUrl = new URL(openMeteoCredential ? "https://customer-api.open-meteo.com/v1/forecast" : "https://api.open-meteo.com/v1/forecast");
  forecastUrl.searchParams.set("latitude", String(coordinates.latitude));
  forecastUrl.searchParams.set("longitude", String(coordinates.longitude));
  forecastUrl.searchParams.set("current", "temperature_2m,apparent_temperature,is_day,precipitation,weather_code,wind_gusts_10m");
  forecastUrl.searchParams.set("hourly", "temperature_2m,precipitation,weather_code,wind_gusts_10m");
  forecastUrl.searchParams.set("forecast_hours", "12");
  forecastUrl.searchParams.set("timezone", "auto");
  if (openMeteoCredential) forecastUrl.searchParams.set("apikey", openMeteoCredential);
  const forecast = await fetchJson<ForecastResponse>(forecastUrl);
  if (!forecast.current) throw new Error("Weather provider returned no current conditions");

  const currentCode = asNumber(forecast.current.weather_code);
  const isDay = asNumber(forecast.current.is_day, 1) === 1;
  const series: WeatherForecastSeries = {
    weatherCode: forecast.hourly?.weather_code ?? [],
    temperatureC: forecast.hourly?.temperature_2m ?? [],
    precipitationMm: forecast.hourly?.precipitation ?? [],
    windGustKmh: forecast.hourly?.wind_gusts_10m ?? []
  };
  const officialAlert = await fetchAemetAlert(context, location.province).catch(() => null);
  return {
    location: coordinates.name || location.city || location.province,
    temperatureC: Math.round(asNumber(forecast.current.temperature_2m)),
    apparentTemperatureC: Math.round(asNumber(forecast.current.apparent_temperature)),
    condition: weatherDescription(currentCode),
    icon: weatherIcon(currentCode, isDay),
    isDay,
    windGustKmh: Math.round(asNumber(forecast.current.wind_gusts_10m)),
    precipitationMm: asNumber(forecast.current.precipitation),
    alert: officialAlert ?? deriveForecastAlert(series),
    updatedAt: new Date().toISOString(),
    stale: false
  };
}

export async function getCommunityWeather(context: AuthContext) {
  const now = Date.now();
  const cached = weatherCache.get(context.current.communityId);
  if (cached && cached.freshUntil > now) return cached.value;
  try {
    const value = await loadWeather(context);
    weatherCache.set(context.current.communityId, { value, freshUntil: now + 10 * 60_000, staleUntil: now + 2 * 60 * 60_000 });
    return value;
  } catch (error) {
    if (cached && cached.staleUntil > now) return { ...cached.value, stale: true };
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "El tiempo no está disponible en este momento.", "weather_unavailable");
  }
}
