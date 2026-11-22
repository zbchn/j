# Jessenger Desktop (ПК-приложение)

Полноценное десктопное приложение на базе Electron с локальным бандлом интерфейса, офлайн-кэшем переписок и локальным хранилищем скачанных файлов.

## Как собрать и запустить

1. Сначала соберите фронтенд в `desktop/renderer`:
   ```bash
   cd desktop
   npm install
   npm run build:renderer
   ```
2. Запуск в режиме разработки:
   ```bash
   npm start
   ```
3. Сборка установщика для Windows (`.exe`):
   ```bash
   npm run dist:win
   ```
   Готовый установщик появится в `desktop/dist-installers/`.
