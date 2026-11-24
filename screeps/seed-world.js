const fs = require('fs');
const net = require('net');

const marker = '/data/world-seeded';
const room = process.env.ROOM || 'W5N5';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function seedOnce() {
  return new Promise((resolve, reject) => {
    const socket = net.connect(21026, '127.0.0.1');
    let buf = '';
    let step = 0;
    const commands = [
      "map.generateRoom('" + room + "', {sources: 2, controller: true})",
      'map.updateTerrainData()'
    ];
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
        fs.writeFileSync(marker, room + '\n');
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

async function main() {
  if (fs.existsSync(marker)) return;
  for (;;) {
    try {
      await seedOnce();
      console.log('seeded room ' + room);
      return;
    } catch (error) {
      console.error('waiting to seed ' + room + ':', error.message);
      await sleep(3000);
    }
  }
}

main();
