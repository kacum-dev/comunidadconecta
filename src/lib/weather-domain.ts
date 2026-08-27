export type WeatherAlertLevel = "yellow" | "orange" | "red";

export interface WeatherAlert {
  title: string;
  detail: string;
  level: WeatherAlertLevel;
  official: boolean;
  source: "AEMET" | "Open-Meteo";
  validUntil: string | null;
}

export interface WeatherSnapshot {
  location: string;
  temperatureC: number;
  apparentTemperatureC: number;
  condition: string;
  icon: string;
  isDay: boolean;
  windGustKmh: number;
  precipitationMm: number;
  alert: WeatherAlert | null;
  updatedAt: string;
  stale: boolean;
}

export interface WeatherForecastSeries {
  weatherCode: number[];
  temperatureC: number[];
  precipitationMm: number[];
  windGustKmh: number[];
}

export function weatherDescription(code: number) {
  if (code === 0) return "Despejado";
  if (code <= 2) return "Poco nuboso";
  if (code === 3) return "Cubierto";
  if (code === 45 || code === 48) return "Niebla";
  if (code >= 51 && code <= 57) return "Llovizna";
  if (code >= 61 && code <= 67) return "Lluvia";
  if (code >= 71 && code <= 77) return "Nieve";
  if (code >= 80 && code <= 82) return "Chubascos";
  if (code >= 85 && code <= 86) return "Nieve intensa";
  if (code >= 95) return "Tormenta";
  return "Tiempo variable";
}

export function weatherIcon(code: number, isDay = true) {
  if (code === 0) return isDay ? "sun" : "moon";
  if (code <= 2) return "cloud-sun";
  if (code === 3 || code === 45 || code === 48) return "cloud";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "cloud-rain";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "snowflake";
  if (code >= 95) return "cloud-lightning";
  return "cloud-sun";
}

function maximum(values: number[]) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length ? Math.max(...finiteValues) : 0;
}

export function deriveForecastAlert(series: WeatherForecastSeries): WeatherAlert | null {
  const codes = series.weatherCode.filter(Number.isFinite);
  const maxTemperature = maximum(series.temperatureC);
  const finiteTemperatures = series.temperatureC.filter(Number.isFinite);
  const minTemperature = finiteTemperatures.length ? Math.min(...finiteTemperatures) : 0;
  const maxPrecipitation = maximum(series.precipitationMm);
  const maxGust = maximum(series.windGustKmh);
  const severeStorm = codes.some((code) => code === 96 || code === 99);
  const storm = codes.some((code) => code >= 95);

  if (severeStorm || maxGust >= 100 || maxPrecipitation >= 40 || maxTemperature >= 44 || minTemperature <= -10) {
    return { title: severeStorm ? "Tormentas fuertes previstas" : "Fenómeno meteorológico intenso", detail: "La previsión de las próximas horas aconseja extremar la precaución.", level: "red", official: false, source: "Open-Meteo", validUntil: null };
  }
  if (storm || maxGust >= 80 || maxPrecipitation >= 20 || maxTemperature >= 41 || minTemperature <= -6) {
    return { title: storm ? "Tormentas previstas" : maxGust >= 80 ? "Rachas de viento muy fuertes" : "Previsión meteorológica adversa", detail: "Consulta la evolución antes de realizar actividades en el exterior.", level: "orange", official: false, source: "Open-Meteo", validUntil: null };
  }
  if (maxGust >= 60 || maxPrecipitation >= 10 || maxTemperature >= 38 || minTemperature <= -2 || codes.some((code) => code >= 65)) {
    return { title: maxGust >= 60 ? "Atención al viento" : maxPrecipitation >= 10 ? "Lluvia intensa prevista" : "Cambio meteorológico relevante", detail: "Mantente atento a la previsión durante las próximas horas.", level: "yellow", official: false, source: "Open-Meteo", validUntil: null };
  }
  return null;
}
