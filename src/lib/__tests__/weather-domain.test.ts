import { describe, expect, it } from "vitest";
import { deriveForecastAlert, weatherDescription, weatherIcon } from "../weather-domain";

describe("weather presentation", () => {
  it("maps WMO weather codes to readable labels and icons", () => {
    expect(weatherDescription(0)).toBe("Despejado");
    expect(weatherIcon(0, false)).toBe("moon");
    expect(weatherDescription(95)).toBe("Tormenta");
    expect(weatherIcon(95)).toBe("cloud-lightning");
  });

  it("does not invent a warning for ordinary conditions", () => {
    expect(deriveForecastAlert({
      weatherCode: [0, 1, 2],
      temperatureC: [21, 24, 26],
      precipitationMm: [0, 0, 0],
      windGustKmh: [8, 12, 15]
    })).toBeNull();
  });

  it("raises the warning level for strong storms", () => {
    const alert = deriveForecastAlert({
      weatherCode: [2, 95, 99],
      temperatureC: [27, 25, 23],
      precipitationMm: [0, 8, 18],
      windGustKmh: [20, 56, 76]
    });
    expect(alert).toMatchObject({ level: "red", official: false, source: "Open-Meteo" });
  });
});
