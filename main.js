// Простая игровая логика на фронтенде.
// В этом прототипе данные для города и координат — заглушки.
// Позже сюда можно будет подставить реальные API-запросы к backend
// (геокодер + парсер ru.climate-data.org).

const OPTION_LABELS = ["А", "Б", "В", "Г", "Д", "Е", "Ж", "З"];

const state = {
  currentCity: null,
  correctIndex: null,
  markers: [],
  scoreCorrect: 0,
  scoreWrong: 0,
  scoreSkipped: 0,
  roundLocked: false,
  cities: [],
  citiesLoaded: false,
  map: null,
  numOptions: 4,
  minDistanceKm: 3000,
  showClimateZones: true,
  climateZonesLayer: null,
};

function $(id) {
  return document.getElementById(id);
}

function setStatus(text, tone = "neutral") {
  const el = $("status-text");
  el.textContent = text;
  if (tone === "success") {
    el.style.color = "#4ade80";
  } else if (tone === "error") {
    el.style.color = "#f97373";
  } else {
    el.style.color = "#9ca3af";
  }
}

function updateScore() {
  $("score-correct").textContent = state.scoreCorrect;
  $("score-wrong").textContent = state.scoreWrong;
  const skippedEl = $("score-skipped");
  if (skippedEl) skippedEl.textContent = state.scoreSkipped;
}

function addClimateZonesLayer() {
  if (!state.map || state.climateZonesLayer) return;
  const kmlUrl = "./2027.kml";
  if (typeof ymaps.geoXml === "undefined") {
    console.error("Модуль geoXml не загружен. Добавьте load=package.full в URL API.");
    return;
  }
  ymaps.geoXml.load(kmlUrl).then(
    (res) => {
      if (!res.geoObjects || res.geoObjects.getLength() === 0) {
        console.warn("KML-файл пуст или не содержит объектов.");
        return;
      }
      // KML возвращает вложенную структуру (Folder): нужна рекурсивная обработка и явные стили линий
      function styleObject(obj) {
        if (obj.options && obj.options.set) {
          obj.options.set("strokeColor", "0099CC");
          obj.options.set("strokeWidth", 2);
        }
        if (obj.each && typeof obj.each === "function") {
          obj.each(styleObject);
        }
      }
      res.geoObjects.each(styleObject);
      state.climateZonesLayer = res.geoObjects;
      state.map.geoObjects.add(state.climateZonesLayer);
    },
    (err) => {
      console.error("Не удалось загрузить KML:", err);
    }
  );
}

function removeClimateZonesLayer() {
  if (!state.map || !state.climateZonesLayer) return;
  state.map.geoObjects.remove(state.climateZonesLayer);
  state.climateZonesLayer = null;
}

function clearMarkers() {
  if (state.map && state.markers && state.markers.length) {
    state.markers.forEach((m) => {
      if (m) {
        state.map.geoObjects.remove(m);
      }
    });
  }
  state.markers = [];
}

function handleGuess(idx) {
  if (state.roundLocked) return;

  state.roundLocked = true;

  const isCorrect = idx === state.correctIndex;
  if (isCorrect) {
    state.scoreCorrect += 1;
    setStatus("Верно! Это правильный город.", "success");
  } else {
    state.scoreWrong += 1;
    const label = OPTION_LABELS[state.correctIndex] || "";
    setStatus(
      label
        ? `Неверно. Правильная точка — ${label}.`
        : "Неверно. Это был другой пункт.",
      "error"
    );
  }
  updateScore();

  // Перекрашиваем метки: правильная — зелёная, неверный выбор — красная.
  state.markers.forEach((placemark, i) => {
    if (!placemark || !placemark.properties) return;
    const label = OPTION_LABELS[i] || "";
    placemark.properties.set("iconCaption", label);
    if (!placemark.options) return;
    if (i === state.correctIndex) {
      placemark.options.set("preset", "islands#greenDotIcon");
    } else if (i === idx) {
      placemark.options.set("preset", "islands#redDotIcon");
    } else {
      placemark.options.set("preset", "islands#blueDotIcon");
    }
  });

  showCityCaption();
}

function showClimatoLoading() {
  $("climato-loading").classList.remove("hidden");
  $("climato-image").classList.add("hidden");
  clearCityCaption();
}

function showClimatoImage(src) {
  const img = $("climato-image");
  img.src = src;
  img.onload = () => {
    $("climato-loading").classList.add("hidden");
    img.classList.remove("hidden");
  };
  img.onerror = () => {
    $("climato-loading").textContent = "Не удалось загрузить климатограмму.";
  };
}

function updateSourceLink(url) {
  const link = $("climato-source");
  if (!url) {
    link.classList.add("hidden");
    return;
  }
  link.href = url;
  link.classList.remove("hidden");
}

function getLargeClimatoSrc(src) {
  if (!src) return src;
  // Если картинка локальная, берём локальную "800".
  if (src.startsWith("./climatograms/200/")) {
    return src.replace("./climatograms/200/", "./climatograms/800/");
  }
  // На ru.climate-data.org часто есть несколько размеров, например climate-graph-200.png, 400, 800.
  // Пробуем заменить 200 (или другой размер) на 800, чтобы открыть более крупную версию.
  const match = src.match(/(climate-graph-)(\d+)(\.\w+)$/);
  if (match) {
    const [, prefix, size, ext] = match;
    return src.replace(prefix + size + ext, prefix + "800" + ext);
  }
  return src;
}

function hasCyrillic(str) {
  return /[\u0400-\u04FF]/.test(str);
}

function capitalizeFirst(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function toRussianCityName(name) {
  if (!name) return "";
  if (hasCyrillic(name)) {
    return capitalizeFirst(name);
  }

  const dict = {
    Ipswich: "Ипсуич",
    Sydney: "Сидней",
    Brisbane: "Брисбен",
    Newcastle: "Ньюкасл",
    Hobart: "Хобарт",
    Canberra: "Канберра",
    Melbourne: "Мельбурн",
  };

  return dict[name] || name;
}

function toRussianCountryName(country) {
  if (!country) return "";

  const normalized = country.trim().toLowerCase();

  const dict = {
    "россия": "Российская Федерация",
    "российская федерация": "Российская Федерация",
    "australia": "Австралия",
    "австралия": "Австралия",
  };

  if (dict[normalized]) {
    return dict[normalized];
  }

  if (hasCyrillic(country)) {
    return capitalizeFirst(country);
  }

  return country;
}

function clearCityCaption() {
  const el = $("city-caption");
  if (!el) return;
  el.textContent = "";
  el.classList.add("hidden");
}

function showCityCaption() {
  const el = $("city-caption");
  if (!el || !state.currentCity) return;

  const cityName = toRussianCityName(state.currentCity.name || "");
  const countryName = toRussianCountryName(state.currentCity.country || "");

  if (!cityName && !countryName) return;

  el.textContent = countryName ? `${cityName}, ${countryName}` : cityName;
  el.classList.remove("hidden");
}

async function loadCitiesOnce() {
  if (state.citiesLoaded) return;
  setStatus("Загружаем базу городов…");
  const data = await fetch("./cities.json").then((r) => {
    if (!r.ok) {
      throw new Error("Не удалось загрузить cities.json");
    }
    return r.json();
  });
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("Файл cities.json пуст или повреждён");
  }
  state.cities = data;
  state.citiesLoaded = true;
}

function randomGlobalPoint() {
  const latMin = -60;
  const latMax = 75;
  const lonMin = -180;
  const lonMax = 180;
  const lat = latMin + Math.random() * (latMax - latMin);
  const lon = lonMin + Math.random() * (lonMax - lonMin);
  return { lat, lon };
}

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function generateDecoyPoints(correctLat, correctLon, count) {
  const points = [];
  // Переводим минимальное расстояние из километров в "градусы" для простой евклидовой оценки.
  // 1 градус широты ≈ 111 км.
  const minDistKm = Math.min(5000, Math.max(1000, state.minDistanceKm || 3000));
  const minDist = minDistKm / 111;

  // Берём ложные точки не случайно "в океане", а из других городов из базы,
  // чтобы гарантированно быть на суше и при этом быть разбросанными по миру.
  const pool = state.cities.filter(
    (c) =>
      c.lat != null &&
      c.lon != null &&
      distance2D({ x: c.lat, y: c.lon }, { x: correctLat, y: correctLon }) >= minDist
  );

  while (points.length < count && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length);
    const candidate = pool.splice(idx, 1)[0];
    const tooCloseToOthers = points.some(
      (p) => distance2D({ x: candidate.lat, y: candidate.lon }, { x: p.lat, y: p.lon }) < minDist
    );
    if (!tooCloseToOthers) {
      points.push({ lat: candidate.lat, lon: candidate.lon });
    }
  }

  // Если по какой-то причине не удалось набрать нужное количество (малый пул),
  // добиваем случайными точками, как раньше.
  while (points.length < count) {
    points.push(randomGlobalPoint());
  }

  return points;
}

async function startNewRound() {
  await loadCitiesOnce();
  setStatus("Генерируем новое задание…");
  state.roundLocked = true;
  clearMarkers();
  showClimatoLoading();

  const idx = Math.floor(Math.random() * state.cities.length);
  const cityData = state.cities[idx];

  state.currentCity = cityData;
  clearCityCaption();

  showClimatoImage(cityData.climateImageUrl);
  updateSourceLink(cityData.climatePageUrl);

  // Актуальное количество пунктов на карте (от 2 до 8).
  const optionCount = Math.min(8, Math.max(2, state.numOptions || 4));
  state.numOptions = optionCount;

  // Формируем 1 правильную и (optionCount - 1) ложные точки по базе городов (все гарантированно на суше).
  const decoys = generateDecoyPoints(cityData.lat, cityData.lon, optionCount - 1);
  const options = [
    { ...cityData, _isCorrect: true },
    ...decoys.map((d) => ({ lat: d.lat, lon: d.lon, _isCorrect: false })),
  ];

  // Перемешиваем варианты, чтобы правильная точка могла быть в любой позиции.
  for (let i = options.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }

  state.correctIndex = options.findIndex((o) => o._isCorrect);

  if (!state.map) {
    throw new Error("Карта ещё загружается. Подождите пару секунд и нажмите «Новый раунд» снова.");
  }
  options.forEach((p, i) => {
      const label = OPTION_LABELS[i] || "";
      const placemark = new ymaps.Placemark(
        [p.lat, p.lon],
        { iconCaption: label },
        {
          preset: "islands#blueDotIcon",
        }
      );
      placemark.events.add("click", () => handleGuess(i));
      state.map.geoObjects.add(placemark);
      state.markers.push(placemark);
    });

  state.roundLocked = false;
  setStatus("Выбери точку на карте, которая соответствует климатограмме.");
}

function init() {
  if (window.ymaps && $("map")) {
    ymaps.ready(() => {
      state.map = new ymaps.Map(
        "map",
        {
          center: [20, 0],
          zoom: 2,
          controls: [],
        },
        {
          suppressMapOpenBlock: true,
        }
      );

      // Автоматически запускаем первый раунд, как только карта готова.
      startNewRound().catch((err) => {
        console.error(err);
        const msg = err && err.message ? err.message : "Неизвестная ошибка";
        setStatus("Ошибка: " + msg + " Запускайте сайт через npx serve .", "error");
      });

      const climateZonesBtn = $("climate-zones-toggle");
      if (climateZonesBtn) {
        function updateClimateZonesButton() {
          climateZonesBtn.textContent = state.showClimateZones ? "Выключить" : "Включить";
        }
        climateZonesBtn.addEventListener("click", () => {
          state.showClimateZones = !state.showClimateZones;
          if (state.showClimateZones) {
            addClimateZonesLayer();
          } else {
            removeClimateZonesLayer();
          }
          updateClimateZonesButton();
        });
        updateClimateZonesButton();
        // При первом заходе сразу включаем границы, если флаг установлен.
        if (state.showClimateZones) {
          addClimateZonesLayer();
        }
      }
    });
  }

  const climatoPanel = $("climato-panel");
  const climatoImage = $("climato-image");
  const modal = $("climato-modal");
  const modalImage = $("climato-modal-image");
  const settingsBtn = $("settings-btn");
  const settingsPanel = $("settings-panel");
  const sharePanel = $("share-panel");
  const optionsInput = $("options-count-input");
  const optionsRange = $("options-count-range");
  const distanceInput = $("min-distance-input");
  const distanceRange = $("min-distance-range");
  const shareBtn = $("share-result-btn");

  function clampOptionsCount(n) {
    const num = Number.isNaN(Number(n)) ? 4 : Number(n);
    return Math.min(8, Math.max(2, num));
  }

  function applyOptionsCount(value) {
    const clamped = clampOptionsCount(value);
    state.numOptions = clamped;
    if (optionsInput) optionsInput.value = String(clamped);
    if (optionsRange) optionsRange.value = String(clamped);
  }

  function clampMinDistanceKm(n) {
    const num = Number.isNaN(Number(n)) ? 3000 : Number(n);
    return Math.min(5000, Math.max(1000, num));
  }

  function applyMinDistanceKm(value) {
    const clamped = clampMinDistanceKm(value);
    state.minDistanceKm = clamped;
    if (distanceInput) distanceInput.value = String(clamped);
    if (distanceRange) distanceRange.value = String(clamped);
  }

  function closeSettingsPanel() {
    if (!settingsPanel) return;
    settingsPanel.classList.add("hidden");
  }

  function toggleSettingsPanel() {
    if (!settingsPanel) return;
    settingsPanel.classList.toggle("hidden");
  }

  function toggleSharePanel() {
    if (!sharePanel) return;
    sharePanel.classList.toggle("hidden");
  }

  function openClimatoModal(src) {
    if (!modal || !modalImage || !src) return;
    const largeSrc = getLargeClimatoSrc(src);
    modalImage.src = largeSrc || src;
    modal.classList.remove("hidden");
  }

  function closeClimatoModal() {
    if (!modal || !modalImage) return;
    modal.classList.add("hidden");
    modalImage.src = "";
  }

  if (modal) {
    modal.addEventListener("click", (e) => {
      const target = e.target;
      if (target && target.dataset && target.dataset.close === "true") {
        closeClimatoModal();
      } else if (target && target.id === "climato-modal-image") {
        closeClimatoModal();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeClimatoModal();
      closeSettingsPanel();
    }
  });

  if (climatoPanel && climatoImage) {
    climatoImage.addEventListener("click", () => {
      if (climatoImage.src) {
        openClimatoModal(climatoImage.src);
      }
    });
  }

  if (optionsInput) {
    optionsInput.value = String(state.numOptions);
    optionsInput.addEventListener("change", () => {
      applyOptionsCount(optionsInput.value);
    });
  }

  if (optionsRange) {
    optionsRange.value = String(state.numOptions);
    optionsRange.addEventListener("input", () => {
      applyOptionsCount(optionsRange.value);
    });
  }

  if (distanceInput) {
    distanceInput.value = String(state.minDistanceKm);
    distanceInput.addEventListener("change", () => {
      applyMinDistanceKm(distanceInput.value);
    });
  }

  if (distanceRange) {
    distanceRange.value = String(state.minDistanceKm);
    distanceRange.addEventListener("input", () => {
      applyMinDistanceKm(distanceRange.value);
    });
  }

  if (settingsBtn && settingsPanel) {
    settingsBtn.addEventListener("click", () => {
      toggleSettingsPanel();
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      toggleSharePanel();
    });
  }

  if (sharePanel) {
    sharePanel.addEventListener("click", (e) => {
      const target = e.target;
      if (!target || !target.dataset) return;
      const app = target.dataset.share;
      if (!app) return;

      const url = encodeURIComponent(window.location.href);
      const text = encodeURIComponent(
        `Тест на определение пунктов по климатограммам. Мой результат — верно: ${state.scoreCorrect}, ошибок: ${state.scoreWrong}, пропуски: ${state.scoreSkipped}`
      );

      let shareUrl = "";
      if (app === "tg") {
        shareUrl = `https://t.me/share/url?url=${url}&text=${text}`;
      } else if (app === "vk") {
        shareUrl = `https://vk.com/share.php?url=${url}&title=${text}`;
      }

      if (shareUrl) {
        window.open(shareUrl, "_blank", "noopener,noreferrer");
      }
    });
  }

  document.addEventListener("click", (e) => {
    const target = e.target;

    if (settingsPanel && !settingsPanel.classList.contains("hidden")) {
      const clickedInsidePanel = settingsPanel.contains(target);
      const clickedSettingsBtn = settingsBtn && settingsBtn.contains(target);
      if (!clickedInsidePanel && !clickedSettingsBtn) {
        closeSettingsPanel();
      }
    }

    if (sharePanel && !sharePanel.classList.contains("hidden")) {
      const clickedInsideShare = sharePanel.contains(target);
      const clickedShareBtn = shareBtn && shareBtn.contains(target);
      if (!clickedInsideShare && !clickedShareBtn) {
        sharePanel.classList.add("hidden");
      }
    }
  });

  $("new-round-btn").addEventListener("click", () => {
    if (state.currentCity && !state.roundLocked) {
      state.scoreSkipped += 1;
      updateScore();
    }
    startNewRound().catch((err) => {
      console.error(err);
      const msg = err && err.message ? err.message : "Неизвестная ошибка";
      setStatus("Ошибка: " + msg + " Запускайте сайт через npx serve .", "error");
    });
  });
  updateScore();
}

document.addEventListener("DOMContentLoaded", init);

