const express = require("express");
const path = require("path");
const fs = require("fs");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const app = express();
const PORT = process.env.PORT || 3000;

const CLIMATE_BASE = "https://ru.climate-data.org";

// Пути к континентам на сайте (как на главной странице)
const CONTINENT_PATHS = [
  "/%d0%be%d0%ba%d0%b5%d0%b0%d0%bd%d0%b8%d1%8f/",
  "/%d0%b5%d0%b2%d1%80%d0%be%d0%bf%d0%b0/",
  "/%d0%b0%d0%b7%d0%b8%d1%8f/",
  "/%d1%8e%d0%b6%d0%bd%d0%b0%d1%8f-%d0%b0%d0%bc%d0%b5%d1%80%d0%b8%d0%ba%d0%b0/",
  "/%d1%81%d0%b5%d0%b2%d0%b5%d1%80%d0%bd%d0%b0%d1%8f-%d0%b0%d0%bc%d0%b5%d1%80%d0%b8%d0%ba%d0%b0/",
  "/%d0%b0%d1%84%d1%80%d0%b8%d0%ba%d0%b0/"
];

const MAX_LINKS_PER_CONTINENT = 400; // ограничение, чтобы не молотить сайт слишком сильно

const CACHE_PATH = path.join(__dirname, "cities-cache.json");

/** @type {Array<{name: string, urlPath: string, locationId: string, lat?: number, lon?: number}>} */
let cities = [];

function loadCitiesCache() {
  if (fs.existsSync(CACHE_PATH)) {
    try {
      const raw = fs.readFileSync(CACHE_PATH, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        cities = data;
        console.log(`Загружено городов из кэша: ${cities.length}`);
      }
    } catch (e) {
      console.error("Не удалось прочитать cities-cache.json:", e);
    }
  }
}

function saveCitiesCache() {
  try {
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cities, null, 2), "utf8");
  } catch (e) {
    console.error("Не удалось сохранить cities-cache.json:", e);
  }
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ClimateQuiz/1.0 (contact: example@example.com)"
    }
  });
  if (!res.ok) {
    throw new Error(`Ошибка загрузки ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// Извлекаем ссылки на города/локации с континентальной страницы.
async function scrapeContinent(continentPath) {
  const url = CLIMATE_BASE + continentPath;
  console.log("Скрапим континент:", url);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const links = [];

  $("a[href^='/']").each((_, el) => {
    const href = $(el).attr("href");
    const text = $(el).text().trim();
    if (!href || !text) return;

    // Ищем ссылки вида ...-12345/
    const m = href.match(/-(\d+)\/$/);
    if (!m) return;

    const id = m[1];
    links.push({
      name: text,
      urlPath: href,
      locationId: id
    });
  });

  // Обрежем до разумного числа, чтобы не перегружать ни сайт, ни геокодер
  const uniqueById = new Map();
  for (const loc of links) {
    if (!uniqueById.has(loc.locationId)) {
      uniqueById.set(loc.locationId, loc);
    }
  }
  const result = Array.from(uniqueById.values()).slice(0, MAX_LINKS_PER_CONTINENT);
  console.log(`Найдено локаций на континенте: ${result.length}`);
  return result;
}

async function ensureCitiesLoaded() {
  if (cities.length > 0) return;

  loadCitiesCache();
  if (cities.length > 0) return;

  console.log("Кэш пуст, начинаем первичный сбор городов с ru.climate-data.org...");
  const all = [];
  for (const continent of CONTINENT_PATHS) {
    try {
      const part = await scrapeContinent(continent);
      all.push(...part);
    } catch (e) {
      console.error("Ошибка при скрапинге континента", continent, e.message);
    }
  }
  cities = all;
  console.log(`Всего локаций собрано: ${cities.length}`);
  saveCitiesCache();
}

async function geocodeWithNominatim(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(query);
  console.log("Геокодируем:", query);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ClimateQuiz/1.0 (contact: example@example.com)"
    }
  });
  if (!res.ok) {
    throw new Error(`Ошибка геокодера: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    return null;
  }
  const item = data[0];
  return {
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon)
  };
}

// Выбор случайного города с гарантированными координатами
async function getRandomCityWithCoords() {
  await ensureCitiesLoaded();
  if (cities.length === 0) {
    throw new Error("Список городов пуст.");
  }

  // Попробуем несколько раз найти город, который сможем успешно геокодировать.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const idx = Math.floor(Math.random() * cities.length);
    const loc = cities[idx];

    if (loc.lat != null && loc.lon != null) {
      return loc;
    }

    try {
      const geo = await geocodeWithNominatim(loc.name);
      if (!geo) {
        console.warn("Не удалось геокодировать:", loc.name);
        continue;
      }
      loc.lat = geo.lat;
      loc.lon = geo.lon;
      saveCitiesCache();
      return loc;
    } catch (e) {
      console.error("Ошибка при геокодировании", loc.name, e.message);
    }
  }

  throw new Error("Не удалось получить координаты ни для одного случайного города.");
}

// API: возвращает случайный город
app.get("/api/random-city", async (req, res) => {
  try {
    const loc = await getRandomCityWithCoords();
    const climateImageUrl = `https://images.climate-data.org/location/${loc.locationId}/climate-graph-200.png`;

    res.json({
      name: loc.name,
      // Страна из URL (второй сегмент после континента), сильно упрощённо.
      country: null,
      climateImageUrl,
      lat: loc.lat,
      lon: loc.lon
    });
  } catch (e) {
    console.error("/api/random-city error:", e.message);
    res.status(500).json({ error: "Не удалось получить случайный город" });
  }
});

// Статика фронтенда
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});

