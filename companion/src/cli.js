const net = require('net');

function runCli(host, commands) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(21026, host);
    let buf = '';
    let step = 0;
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('cli timeout'));
    }, 180000);
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (!buf.includes('< ')) return;
      if (step >= commands.length) {
        clearTimeout(timer);
        socket.end();
        resolve();
        return;
      }
      const command = commands[step];
      step += 1;
      buf = '';
      socket.write(command + '\r\n');
    });
  });
}

function generateRoom(host, room) {
  if (!/^W\d+N\d+$/.test(room)) throw new Error('bad room');
  return runCli(host, [
    "map.generateRoom('" + room + "', {sources: 2, controller: true})",
    'map.updateTerrainData()'
  ]);
}

function clearRespawnCooldown(host, userId) {
  if (!/^[a-f0-9]{8,}$/i.test(userId)) throw new Error('bad user');
  const command = "storage.db['users'].update({_id:'" + userId + "'},{$set:{lastRespawnDate:0}})";
  return new Promise((resolve, reject) => {
    const socket = net.connect(21026, host);
    let buf = '';
    let sent = false;
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => finish(), 2500);
    socket.on('error', (error) => finish(error));
    socket.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      if (sent || !buf.includes('< ')) return;
      sent = true;
      socket.write(command + '\r\n');
    });
  });
}

module.exports = { generateRoom, clearRespawnCooldown };
