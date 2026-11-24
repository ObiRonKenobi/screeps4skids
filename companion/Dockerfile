FROM node:22.22.0-bookworm-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
EXPOSE 21080
CMD ["node", "src/index.js"]
