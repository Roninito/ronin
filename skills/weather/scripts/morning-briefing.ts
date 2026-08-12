/**
 * Morning weather briefing via Open-Meteo (no API key required).
 * Params: --location=... (city/place name; omit or "current" to use WEATHER_DEFAULT_LOCATION)
 */

const WMO_DESCRIPTIONS: Record<number, string> = {
  0: "clear sky",
  1: "mostly clear",
  2: "partly cloudy",
  3: "overcast",
  45: "fog",
  48: "depositing rime fog",
  51: "light drizzle",
  53: "moderate drizzle",
  55: "dense drizzle",
  56: "light freezing drizzle",
  57: "dense freezing drizzle",
  61: "light rain",
  63: "moderate rain",
  65: "heavy rain",
  66: "light freezing rain",
  67: "heavy freezing rain",
  71: "light snow",
  73: "moderate snow",
  75: "heavy snow",
  77: "snow grains",
  80: "light rain showers",
  81: "moderate rain showers",
  82: "violent rain showers",
  85: "light snow showers",
  86: "heavy snow showers",
  95: "thunderstorm",
  96: "thunderstorm with light hail",
  99: "thunderstorm with heavy hail",
};

function describeWeatherCode(code: number): string {
  return WMO_DESCRIPTIONS[code] ?? `weather code ${code}`;
}

function getLocationArg(): string {
  const args = process.argv.slice(2);
  for (const a of args) {
    if (a.startsWith("--location=")) return a.slice(11).trim();
  }
  return "";
}

async function geocode(location: string): Promise<{ name: string; latitude: number; longitude: number; timezone?: string }> {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en&format=json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Geocoding request failed (${response.status}): ${await response.text().catch(() => response.statusText)}`);
  }
  const data = (await response.json()) as { results?: Array<{ name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone?: string }> };
  const match = data.results?.[0];
  if (!match) {
    throw new Error(`Could not find a location matching "${location}"`);
  }
  const label = [match.name, match.admin1, match.country].filter(Boolean).join(", ");
  return { name: label, latitude: match.latitude, longitude: match.longitude, timezone: match.timezone };
}

interface ForecastData {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
  };
  daily: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
}

async function getForecast(latitude: number, longitude: number): Promise<ForecastData> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Forecast request failed (${response.status}): ${await response.text().catch(() => response.statusText)}`);
  }
  return (await response.json()) as ForecastData;
}

function buildBriefing(locationLabel: string, forecast: ForecastData): { briefing: string; conditions: string } {
  const { current, daily } = forecast;
  const conditionText = describeWeatherCode(current.weather_code);
  const conditions = `${Math.round(current.temperature_2m)}°F, ${conditionText}, feels like ${Math.round(current.apparent_temperature)}°F`;

  const high = Math.round(daily.temperature_2m_max[0]);
  const low = Math.round(daily.temperature_2m_min[0]);
  const precipChance = daily.precipitation_probability_max[0];

  const briefing = [
    `Good morning! Here's the weather for ${locationLabel}:`,
    `Right now: ${conditions}, humidity ${current.relative_humidity_2m}%, wind ${Math.round(current.wind_speed_10m)} mph.`,
    `Today: high of ${high}°F, low of ${low}°F, with a ${precipChance}% chance of precipitation.`,
  ].join(" ");

  return { briefing, conditions };
}

async function main(): Promise<void> {
  try {
    const requested = getLocationArg();
    const location = !requested || requested.toLowerCase() === "current" ? process.env.WEATHER_DEFAULT_LOCATION : requested;

    if (!location) {
      throw new Error(
        'No location given and WEATHER_DEFAULT_LOCATION is not set. Pass --location="City, State" or set WEATHER_DEFAULT_LOCATION in your environment.'
      );
    }

    const place = await geocode(location);
    const forecast = await getForecast(place.latitude, place.longitude);
    const { briefing, conditions } = buildBriefing(place.name, forecast);

    console.log(JSON.stringify({ success: true, briefing, conditions }));
  } catch (e) {
    console.log(JSON.stringify({ success: false, error: (e as Error).message }));
    process.exit(1);
  }
}

main();
