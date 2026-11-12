import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const TARGET_DIR = 'F:/Models/Qwen3.8-Flash-Next';
const REPO = 'bartowski/Qwen3.8-Flash-Next-GGUF';
const BASE_URL = `https://huggingface.co/${REPO}/resolve/main`;

const SHARDS = [
  { name: 'Qwen3.8-Flash-Next-IQ3_XXS-00003-of-00003.gguf', sizeExpected: 8918119840, path: 'Qwen3.8-Flash-Next-IQ3_XXS/Qwen3.8-Flash-Next-IQ3_XXS-00003-of-00003.gguf' },
  { name: 'Qwen3.8-Flash-Next-IQ3_XXS-00001-of-00003.gguf', sizeExpected: 39541809664, path: 'Qwen3.8-Flash-Next-IQ3_XXS/Qwen3.8-Flash-Next-IQ3_XXS-00001-of-00003.gguf' },
  { name: 'Qwen3.8-Flash-Next-IQ3_XXS-00002-of-00003.gguf', sizeExpected: 39561316128, path: 'Qwen3.8-Flash-Next-IQ3_XXS/Qwen3.8-Flash-Next-IQ3_XXS-00002-of-00003.gguf' }
];

async function downloadShard(shard) {
  const dest = path.join(TARGET_DIR, shard.name);
  if (fs.existsSync(dest)) {
    const stat = fs.statSync(dest);
    if (stat.size >= shard.sizeExpected - 1024) {
      console.log(`[DONE] ${shard.name} already complete (${(stat.size / 1024**3).toFixed(2)} GB).`);
      return;
    }
  }
  console.log(`[START] Downloading ${shard.name} (~${(shard.sizeExpected / 1024**3).toFixed(2)} GB)...`);
  const url = `${BASE_URL}/${shard.path}`;
  
  return new Promise((resolve, reject) => {
    const proc = spawn('curl.exe', ['-L', '-C', '-', '--retry', '5', '-o', dest, url], {
      stdio: 'inherit'
    });
    proc.on('close', code => {
      if (code === 0) {
        console.log(`[COMPLETED] ${shard.name}`);
        resolve();
      } else {
        reject(new Error(`curl exited with code ${code} for ${shard.name}`));
      }
    });
    proc.on('error', reject);
  });
}

async function run() {
  for (const shard of SHARDS) {
    await downloadShard(shard);
  }
  console.log('ALL SHARDS DOWNLOADED SUCCESSFULLY!');
}

run().catch(err => {
  console.error('Download error:', err);
  process.exit(1);
});
