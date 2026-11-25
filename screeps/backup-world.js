const fs = require('fs');
const path = require('path');

const data = '/data';
const dbPath = path.join(data, 'db.json');
const markerPath = path.join(data, 'world-seeded');
const backupRoot = path.join(data, 'backups');
const keep = 48;
const firstDelay = 60 * 1000;
const interval = 30 * 60 * 1000;

function stamp(date) {
  const part = (value) => String(value).padStart(2, '0');
  return (
    String(date.getUTCFullYear()) +
    part(date.getUTCMonth() + 1) +
    part(date.getUTCDate()) +
    '-' +
    part(date.getUTCHours()) +
    part(date.getUTCMinutes())
  );
}

function snapshot() {
  try {
    if (!fs.existsSync(dbPath)) return;
    const text = fs.readFileSync(dbPath, 'utf8');
    JSON.parse(text);
    const folder = path.join(backupRoot, stamp(new Date()));
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'db.json'), text);
    if (fs.existsSync(markerPath)) {
      fs.copyFileSync(markerPath, path.join(folder, 'world-seeded'));
    } else {
      console.error('world copy has no world-seeded marker');
    }
    const names = fs.readdirSync(backupRoot).filter((name) => /^\d{8}-\d{4}$/.test(name)).sort();
    while (names.length > keep) {
      fs.rmSync(path.join(backupRoot, names.shift()), { recursive: true, force: true });
    }
    console.log('saved world copy ' + path.basename(folder));
  } catch (error) {
    console.error('skipped torn world copy:', error.message);
  }
}

setTimeout(() => {
  snapshot();
  setInterval(snapshot, interval);
}, firstDelay);
