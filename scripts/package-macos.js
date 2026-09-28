const {createHash} = require('node:crypto');
const {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} = require('node:fs');
const {join} = require('node:path');
const {spawnSync} = require('node:child_process');

const root = join(__dirname, '..');
const dist = join(root, 'dist');
const derivedData = join(dist, 'DerivedData');
const appName = 'LectureScribe.app';
const builtApp = join(derivedData, 'Build', 'Products', 'Release', appName);
const packagedApp = join(dist, appName);
const archive = join(dist, 'LectureScribe-macOS-unsigned.zip');

function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, stdio: 'inherit'});
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function requireFile(path, description) {
  if (!existsSync(path)) throw new Error(`Missing ${description}: ${path}`);
}

try {
  rmSync(dist, {recursive: true, force: true});
  mkdirSync(dist, {recursive: true});

  run('xcodebuild', [
    '-workspace', 'macos/LectureScribe.xcworkspace',
    '-scheme', 'LectureScribe-macOS',
    '-configuration', 'Release',
    '-sdk', 'macosx',
    '-derivedDataPath', derivedData,
    'ARCHS=arm64 x86_64',
    'ONLY_ACTIVE_ARCH=NO',
    'CODE_SIGNING_ALLOWED=YES',
    'CODE_SIGN_IDENTITY=-',
    'build',
  ]);

  requireFile(builtApp, 'Release app bundle');
  run('ditto', [builtApp, packagedApp]);
  const app = packagedApp;
  requireFile(join(app, 'Contents', 'Resources', 'main.jsbundle'), 'bundled JavaScript');
  const frameworks = ['llama.framework', 'whisper.framework', 'hermes.framework'];
  for (const framework of frameworks) {
    requireFile(join(app, 'Contents', 'Frameworks', framework), `embedded ${framework}`);
  }

  // Swift package frameworks arrive pre-signed; re-sign them after Xcode copies them
  // so the final ad-hoc app has a valid nested code signature.
  for (const framework of frameworks) {
    run('codesign', ['--force', '--sign', '-', '--timestamp=none', join(app, 'Contents', 'Frameworks', framework)]);
  }
  run('codesign', ['--force', '--sign', '-', '--timestamp=none', app]);
  run('codesign', ['--verify', '--deep', '--strict', app]);

  const executable = join(app, 'Contents', 'MacOS', 'LectureScribe');
  requireFile(executable, 'app executable');
  const architectures = spawnSync('lipo', ['-archs', executable], {encoding: 'utf8'});
  if (architectures.status !== 0 || !architectures.stdout.includes('arm64') || !architectures.stdout.includes('x86_64')) {
    throw new Error(`Expected a universal arm64/x86_64 executable, got: ${architectures.stdout || architectures.stderr}`);
  }

  run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', packagedApp, archive]);

  const checksum = createHash('sha256').update(readFileSync(archive)).digest('hex');
  writeFileSync(join(dist, 'LectureScribe-macOS-unsigned.zip.sha256'), `${checksum}  LectureScribe-macOS-unsigned.zip\n`);
  console.log(`Created ${archive}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
