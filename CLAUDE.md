# GS-Player — CLAUDE.md

## Что это
Кроссплатформенный браузерный просмотрщик 4D Gaussian Splatting с AR-режимом.
Форк supersplat-viewer (PlayCanvas, MIT).

## Стек
- **PlayCanvas Engine** v2.17.1 (MIT) — 3D/GSplat рендер
- **8th Wall Engine** (open source MIT + SLAM binary) — AR через камеру в браузере
- **Rollup** + **TypeScript** — сборка
- **Netlify** — деплой (auto-deploy из `main`)

## AR архитектура (2026-03-29)
- **8th Wall** заменил Variant Launch (решение 2026-03-29)
- Работает в Safari (iOS) и Chrome (Android) без WebXR, без App Clip
- SLAM через камеру прямо в браузере
- 8th Wall рисует camera feed на отдельном canvas (z-index:1), PlayCanvas рендерит поверх (z-index:2)
- Custom pipeline module синхронизирует 8th Wall pose → PlayCanvas camera

## Ключевые файлы
- `src/xr.ts` — AR логика (8th Wall pipeline, reticle, placement, debug overlay)
- `src/index.ts` — точка входа, загрузка gsplat
- `src/viewer.ts` — основной viewer (camera, update loop, post-effects)
- `src/ui.ts` — UI (кнопки, настройки, tooltip, joystick)
- `public/8thwall/` — 8th Wall скрипты (xr.js, xr-slam.js, xrextras.js)
- `public/settings.json` — настройки viewer

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

### iOS (iPhone)
TODO — текущая задача

## Статус AR (2026-03-29)
- [x] 8th Wall скрипты загружаются on demand
- [x] Camera passthrough (отдельный canvas)
- [x] Pipeline module: pose sync, projection matrix
- [x] Reticle (перед камерой на y=0)
- [x] Tap → gsplat placement (scale 0.15)
- [x] Debug overlay (зеленый текст)
- [x] EXIT AR кнопка
- [ ] Тестирование на iOS/iPhone
- [ ] Variant Launch убран полностью

## Решённые проблемы
- XrNavigation.tryTeleport() перехватывал тапы → убраны XR input listeners в AR
- GlTextureRenderer ошибки → убран из pipeline (commit 63459aa)
- settings.json 404 → создан с правильной схемой
- Gsplat не рендерился в AR → camera parent сброшен в origin

## Деплой
- **URL:** https://gs.aroundstudio.io
- **Repo:** https://github.com/pavel-around/GS-Player
- **Upstream:** https://github.com/playcanvas/supersplat-viewer

## Figma
- **URL:** https://www.figma.com/design/AJ2llwCVym5HmK7QpcnDCy/around-%7C-sandbox?node-id=1901-125617
- Дизайн: 3840x2160, тёмный UI, шрифт Khand, акцент `#7B72FF`
