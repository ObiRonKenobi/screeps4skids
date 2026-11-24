const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = '/opt/screeps';
const data = '/data';
const steamKey = process.env.STEAM_API_KEY || '';

if (!steamKey) {
  console.error('STEAM_API_KEY is required. The stock server refuses to listen without a Steam Web API key.');
  process.exit(1);
}

const assetdir = path.join(root, 'node_modules/@screeps/launcher/init_dist/assets');
if (!fs.existsSync(assetdir)) {
  console.error('Screeps assets were not installed at ' + assetdir);
  process.exit(1);
}

fs.mkdirSync(path.join(data, 'logs'), { recursive: true });

const screepsrc = `
steam_api_key = ${steamKey}
port = 21025
host = 0.0.0.0
password =
cli_port = 21026
cli_host = 0.0.0.0
runners_cnt = 1
runner_threads = 1
processors_cnt = 1
logdir = /data/logs
modfile = /opt/screeps/mods.json
assetdir = ${assetdir}
db = /data/db.json
log_console = true
log_rotate_keep = 5
storage_disabled = false
restart_interval = 3600

[auth]
registerCpu = 100
preventSpawning = false
`;

fs.writeFileSync(path.join(root, '.screepsrc'), screepsrc);
fs.writeFileSync(path.join(root, 'steam_appid.txt'), '464350');

const child = spawn('npx', ['screeps', 'start'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});

spawn('node', ['seed-world.js'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});

child.on('exit', (code) => process.exit(code == null ? 1 : code));
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));
