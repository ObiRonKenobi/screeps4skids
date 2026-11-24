FROM node:22.22.0-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/screeps

COPY package.json ./
RUN npm install --unsafe-perm

COPY patch-storage.js patch-runtime.js ./
RUN node patch-storage.js && node patch-runtime.js

COPY mods.json entrypoint.js seed-world.js ./

ENV NODE_ENV=production
EXPOSE 21025

CMD ["node", "entrypoint.js"]
