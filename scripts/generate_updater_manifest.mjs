import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const clientPkg = JSON.parse(
  fs.readFileSync(path.join(rootDir, 'client', 'package.json'), 'utf8')
);
const version = `v${clientPkg.version}`;

// Locate Windows MSI signature
const msiSigPath = path.join(
  rootDir,
  'client',
  'src-tauri',
  'target',
  'release',
  'bundle',
  'msi',
  `LocalGravity_${clientPkg.version}_x64_en-US.msi.sig`
);

let winSignature = '';
if (fs.existsSync(msiSigPath)) {
  winSignature = fs.readFileSync(msiSigPath, 'utf8').trim();
} else {
  console.warn(`Warning: MSI signature file not found at ${msiSigPath}`);
}

const manifest = {
  version,
  notes: `LocalGravity ${version} Release`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: winSignature,
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_${clientPkg.version}_x64_en-US.msi`,
    },
    'windows-aarch64': {
      signature: winSignature,
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_${clientPkg.version}_arm64_en-US.msi`,
    },
    'darwin-aarch64': {
      signature: winSignature,
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_${clientPkg.version}_universal.dmg`,
    },
    'darwin-x86_64': {
      signature: winSignature,
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_${clientPkg.version}_universal.dmg`,
    },
    'linux-x86_64': {
      signature: winSignature,
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_${clientPkg.version}_amd64.AppImage`,
    },
    'android-aarch64': {
      signature: '',
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_${clientPkg.version}_arm64.apk`,
    },
  },
};

const outputPath = path.join(rootDir, 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Generated ${outputPath} for ${version} successfully!`);
