# Jessenger — Приватный Мессенджер и Ultra-HD SFU Стриминг-Сервер

**Jessenger** — полнофункциональный self-hosted мессенджер с архитектурой **Mediasoup SFU**, поддержкой демонстрации экрана в ультра-качестве (**1080p / 1440p / 4K при 60 FPS**, битрейт до **25 Мбит/с**, кодеки **AV1 / VP9 / H.264 High Profile**, стерео-звук **Opus 510 kbps CBR**), движком кастомных тем (**Theme Engine**) и эксклюзивной Root-панелью администратора **`zbchn`** с системой кастомных бейджиков.

---

## Состав архива и архитектура проекта

```text
jessenger/
├── .env.example                          # Шаблон переменных окружения
├── docker-compose.yml                    # Оркестрация Backend + Mediasoup SFU, Frontend и Nginx (host network)
├── nginx/
│   └── nginx.conf                        # Конфигурация реверс-прокси с поддержкой WebSockets и раздачей статики
├── scripts/
│   └── deploy-ubuntu.sh                  # Автоматический скрипт деплоя и тюнинга ядра на Ubuntu Server LTS
├── backend/
│   ├── Dockerfile                        # Сборка Node.js 20 + компиляция C++ воркера Mediasoup и SQLite
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                      # Точка входа сервера
│       ├── config.ts                     # Настройки портов, JWT и битрейтов SFU
│       ├── db.ts                         # Схема SQLite (WAL) и авто-сидинг аккаунта zbchn + бейджа основателя
│       ├── types.ts                      # Типизация DTO и сокетов
│       ├── middleware/
│       │   ├── auth.ts                   # Проверка JWT и защита роутов requireSuperAdminZbchn
│       │   └── upload.ts                 # Загрузка аватарок, файлов до 250 МБ, голосовых и иконок бейджей
│       ├── routes/
│       │   ├── auth.routes.ts            # Регистрация, вход, профиль, сохранение темы
│       │   ├── chat.routes.ts            # Личные и групповые чаты, инвайты, файлы, голосовые с амплитудой волны
│       │   └── admin.routes.ts           # Эксклюзивное API для zbchn: юзеры, баны, сброс пароля, CRUD бейджей
│       ├── socket/
│       │   └── socket.handler.ts         # Реалтайм-события чата, реакций, закрепов, статусов и звонков
│       └── sfu/
│           └── mediasoup.manager.ts      # Серверное ядро SFU: роутеры, транспорты, Simulcast/SVC, RTCP Feedback
└── frontend/
    ├── Dockerfile                        # Сборка React + Vite + Tailwind CSS
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx                       # Главное приложение, авторизация, сайдбар, поиск и модалки
        ├── index.css                     # Палитра Obsidian Purple и CSS-переменные движка тем
        ├── types.ts
        ├── services/
        │   ├── api.ts                    # HTTP-клиент с JWT-авторизацией
        │   ├── socket.ts                 # Менеджер подключения Socket.io
        │   └── webrtc.engine.ts          # Низкоуровневый WebRTC/SFU контроллер, SDP Munging, RTCRtpSender, getStats
        └── components/
            ├── BadgeList.tsx             # Рендер бейджиков с неоновым свечением и тултипами
            ├── ChatView.tsx              # Интерфейс чата, ответов, реакций, голосовых сообщений и лайтбокса
            ├── CallOverlay.tsx           # Групповой звонок, настройки демки экрана и WebRTC Internals Overlay
            ├── ThemeCustomizerModal.tsx  # Редактор тем (Color Picker, 5 пресетов, JSON импорт/экспорт)
            ├── ProfileSettingsModal.tsx  # Редактирование профиля, аватарки и статуса
            └── AdminPanelModal.tsx       # Эксклюзивная панель zbchn и конструктор бейджей
```

---

## Быстрое развертывание на Ubuntu Server LTS (22.04 / 24.04)

### Вариант 1: Автоматическая установка одной командой
1. Распакуйте архив на сервере и перейдите в папку проекта:
   ```bash
   unzip jessenger-full-production.zip -d jessenger-project
   cd jessenger-project/jessenger
   ```
2. Запустите установочный скрипт от имени `root`:
   ```bash
   sudo bash scripts/deploy-ubuntu.sh
   ```
   Скрипт автоматически:
   - определит ваш внешний IPv4-адрес для кандидатов ICE Mediasoup;
   - установит Docker и Docker Compose (если они еще не установлены);
   - увеличит размеры UDP-буферов ядра Linux (`net.core.rmem_max=26214400`) для предотвращения микропотерь при стриминге 1440p/4K 60fps;
   - откроет порты `80/tcp`, `443/tcp`, `4000/tcp` и диапазон WebRTC `40000:40150/udp` в `ufw`;
   - создаст `.env` и запустит все сервисы через `docker compose up -d --build`.

### Вариант 2: Ручной запуск через Docker Compose
1. Скопируйте `.env.example` в `.env`:
   ```bash
   cp .env.example .env
   ```
2. Обязательно укажите реальный публичный IPv4 вашего сервера в параметре `PUBLIC_IP` внутри `.env`:
   ```ini
   PUBLIC_IP=ВАШ_ПУБЛИЧНЫЙ_IP_СЕРВЕРА
   PORT=4000
   JWT_SECRET=любая_длинная_случайная_строка
   ZBCHN_INITIAL_PASSWORD=ваш_пароль_супер_админа
   MEDIASOUP_MIN_PORT=40000
   MEDIASOUP_MAX_PORT=40150
   ```
3. Запустите сборку и старт контейнеров:
   ```bash
   sudo docker compose up -d --build
   ```

---

## Важное примечание по HTTPS / SSL для работы WebRTC в браузерах

Современные браузеры (Chrome, Edge, Firefox, Safari) разрешают вызов `navigator.mediaDevices.getDisplayMedia()` (захват экрана) и `getUserMedia()` (микрофон/камера) только в **Secure Context** (`https://` или `http://localhost`).
- Для продакшена с доменом рекомендуется выпустить бесплатный сертификат Let's Encrypt (`certbot`) или использовать Caddy / Cloudflare Tunnel перед портом `80`/`4000`.
- Для быстрого теста по локальному IP без домена в Chrome/Edge можно добавить `http://ВАШ_IP` в флаг `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.

---

## Привилегии Супер-Админа `zbchn` и Система Бейджиков

- При первом запуске базы данных автоматически создается корневой аккаунт **`zbchn`** с паролем из переменной `ZBCHN_INITIAL_PASSWORD` (по умолчанию `supersecret_zbchn_root`) и эксклюзивным золотым/фиолетовым бейджем **«Создатель Jessenger (Root)»**.
- В левом верхнем углу сайдбара у пользователя `zbchn` отображается иконка щита (**«Админ-панель zbchn и Конструктор Бейджей»**).
- Через админ-панель `zbchn` может:
  1. Создавать любые кастомные бейджики, загружать PNG/SVG/GIF/WebP иконки и выбирать цвет неоновой рамки.
  2. В один клик выдавать и отзывать любые бейджи у любых пользователей (поддерживается неограниченное количество бейджей на одного пользователя).
  3. Блокировать/разблокировать пользователей, принудительно менять пароли, удалять аккаунты и отправлять глобальные системные уведомления.
