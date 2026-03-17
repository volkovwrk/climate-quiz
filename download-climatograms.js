// Скачивает все климатограммы из cities.json в локальную папку.
// Запуск: node download-climatograms.js
//
// ВАЖНО: может скачать несколько тысяч PNG (сотни МБ).

const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const CITIES_PATH = path.join(__dirname, "cities.json");
const OUT_DIR_200 = path.join(__dirname, "climatograms", "200");
const OUT_DIR_800 = path.join(__dirname, "climatograms", "800");
const CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 30000;
const RETRIES = 3;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
}

function safeIdFromUrl(url) {
  // https://images.climate-data.org/location/<id>/climate-graph-200.png
  const m = String(url).match(/\/location\/(\d+)\//);
  return m ? m[1] : null;
}

function toSizeUrl(url, size) {
  // climate-graph-200.png -> climate-graph-800.png
  const s = String(url);
  if (s.includes("climate-graph-")) {
    return s.replace(/climate-graph-\d+\.png$/, `climate-graph-${size}.png`);
  }
  return s;
}

async function fetchWithTimeout(url, opts) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadOne(url, filePath) {
  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: {
          "User-Agent": "climate-quiz/1.0 (bulk download for personal use)",
          Referer: "https://ru.climate-data.org/",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const buf = await res.buffer();
      fs.writeFileSync(filePath, buf);
      return;
    } catch (e) {
      const last = attempt === RETRIES;
      if (last) throw e;
      await sleep(800 * attempt);
    }
  }
}

async function runPool(items, worker, concurrency) {
  let idx = 0;
  let done = 0;
  let failed = 0;
  const total = items.length;

  async function runner() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const myIdx = idx;
      idx += 1;
      if (myIdx >= total) return;
      const item = items[myIdx];
      try {
        // eslint-disable-next-line no-await-in-loop
        await worker(item, myIdx);
      } catch (e) {
        failed += 1;
        console.error(`[FAIL] ${item.url} -> ${item.fileName}: ${e.message}`);
      } finally {
        done += 1;
        if (done % 25 === 0 || done === total) {
          console.log(`Прогресс: ${done}/${total}. Ошибок: ${failed}.`);
        }
      }
    }
  }

  const runners = Array.from({ length: concurrency }, () => runner());
  await Promise.all(runners);
  return { done, failed, total };
}

async function main() {
  ensureDir(OUT_DIR_200);
  ensureDir(OUT_DIR_800);

  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, "utf8"));
  const unique = new Map(); // id -> url

  for (const c of cities) {
    const url = c && c.climateImageUrl;
    if (!url) continue;
    const id = safeIdFromUrl(url);
    if (!id) continue;
    if (!unique.has(id)) unique.set(id, url);
  }

  const tasks = Array.from(unique.entries()).flatMap(([id, url]) => {
    const url200 = toSizeUrl(url, 200);
    const url800 = toSizeUrl(url, 800);
    return [
      {
        id,
        size: 200,
        url: url200,
        fileName: `${id}.png`,
        filePath: path.join(OUT_DIR_200, `${id}.png`),
      },
      {
        id,
        size: 800,
        url: url800,
        fileName: `${id}.png`,
        filePath: path.join(OUT_DIR_800, `${id}.png`),
      },
    ];
  });

  // Пропускаем уже скачанные
  const pending = tasks.filter((t) => !fs.existsSync(t.filePath));

  const uniqueCount = unique.size;
  console.log(`Уникальных климатограмм (ID): ${uniqueCount}`);
  console.log(`Файлов всего (200+800): ${tasks.length}`);
  console.log(`Уже есть на диске: ${tasks.length - pending.length}`);
  console.log(`Нужно скачать: ${pending.length}`);

  const startedAt = Date.now();
  const result = await runPool(
    pending,
    async (t) => {
      await downloadOne(t.url, t.filePath);
    },
    CONCURRENCY
  );

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
  console.log(`\nГотово. Скачано/проверено: ${result.total}. Ошибок: ${result.failed}. Время: ~${elapsedSec}s`);

  if (result.failed > 0) {
    console.log("Можно запустить скрипт ещё раз — он докачает пропущенные файлы.");
  }
}

main().catch((e) => {
  console.error("Фатальная ошибка:", e);
  process.exit(1);
});

