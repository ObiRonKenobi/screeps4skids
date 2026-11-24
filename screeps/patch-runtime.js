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
