# GS-Player — CLAUDE.md

## Что это
Кроссплатформенный браузерный просмотрщик 4D Gaussian Splatting с AR-режимом.
Форк supersplat-viewer (PlayCanvas, MIT).

## Стек
- **PlayCanvas Engine** v2.17.1 (MIT) — 3D/GSplat рендер
- **8th Wall Engine** (self-hosted binary + SLAM) — AR через камеру в браузере
- **Rollup** + **TypeScript** — сборка
- **Cloudflare Workers** — деплой (auto-deploy из `main` через wrangler)

## Деплой
- **URL:** https://gs.aroundstudio.io
- **Хостинг:** Cloudflare Workers (static assets)
- **Конфиг:** `wrangler.toml` в корне репо (`[assets] directory = "./public"`)
- **Build:** `npx rollup -c` (выход → `public/`, НЕ в `dist/`)
- **Deploy:** `npx wrangler deploy` (требует Node 20+, через nvm)
- **Workers URL:** `gs-player.soft-star-ea0c.workers.dev`
- **Custom domain:** `gs.aroundstudio.io` (CNAME в Cloudflare DNS)
- **Repo:** https://github.com/pavel-around/GS-Player
- **Upstream:** https://github.com/playcanvas/supersplat-viewer

### ВАЖНО: сборка
- Rollup выдаёт web app в `public/` и module в `dist/` — это РАЗНЫЕ бандлы
- `dist/index.js` — library module (вход: `src/module/index.ts`), НЕ для деплоя
- `public/index.js` — web app (вход: `src/index.ts`), деплоится на Cloudflare
- **НИКОГДА не копировать `dist/*.js` в `public/`** — это сломает сайт

## AR архитектура (2026-03-30)

**Подход:** `XR8.PlayCanvas.runXr()` — официальная интеграция 8th Wall + PlayCanvas.
Работает в Safari (iOS) и Chrome (Android) без WebXR, без App Clip.

**Как устроено:**
- `XR8.PlayCanvas.runXr()` управляет всем: два canvas, GlTextureRenderer, XrController (SLAM), camera sync (position/rotation/FOV)
- Two-canvas mode: `#camerafeed` (camera feed, GlTextureRenderer, SLAM readPixels) за `#application-canvas` (PlayCanvas, z-index:15, transparent)
- `ownRunLoop: false` — PlayCanvas drives loop, internal module hooks `pcApp.on('update')` → `XR8.runPreRender()`
- Наш custom module (`reticle-placement`) только: reticle raycast (cam → y=0) + gsplat hide/show
- `window.pc = pc` — **обязательно**, 8th Wall binary ссылается на `pc.Color`, `pc.Entity`, `pc.Mesh` и т.д. как на глобал
- Tap → фиксирует reticle в пространстве (зелёный), повторный tap → разблокирует

**Критичные находки (не забывать):**
1. Self-hosted 8th Wall binary имеет `runXr()` но НЕ `run()` (добавлен в R22.4, нашей версии нет)
2. `window.pc` должен быть выставлен ДО вызова `runXr()` — иначе `pc.Color(0,0,0,0)` для прозрачности canvas падает → чёрный экран без camera feed
3. XrController добавляется автоматически в `runXr()`, не нужно передавать в extraModules
4. `stopXr()` может не быть экспортирован — используем `XR8.stop()` для остановки

**Что НЕ работает (проверено):**
- `XR8.PlayCanvas.run()` — не существует в self-hosted binary (только `runXr`)
- `XR8.run()` напрямую на PlayCanvas canvas — конфликт WebGL, SLAM не стартует
- `GlTextureRenderer` на том же canvas что PlayCanvas — второй WebGL контекст, iOS убивает
- `camera.camera.projectionMatrix = ...` — readonly в PlayCanvas, TypeError

## Ключевые файлы
- `src/xr.ts` — AR логика (8th Wall PlayCanvas integration, reticle, tap-to-fix, debug overlay)
- `src/index.ts` — точка входа, загрузка gsplat
- `src/viewer.ts` — основной viewer (camera, update loop, `autoRender=false`)
- `src/ui.ts` — UI (кнопки, настройки, tooltip, joystick)
- `src/index.html` — HTML, canvas `id="application-canvas"` (важно для 8th Wall CSS)
- `public/8thwall/` — 8th Wall скрипты (xr.js, xr-slam.js, xrextras.js)
- `public/settings.json` — настройки viewer
- `wrangler.toml` — конфиг Cloudflare Workers deploy
- `/tmp/8thwall-repo/reality/app/xr/js/src/xr-playcanvas.js` — исходник 8th Wall PlayCanvas module (для справки)

## Сборка и запуск
```bash
npm install
npm run develop     # dev server (watch + serve)
npx rollup -c       # production build → public/ (и dist/, но dist не деплоить)
npx serve public    # serve на localhost:3000
```

## Деплой
```bash
# Требуется Node 20+ (через nvm)
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" && nvm use 20
npx rollup -c
npx wrangler deploy
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
- [x] `XR8.PlayCanvas.runXr()` — official two-canvas integration
- [x] Camera passthrough (GlTextureRenderer на #camerafeed canvas)
- [x] SLAM camera sync (position, rotation, FOV из intrinsics)
- [x] `window.pc` exposed для 8th Wall internal module
- [x] Reticle видимый (ray → y=0 ground plane)
- [x] Tap → фиксирует reticle в пространстве (зелёный)
- [x] Повторный tap → разблокирует reticle (белый)
- [x] Debug overlay (зеленый текст, 30 строк)
- [x] EXIT AR кнопка
- [x] Cloudflare Workers deploy
- [ ] Gsplat placement по тапу (показать gsplat в зафиксированной позиции)
- [ ] Масштаб/поворот gsplat в AR

## Решённые проблемы (хронология)
1. XrNavigation.tryTeleport() перехватывал тапы → убраны XR input listeners в AR
2. settings.json 404 → создан с правильной схемой
3. Gsplat не рендерился в AR → camera parent сброшен в origin
4. **xrextras.js был gzip-файл** → распакован (31KB → 131KB)
5. **Pipeline modules после XR8.run()** → onStart не вызывался. Переставлено: modules → run()
6. **iOS frozen camera** → GlTextureRenderer создавал второй WebGL на PlayCanvas canvas. Дан отдельный canvas
7. **XR8.run() на PlayCanvas canvas** → конфликт WebGL, SLAM не стартовал. Решено через two-canvas
8. **camera.camera.projectionMatrix = readonly** → TypeError. Решено: FOV из intrinsics[5]
9. **XR8.PlayCanvas.run() не существует** в self-hosted binary → заменено на `runXr()`
10. **`pc` не определён как глобал** → 8th Wall module не мог создать `pc.Color(0,0,0,0)` для прозрачности canvas → чёрный фон. Решено: `window.pc = pc`
11. **`dist/index.js` скопирован в `public/`** → белый экран (module build вместо web app). Rollup пишет напрямую в `public/`, копировать не нужно

## Фазы разработки

### Фаза 1 — AR прототип (почти готово)
- [x] Форк SuperSplat Viewer
- [x] Загрузка .ply, orbit камера, базовый UI
- [x] WebXR AR на Android (до перехода на 8th Wall)
- [x] 8th Wall интеграция (SLAM, camera, pose sync)
- [x] Миграция на Cloudflare Workers
- [x] Camera passthrough + reticle + tap-to-fix
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
