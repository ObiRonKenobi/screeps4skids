const fs = require('fs');

function patch(file, from, to) {
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(to)) {
    console.log('already patched ' + file);
    return;
  }
  if (!source.includes(from)) {
    throw new Error('pattern missing in ' + file);
  }
  fs.writeFileSync(file, source.replace(from, to));
  console.log('patched ' + file);
}

patch(
  'node_modules/@screeps/backend/lib/strongholds.js',
  'const compressedTerrainData = await env.get(env.keys.TERRAIN_DATA);',
  'const compressedTerrainData = await env.get(env.keys.TERRAIN_DATA);\n    if (!compressedTerrainData) return {};'
);

patch(
  'node_modules/@screeps/backend/lib/strongholds.js',
  'const accessibleRooms = JSON.parse(await env.get(env.keys.ACCESSIBLE_ROOMS));',
  'const accessibleRaw = await env.get(env.keys.ACCESSIBLE_ROOMS);\n    if (!accessibleRaw) return {};\n    const accessibleRooms = JSON.parse(accessibleRaw);'
);

patch(
  'node_modules/@screeps/driver/lib/index.js',
  'const result = await env.smembers(env.keys.ACTIVE_ROOMS);\n    await env.del(env.keys.ACTIVE_ROOMS);\n    return result;',
  'const result = await env.smembers(env.keys.ACTIVE_ROOMS);\n    await env.del(env.keys.ACTIVE_ROOMS);\n    return result || [];'
);

patch(
  'node_modules/@screeps/backend/lib/utils.js',
  'exports.getActiveRooms = function getActiveRooms() {\n    return env.smembers(env.keys.ACTIVE_ROOMS);\n};',
  'exports.getActiveRooms = function getActiveRooms() {\n    return env.smembers(env.keys.ACTIVE_ROOMS).then(rooms => rooms || []);\n};'
);

patch(
  'node_modules/@screeps/common/index.js',
  'return exports.storage.env.get(exports.storage.env.keys.GAMETIME).then(data => parseInt(data));',
  'return exports.storage.env.get(exports.storage.env.keys.GAMETIME).then(data => {\n        const time = parseInt(data, 10);\n        return Number.isFinite(time) ? time : 0;\n    });'
);

patch(
  'node_modules/@screeps/driver/lib/runtime/runtime.js',
  'mapGrid = new WorldMapGrid(systemFunctions.JSON.parse(data.accessibleRooms), staticTerrainData);',
  "mapGrid = new WorldMapGrid(systemFunctions.JSON.parse(data.accessibleRooms || '[]'), staticTerrainData);"
);

patch(
  'node_modules/@screeps/backend/lib/cronjobs.js',
  "            console.log(`Running cronjob '${key}'`);\n            i[2] = Date.now();\n            i[1]({utils});",
  "            console.log(`Running cronjob '${key}'`);\n            i[2] = Date.now();\n            Promise.resolve().then(() => i[1]({utils})).catch(error => {\n                console.error(`cronjob ${key} failed`, error && error.stack || error);\n            });"
);

patch(
  'node_modules/@screeps/backend/lib/cronjobs.js',
  '        if(!_.some(rooms)) {\n            return q.reject(`No normal bus rooms found for the sector of ${center._id}} (${sectorRegex})`);\n        }',
  '        if(!_.some(rooms)) {\n            continue; // this sector has no highway rooms\n        }'
);
