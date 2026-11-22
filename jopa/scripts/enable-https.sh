#!/usr/bin/env bash
set -euo pipefail

DOMAIN=${1:-mered.ro}
EMAIL=${2:-admin@mered.ro}

echo "🔒 получение официального https сертификата let's encrypt для ${DOMAIN}..."

apt-get update -y
apt-get install -y certbot

docker compose stop nginx || true

certbot certonly --standalone -d "${DOMAIN}" --non-interactive --agree-tos -m "${EMAIL}"

mkdir -p certs
cp "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" certs/fullchain.pem
cp "/etc/letsencrypt/live/${DOMAIN}/privkey.pem" certs/privkey.pem
chmod 644 certs/fullchain.pem certs/privkey.pem

docker compose up -d nginx

echo "✅ https для https://${DOMAIN} успешно активирован!"
