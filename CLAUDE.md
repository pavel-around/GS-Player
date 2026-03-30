# GS-Player — CLAUDE.md

## Что это
Кроссплатформенный браузерный просмотрщик 4D Gaussian Splatting с AR-режимом.
Форк supersplat-viewer (PlayCanvas, MIT).

## Стек
- **PlayCanvas Engine** v2.17.1 (MIT) — 3D/GSplat рендер
- **8th Wall Engine** (open source MIT + SLAM binary) — AR через камеру в браузере
- **Rollup** + **TypeScript** — сборка
- **Cloudflare Workers** — деплой (auto-deploy из `main` через wrangler)

## Деплой
- **URL:** https://gs.aroundstudio.io
- **Хостинг:** Cloudflare Workers (static assets) — перенесён с Netlify 2026-03-30
- **Netlify:** отключен (лимит bandwidth исчерпан на free plan)
- **Конфиг:** `wrangler.toml` в корне репо (`[assets] directory = "./public"`)
- **Build command:** `npx rollup -c`
- **Deploy command:** `npx wrangler deploy`
- **Workers URL:** `gs-player.soft-star-ea0c.workers.dev`
- **Custom domain:** `gs.aroundstudio.io` (CNAME в Cloudflare DNS)
- **Repo:** https://github.com/pavel-around/GS-Player
- **Upstream:** https://github.com/playcanvas/supersplat-viewer

## AR архитектура (2026-03-30)

**Подход:** 8th Wall заменил Variant Launch (решение 2026-03-29).
Работает в Safari (iOS) и Chrome (Android) без WebXR, без App Clip.

**Как устроено:**
- 8th Wall получает свой отдельный canvas (320x240, скрытый) — только для SLAM
- Camera feed отображается через нативный `<video>` элемент (z-index:1)
- PlayCanvas canvas прозрачный поверх видео (z-index:3)
- Custom pipeline module (`playcanvas-sync`) синхронизирует 8th Wall pose → PlayCanvas camera
- FOV извлекается из intrinsics[5] и ставится через `camera.fov` (projectionMatrix readonly в PlayCanvas)

**Почему так:**
- Нельзя запускать XR8.run() на PlayCanvas canvas — конфликт WebGL контекстов, SLAM не стартует
- Нельзя использовать GlTextureRenderer — создаёт второй WebGL контекст, iOS убивает → замороженный кадр
- Нельзя писать в camera.camera.projectionMatrix — readonly в PlayCanvas, TypeError на каждом кадре

## Ключевые файлы
- `src/xr.ts` — AR логика (8th Wall pipeline, reticle, placement, debug overlay)
- `src/index.ts` — точка входа, загрузка gsplat
- `src/viewer.ts` — основной viewer (camera, update loop, post-effects)
- `src/ui.ts` — UI (кнопки, настройки, tooltip, joystick)
- `public/8thwall/` — 8th Wall скрипты (xr.js, xr-slam.js, xrextras.js)
- `public/settings.json` — настройки viewer
- `wrangler.toml` — конфиг Cloudflare Workers deploy

## Сборка и запуск
```bash
npm install
npm run develop     # dev server (watch + serve)
npx rollup -c       # production build → public/
npx serve public    # serve на localhost:3000
```

## Тестирование AR
### Android (Samsung S22, Android 16)
```bash
adb reverse tcp:3000 tcp:3000
# На телефоне: Chrome → localhost:3000
```

### iOS (iPad/iPhone)
Через gs.aroundstudio.io (HTTPS обязателен для камеры в Safari).

## Статус AR (2026-03-30)
- [x] 8th Wall скрипты загружаются on demand
- [x] Отдельный SLAM canvas (не конфликтует с PlayCanvas WebGL)
- [x] Camera feed через нативный `<video>` (не GlTextureRenderer)
- [x] Pipeline module: pose sync, FOV из intrinsics
- [x] SLAM работает на iOS (onUpdate получает reality data)
- [x] Debug overlay (зеленый текст, 30 строк)
- [x] EXIT AR кнопка
- [x] Cloudflare Workers deploy
- [ ] Reticle видимый на iOS (тестируется)
- [ ] Tap → reticle красный (тест surface detection)
- [ ] Gsplat placement по тапу
- [ ] Variant Launch убран полностью из документации

## Решённые проблемы (хронология)
1. XrNavigation.tryTeleport() перехватывал тапы → убраны XR input listeners в AR
2. settings.json 404 → создан с правильной схемой
3. Gsplat не рендерился в AR → camera parent сброшен в origin
4. **xrextras.js был gzip-файл** → браузер не мог исполнить. Распакован (31KB → 131KB)
5. **Pipeline modules после XR8.run()** → onStart не вызывался. Переставлено: modules → run()
6. **iOS frozen camera** → GlTextureRenderer создавал второй WebGL контекст, iOS его убивал. Убран, камера через `<video>`
7. **XR8.run() на PlayCanvas canvas** → конфликт WebGL, SLAM не стартовал. Дан отдельный canvas 320x240
8. **camera.camera.projectionMatrix = readonly** → TypeError на каждом кадре убивал onUpdate до reticle. Заменено на извлечение FOV из intrinsics[5]

## Фазы разработки

### Фаза 1 — AR прототип (в работе)
- [x] Форк SuperSplat Viewer
- [x] Загрузка .ply, orbit камера, базовый UI
- [x] WebXR AR на Android (до перехода на 8th Wall)
- [x] 8th Wall интеграция (SLAM, camera, pose sync)
- [x] Миграция на Cloudflare Workers
- [ ] Reticle + tap placement на iOS
- [ ] Gsplat placement по тапу (позиционирование, масштаб)

### Фаза 2 — 4DGS секвенция
- [ ] Загрузка секвенции PLY/SOG файлов
- [ ] Timeline UI (play/pause/scrub)
- [ ] Demo autoload с Cloudflare R2

### Фаза 3 — Кастомный UI (Figma)
### Фаза 4 — AR UX (anchors, scale/rotate)
### Фаза 5 — Оптимизация (SOG, LOD, progressive loading)

## Demo секвенция (Cloudflare R2)
- **Bucket:** `gs-player-demo`
- **Public URL:** `https://pub-3691c4c7a3414a33946a5d5b4e739bf0.r2.dev`
- **Префикс:** `static01_anim_flipped/`
- **Файлы:** `frame_00000.ply` … `frame_00120.ply` — 121 кадр, 158 MB

## Figma
- **URL:** https://www.figma.com/design/AJ2llwCVym5HmK7QpcnDCy/around-%7C-sandbox?node-id=1901-125617
- Дизайн: 3840x2160, тёмный UI, шрифт Khand, акцент `#7B72FF`, панели `rgba(50,50,50,0.3)`

## Документация (Obsidian)
- `/home/osg/Nextcloud/Obsidian/CG_Production/Gaussian_Splatting/GS_Player/GS_Player.md`
- `/home/osg/Nextcloud/Obsidian/CG_Production/Gaussian_Splatting/GS_Player/GS_Player_Architecture.canvas`
