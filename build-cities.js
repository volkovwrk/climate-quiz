const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const cheerio = require("cheerio");

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

// Ограничение, чтобы не перегружать ни сайт, ни геокодер.
// Чем больше значение, тем больше городов попадёт в выборку (и тем дольше сборка).
const MAX_LINKS_PER_CONTINENT = 3000;

const OUTPUT_PATH = path.join(__dirname, "cities.json");
const CACHE_PATH = path.join(__dirname, "cities-cache-build.json");

/** @type {Array<{name:string,country:string|null,climatePageUrl:string,climateImageUrl:string,lat:number,lon:number}>} */
let finalCities = [];

/** @type {Array<{name:string,urlPath:string,locationId:string,countrySegment:string}>} */
let rawLocations = [];

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ClimateQuizBuild/1.0 (educational project)"
    }
  });
  if (!res.ok) {
    throw new Error(`Ошибка загрузки ${url}: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

// Собираем ссылки на страны для континента (Африка, Азия, Европа и т.п.)
async function scrapeContinent(continentPath) {
  const url = CLIMATE_BASE + continentPath;
  console.log("Скрапим континент:", url);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const countries = new Set();
  const continentSeg = continentPath.split("/").filter(Boolean)[0];

  $("a[href^='/']").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    const parts = href.split("/").filter(Boolean);
    // Страница страны имеет вид /континент/страна-XXX/
    if (parts.length !== 2) return;
    if (parts[0] !== continentSeg) return;

    const m = href.match(/-(\d+)\/$/);
    if (!m) return;

    countries.add(href);
  });

  const result = Array.from(countries);
  console.log(`Найдено стран на континенте: ${result.length}`);
  return result;
}

// Собираем города только из таблицы «Классификации» (колонка «Примеры»)
async function scrapeCountryCities(countryPath) {
  const url = CLIMATE_BASE + countryPath;
  console.log("  Страна:", url);
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const links = [];
  const partsCountry = countryPath.split("/").filter(Boolean);
  const continentSeg = partsCountry[0];
  const countrySlug = (partsCountry[1] || "").replace(/-\d+$/u, "");

  // Берём только ссылки из таблицы классификаций (thead: Классификация, Считать, Кёппен-Гейгер, Примеры)
  const $table = $("table").filter((_, t) => {
    const headers = $(t).find("thead th").map((__, th) => $(th).text().trim()).get();
    return headers.some((h) => /примеры|классификация/i.test(h));
  }).first();

  $table.find("tbody tr td:nth-child(4) a[href^='/']").each((_, el) => {
    const href = $(el).attr("href");
    let text = $(el).text().trim();
    if (!href || !text) return;

    // Убираем префикс "Климат " и похожие
    text = text.replace(/^Климат\s+/iu, "").trim();
    if (!text) return;

    const parts = href.split("/").filter(Boolean);
    // Городские страницы вида /континент/страна/регион/город-XXX/
    if (parts.length < 4) return;
    if (parts[0] !== continentSeg) return;
    if (!parts[1] || !parts[1].startsWith(countrySlug)) return;

    const m = href.match(/-(\d+)\/$/);
    if (!m) return;

    const id = m[1];
    const countrySegment = parts[1] || null;

    links.push({
      name: text,
      urlPath: href,
      locationId: id,
      countrySegment
    });
  });

  const uniqueById = new Map();
  for (const loc of links) {
    if (!uniqueById.has(loc.locationId)) {
      uniqueById.set(loc.locationId, loc);
    }
  }
  const result = Array.from(uniqueById.values());
  console.log(`    Найдено городов: ${result.length}`);
  return result;
}

async function geocodeWithNominatim(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(query);
  console.log("Геокодируем:", query);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "ClimateQuizBuild/1.0 (educational project)"
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

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) return {};
  try {
    const raw = fs.readFileSync(CACHE_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

async function main() {
  console.log("=== Шаг 1. Сбор ссылок на города по континентам ===");
  for (const continent of CONTINENT_PATHS) {
    try {
      const countryPaths = await scrapeContinent(continent);
      for (const countryPath of countryPaths) {
        try {
          const cities = await scrapeCountryCities(countryPath);
          rawLocations.push(...cities);
          await delay(800);
        } catch (e) {
          console.error("Ошибка скрапинга страны", countryPath, e.message);
        }
      }
      // Пауза между континентами
      await delay(2000);
    } catch (e) {
      console.error("Ошибка скрапинга", continent, e.message);
    }
  }

  console.log(`Всего найдено локаций: ${rawLocations.length}`);

  console.log("=== Шаг 2. Геокодирование городов через Nominatim ===");
  const cache = loadCache();

  for (let i = 0; i < rawLocations.length; i += 1) {
    const loc = rawLocations[i];
    let countryHuman = null;
    if (loc.countrySegment) {
      try {
        countryHuman = decodeURIComponent(loc.countrySegment);
      } catch {
        countryHuman = loc.countrySegment;
      }
      countryHuman = countryHuman.replace(/-\d+$/u, "").replace(/-/g, " ");
    }

    // Пропускаем записи, где "город" = страна целиком (типа "Дания", "Австралия"),
    // чтобы в игре были именно города/локации, а не страны.
    if (countryHuman && loc.name === countryHuman) {
      continue;
    }

    const cacheKey = loc.name + "|" + (countryHuman || "");

    if (cache[cacheKey]) {
      finalCities.push(cache[cacheKey]);
      continue;
    }

    // Отдельно подготавливаем строку страны для геокодера:
    // для некоторых стран используем англоязычное название, чтобы геокодер
    // лучше понимал (например, "Российская Федерация" -> "Russia").
    let countryForQuery = countryHuman;
    if (countryHuman) {
      const lower = countryHuman.toLowerCase();
      // Любые варианты написания "российская федерация", "россия" и т.п.
      if (lower.includes("росс")) {
        countryForQuery = "Russia";
      }
    }

    const query = countryForQuery ? `${loc.name}, ${countryForQuery}` : loc.name;

    try {
      const geo = await geocodeWithNominatim(query);
      if (!geo) {
        console.warn("Не удалось геокодировать:", query);
      } else {
        const climatePageUrl = CLIMATE_BASE + loc.urlPath;

        // Гарантированно берём URL климатограммы именно со страницы города
        // (img с itemprop="contentUrl"), а не строим по шаблону.
        let climateImageUrl = `https://images.climate-data.org/location/${loc.locationId}/climate-graph-200.png`;
        try {
          const cityHtml = await fetchHtml(climatePageUrl);
          const $city = cheerio.load(cityHtml);
          const img = $city("img[itemprop='contentUrl']").first();
          const srcAttr = img.attr("src");
          if (srcAttr) {
            if (srcAttr.startsWith("//")) {
              climateImageUrl = "https:" + srcAttr;
            } else if (srcAttr.startsWith("/")) {
              climateImageUrl = CLIMATE_BASE + srcAttr;
            } else if (srcAttr.startsWith("http")) {
              climateImageUrl = srcAttr;
            }
          }
        } catch (e) {
          console.warn("Не удалось точно определить URL климатограммы для", climatePageUrl, e.message);
        }

        const item = {
          name: loc.name,
          country: countryHuman,
          climatePageUrl,
          climateImageUrl,
          lat: geo.lat,
          lon: geo.lon
        };
        finalCities.push(item);
        cache[cacheKey] = item;
      }
    } catch (e) {
      console.error("Ошибка при геокодировании", query, e.message);
    }

    if (i % 20 === 0) {
      console.log(`Обработано ${i}/${rawLocations.length}`);
      saveCache(cache);
    }

    // Пауза между запросами, чтобы не душить геокодер
    await delay(1100);
  }

  saveCache(cache);

  console.log("=== Шаг 3. Сохранение cities.json ===");
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(finalCities, null, 2), "utf8");
  console.log(`Сохранено городов: ${finalCities.length}`);
  console.log(`Файл: ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

