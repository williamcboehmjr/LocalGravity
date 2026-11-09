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
  notes: `LocalGravity ${version} Release:\n- Standardized on Swift 1.5 Flash-Next (GSQ-RCO-IQ2_XS + Vision) across WebUI, Windows, and macOS.\n- Removed inactive legacy models from UI selectors and settings for streamlined experience.\n- Trailing action intent detection in premature stop guard.\n- Real-time live tokens/second calculation and telemetry streaming.`,
  pub_date: new Date().toISOString(),
  platforms: {
    'windows-x86_64': {
      signature: winSignature,
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_${clientPkg.version}_x64_en-US.msi`,
    },
    'darwin-aarch64': {
      signature: winSignature,
      url: `https://github.com/williamcboehmjr/LocalGravity/releases/download/${version}/LocalGravity_${clientPkg.version}_aarch64.dmg`,
    },
  },
};

const outputPath = path.join(rootDir, 'latest.json');
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`Generated ${outputPath} for ${version} successfully!`);
