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
  'LocalGravity_2.0.0_x64_en-US.msi.sig'
);

let winSignature = '';
if (fs.existsSync(msiSigPath)) {
  winSignature = fs.readFileSync(msiSigPath, 'utf8').trim();
}

const manifest = {
  version,
  notes: `LocalGravity ${version} Release - Auto-Update enabled via GitHub Releases.\nIncludes anti-repetition sampling, collapsible agent activity, and instant model hot-swapping.`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: winSignature,
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_2.0.0_x64_en-US.msi`,
    },
    'darwin-aarch64': {
      signature: winSignature, // Fallback signature placeholder until macOS arm64 build runs in CI
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_2.0.0_aarch64.dmg`,
    },
  },
};

const outputPath = path.join(rootDir, 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Generated ${outputPath} for ${version} successfully!`);
