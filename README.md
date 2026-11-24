# screeps4skids

A private Screeps world with a green phosphor page. The open-source server (`screeps@4.3.2`) stays on the machine. Browsers talk only to a companion WebSocket.

Visitors see the owner's colony in real time. They can log in, create an account, or read How to play. They cannot command that colony. Version 1 does not upload scripts or open a console from the page. Playing locally is done against `127.0.0.1:21025` on the machine that runs the server.

`screeps` 4.3.2 does not ship password sign-in. The image installs `screepsmod-auth` so the companion can call `POST /api/auth/signin` and `POST /api/register/submit` on the Docker network. Nginx does not proxy that HTTP port.

## Run on this computer

1. Install Docker.
2. `docker network create reverse-proxy_default` if that network is not already there.
3. Copy `.env.example` to `.env` and set `SHARED_CODE`, `STEAM_API_KEY`, `SCREEPS_OWNER_USERNAME`, and `SCREEPS_OWNER_PASSWORD`.
4. `docker compose up -d --build`
5. In `web/`, run `npm install` and `npm run dev`, then open the printed local URL.

The world database for this local run is `./.local-data` (gitignored). The first boot creates the owner, places `Spawn1` if the account has no colony, and installs a starter harvester when `main` is empty. Set `SEED_STARTER=0` to skip that script.

Copy `.local-data` to inferno when the colony is the one you want people to see. A fresh directory starts a new world.

## Deploy

See [DEPLOY.md](DEPLOY.md). The website workspace copies those files onto inferno. This repo does not change that workspace.
