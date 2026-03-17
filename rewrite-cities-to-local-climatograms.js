// Переписывает climateImageUrl в cities.json на локальные пути.
// Запуск: node rewrite-cities-to-local-climatograms.js
//
// Ожидает, что файлы лежат в ./climatograms/200/<id>.png и ./climatograms/800/<id>.png

const fs = require("fs");
const path = require("path");

const CITIES_PATH = path.join(__dirname, "cities.json");

function safeIdFromUrl(url) {
  const m = String(url).match(/\/location\/(\d+)\//);
  return m ? m[1] : null;
}

function main() {
  const cities = JSON.parse(fs.readFileSync(CITIES_PATH, "utf8"));
  let changed = 0;
  let skipped = 0;

  for (const c of cities) {
    if (!c || !c.climateImageUrl) {
      skipped += 1;
      continue;
    }

    // Уже локальный путь
    if (typeof c.climateImageUrl === "string" && c.climateImageUrl.startsWith("./climatograms/200/")) {
      skipped += 1;
      continue;
    }

    const id = safeIdFromUrl(c.climateImageUrl);
    if (!id) {
      skipped += 1;
      continue;
    }

    c.climateImageUrl = `./climatograms/200/${id}.png`;
    changed += 1;
  }

  fs.writeFileSync(CITIES_PATH, JSON.stringify(cities, null, 2), "utf8");
  console.log(`Готово. Обновлено записей: ${changed}. Пропущено: ${skipped}.`);
}

main();

