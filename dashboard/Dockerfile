FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
ENV PUPPETEER_SKIP_DOWNLOAD=true
RUN npm ci
COPY . .
RUN npm run build

FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir fastapi==0.138.2 uvicorn==0.49.0
COPY server.py ./server.py
COPY --from=build /app/dist ./dist
EXPOSE 8021
CMD ["python", "server.py"]
