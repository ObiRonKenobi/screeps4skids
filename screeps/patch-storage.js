const fs = require('fs');

const file = 'node_modules/@screeps/storage/lib/db.js';
let source = fs.readFileSync(file, 'utf8');

const upgradeFrom = "    let env = db.getCollection('env');\n    let envData = env.get(1);\n    if(!envData) {\n        return;\n    }";
const upgradeTo = "    let env = db.getCollection('env');\n    if (!env) {\n        env = db.addCollection('env');\n        env.insert({ data: {} });\n    }\n    let envData = env.get(1);\n    if(!envData) {\n        clearInterval(upgradeInterval);\n        return;\n    }\n    if (!db.getCollection('rooms.objects') || !db.getCollection('market.orders')) {\n        envData.databaseVersion = 9;\n        env.update(envData);\n        clearInterval(upgradeInterval);\n        return q.ninvoke(db, 'saveDatabase');\n    }";

const cleanFrom = "setInterval(function envCleanExpired() {\n    var env = db.getCollection('env');\n    var values = env.get(1);";
const cleanTo = "setInterval(function envCleanExpired() {\n    if (!db) return;\n    var env = db.getCollection('env');\n    if (!env) return;\n    var values = env.get(1);\n    if (!values || !values.data) return;";

if (!source.includes(upgradeFrom) || !source.includes(cleanFrom)) {
  throw new Error('screeps storage db.js did not match the fresh-database patch');
}

source = source.replace(upgradeFrom, upgradeTo).replace(cleanFrom, cleanTo);
fs.writeFileSync(file, source);
console.log('patched fresh-database crash in @screeps/storage');
