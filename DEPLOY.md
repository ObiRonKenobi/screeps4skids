# Deploy screeps.rbyt3r.com on inferno

Do this from the website workspace after the colony on the build machine is the one that should be public. Copy that machine's data directory. Do not start from an empty folder if you want the same world.

The hostname is `screeps.rbyt3r.com`. TLS ends at Cloudflare. The tunnel is the local `main-tunnel`. Do not migrate it and do not add a certificate on inferno.

1. Copy this repo's compose file, `screeps/`, `companion/`, and `deploy/screeps.conf` to inferno. Put the site file at `/mnt/projects/reverse-proxy/conf/screeps.conf`.

   Add this volume to `rp-nginx`, the same way invaders is mounted:

   ```yaml
   - /mnt/projects/screeps/web:/usr/share/nginx/screeps:ro
   ```

   Build the frontend (`npm run build` in `web/`) and copy `web/dist/` to `/mnt/projects/screeps/web`.

2. Create the database directory on the internal disk. The USB drive at `/mnt/projects` drops offline, so the world must not live there.

   ```bash
   sudo mkdir -p /var/lib/screeps
   ```

   In the stack's `.env`, set `SCREEPS_DATA_DIR=/var/lib/screeps`. If you are publishing an existing colony, stop the local server first, then copy the newest folder under `.local-data/backups/` into that directory. Copy both `db.json` and `world-seeded`. The backup loop writes a checked pair every 30 minutes and keeps one day of them. The marker has to travel with the database: without it, the first boot generates a room on top of this colony.

   Restoring the local colony is the same copy in reverse. Stop the stack, replace `.local-data/db.json` with the snapshot's `db.json`, leave `world-seeded` in place, and start again.

3. Put secrets in that `.env` only. Do not commit them.

   - `SHARED_CODE` — the signup word you give out in person
   - `STEAM_API_KEY` — required by the stock server to listen. It is not a player login.
   - `SCREEPS_OWNER_USERNAME` and `SCREEPS_OWNER_PASSWORD`

4. Start the stack:

   ```bash
   docker compose up -d --build
   ```

5. Reload nginx:

   ```bash
   cd /mnt/projects/reverse-proxy && docker compose restart nginx
   ```

6. On inferno, edit `/etc/cloudflared/config.yml`. Above the `http_status:404` catch-all, add:

   ```yaml
   - hostname: screeps.rbyt3r.com
     service: http://127.0.0.1:80
   ```

   Then:

   ```bash
   sudo systemctl restart cloudflared
   ```

7. DNS is a proxied CNAME. Name `screeps`. Target `38c72b23-3620-4298-b3af-6eb0e226bef5.cfargotunnel.com`. Confirm the `tunnel:` id in `/etc/cloudflared/config.yml` before saving. This is not a remotely managed tunnel route.

Do not open port 21025 on the router. The compose file publishes `21025` and the companion's `21080` on `127.0.0.1` only. Do not change those bindings to `0.0.0.0`.

## After a reboot

Docker restarts the containers (`restart: always`) and the colony continues from the last tick in `/var/lib/screeps`. Missed time is not simulated. `cloudflared` comes back with the system service.

The page files live on the USB drive. If `/mnt/projects` is not mounted when Docker starts, nginx serves an empty folder until the drive is mounted and nginx is restarted. That is the same recovery as the other Mint sites: mount the drive, then `docker compose restart nginx` in `/mnt/projects/reverse-proxy`. Add this stack to `ensure-mint-stacks.sh` when you wire the boot script.
