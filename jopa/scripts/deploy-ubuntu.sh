#!/usr/bin/env bash
set -euo pipefail

echo "=================================================================="
echo "🚀 Автоматическое развертывание Jessenger на Ubuntu Server LTS"
echo "=================================================================="

if [ "$EUID" -ne 0 ]; then
  echo "❌ Пожалуйста, запустите скрипт от имени root: sudo bash scripts/deploy-ubuntu.sh"
  exit 1
fi

# 1. Определение публичного IPv4 адреса сервера
DETECTED_IP=$(hostname -I | awk '{print $1}')
read -rp "Введите публичный IPv4 вашего Ubuntu-сервера [${DETECTED_IP}]: " PUBLIC_IP_INPUT
PUBLIC_IP=${PUBLIC_IP_INPUT:-$DETECTED_IP}

read -rp "Введите ваш домен (или оставьте jessenger.local для работы по IP) [jessenger.local]: " DOMAIN_INPUT
DOMAIN=${DOMAIN_INPUT:-jessenger.local}

read -rp "Задайте стартовый пароль для супер-администратора zbchn [zbchn_root_2025]: " ZBCHN_PASS_INPUT
ZBCHN_PASS=${ZBCHN_PASS_INPUT:-zbchn_root_2025}

# 2. Установка системных пакетов и Docker (если еще не установлен)
echo "📦 Проверка и установка пакетов Ubuntu LTS..."
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw openssl lsof

if ! command -v docker &> /dev/null; then
  echo "🐳 Установка Docker Engine и Docker Compose Plugin..."
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

# 3. Тюнинг сетевого стека ядра Linux (sysctl) для WebRTC SFU 25 Mbps (UDP буферы)
echo "⚡ Оптимизация UDP-буферов ядра Linux для WebRTC SFU (Mediasoup)..."
cat <<EOF > /etc/sysctl.d/99-jessenger-webrtc.conf
net.core.rmem_max=26214400
net.core.wmem_max=26214400
net.core.rmem_default=26214400
net.core.wmem_default=26214400
net.core.netdev_max_backlog=5000
EOF
sysctl --system > /dev/null || true

# 4. Настройка межсетевого экрана UFW (HTTP/HTTPS + порт API + UDP/TCP порты Mediasoup)
echo "🛡️ Настройка правил брандмауэра UFW..."
ufw allow 22/tcp || true
ufw allow 80/tcp || true
ufw allow 443/tcp || true
ufw allow 4000/tcp || true
ufw allow 40000:40150/udp || true
ufw allow 40000:40150/tcp || true

# 5. Генерация .env файла
JWT_SECRET_GEN=$(openssl rand -hex 32)
cat <<EOF > .env
PUBLIC_IP=${PUBLIC_IP}
DOMAIN=${DOMAIN}
PORT=4000
JWT_SECRET=${JWT_SECRET_GEN}
ZBCHN_INITIAL_PASSWORD=${ZBCHN_PASS}
MEDIASOUP_MIN_PORT=40000
MEDIASOUP_MAX_PORT=40150
EOF

mkdir -p data/db data/uploads certs

# 6. Сборка и запуск контейнеров
echo "🔨 Сборка и запуск кластера Jessenger..."
docker compose up -d --build

echo "=================================================================="
echo "✅ Развертывание Jessenger успешно завершено!"
echo "🌐 Веб-интерфейс доступен по адресу: http://${PUBLIC_IP}"
echo "👑 Супер-администратор (Root): логин 'zbchn', пароль '${ZBCHN_PASS}'"
echo "📡 Диапазон UDP-портов SFU Mediasoup: 40000-40150 (IP: ${PUBLIC_IP})"
echo "=================================================================="
