import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const clientDir = path.join(rootDir, 'client');
const keyPath = path.join(clientDir, 'src-tauri', 'localgravity-updater.key');

if (!fs.existsSync(keyPath)) {
  console.error(`Error: Signing key not found at ${keyPath}`);
  process.exit(1);
}

const privateKey = fs.readFileSync(keyPath, 'utf8').trim();
const env = {
  ...process.env,
  TAURI_SIGNING_PRIVATE_KEY: privateKey,
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: '',
};

console.log('Loaded signing key. Starting Tauri release build with updater artifacts...');

try {
  execSync('npx tauri build --bundles msi', {
    cwd: clientDir,
    stdio: 'inherit',
    env,
  });
  console.log('Tauri MSI and updater artifacts built successfully!');
} catch (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
}
