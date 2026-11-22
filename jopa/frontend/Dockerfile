FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .
RUN npx tsc && npx vite build --outDir /app/build_output

CMD ["sh", "-c", "mkdir -p /app/dist && rm -rf /app/dist/* && cp -r /app/build_output/* /app/dist/ && echo '✅ frontend build synced to volume' && tail -f /dev/null"]
