const {spawn} = require('node:child_process');
const http = require('node:http');

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
let metroProcess;

function metroIsReady() {
  return new Promise(resolve => {
    const request = http.get('http://127.0.0.1:8081/status', response => {
      let body = '';
      response.on('data', chunk => (body += chunk));
      response.on('end', () => resolve(response.statusCode === 200 && body.includes('packager-status:running')));
    });
    request.setTimeout(500, () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function waitForMetro() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await metroIsReady()) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Metro did not start on http://localhost:8081 within 20 seconds.');
}

function stopMetro() {
  if (metroProcess && !metroProcess.killed) metroProcess.kill('SIGTERM');
}

async function run() {
  if (!(await metroIsReady())) {
    console.log('Starting Metro...');
    metroProcess = spawn(npx, ['react-native', 'start', '--port', '8081'], {stdio: 'inherit'});
    metroProcess.on('error', error => console.error(`Unable to start Metro: ${error.message}`));
    await waitForMetro();
  }

  console.log('Metro is ready. Building and opening LectureScribe...');
  const appProcess = spawn(npx, ['react-native', 'run-macos', '--no-packager', '--port', '8081'], {stdio: 'inherit'});
  appProcess.on('exit', code => {
    if (code && code !== 0) {
      stopMetro();
      process.exitCode = code;
    }
  });
}

process.on('SIGINT', stopMetro);
process.on('SIGTERM', stopMetro);

run().catch(error => {
  stopMetro();
  console.error(error.message);
  process.exitCode = 1;
});
