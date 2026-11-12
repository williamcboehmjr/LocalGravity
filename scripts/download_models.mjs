import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const MODELS = [
  {
    repoId: 'UnstableLlama/Qwen3.5-4B-exl3-4.00bpw',
    destDir: 'E:\\Github\\tabbyAPI\\models\\Qwen3.5-4B-EXL3-4.0bpw',
    linkDir: 'C:\\Users\\Sue\\Documents\\GitHub\\tabbyAPI\\models\\Qwen3.5-4B-EXL3-4.0bpw',
  },
  {
    repoId: 'Ppeerapon/Qwen3.5-9B-EXL3-4.0bpw',
    destDir: 'E:\\Github\\tabbyAPI\\models\\Qwen3.5-9B-EXL3-4.0bpw',
    linkDir: 'C:\\Users\\Sue\\Documents\\GitHub\\tabbyAPI\\models\\Qwen3.5-9B-EXL3-4.0bpw',
  },
];

async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.size > 1024) {
      console.log(`[Skip] Already exists: ${path.basename(destPath)} (${(stat.size / 1024 / 1024).toFixed(1)} MB)`);
      return;
    }
  }

  const tmpPath = `${destPath}.tmp.${Date.now()}`;
  console.log(`[Download] Starting: ${path.basename(destPath)}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
  }

  const totalBytes = Number(res.headers.get('content-length') || 0);
  let downloadedBytes = 0;
  let lastReport = Date.now();

  const fileStream = fs.createWriteStream(tmpPath);
  const reader = res.body.getReader();

  const progressStream = new Readable({
    async read() {
      const { done, value } = await reader.read();
      if (done) {
        this.push(null);
        return;
      }
      downloadedBytes += value.length;
      const now = Date.now();
      if (now - lastReport > 2000) {
        lastReport = now;
        const mb = (downloadedBytes / 1024 / 1024).toFixed(1);
        const totalMb = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(1) + ' MB' : 'unknown';
        const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) + '%' : '';
        console.log(`  -> ${path.basename(destPath)}: ${mb} / ${totalMb} (${percent})`);
      }
      this.push(Buffer.from(value));
    },
  });

  await pipeline(progressStream, fileStream);
  fs.renameSync(tmpPath, destPath);
  console.log(`[Complete] ${path.basename(destPath)} (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
}

async function downloadModel(modelSpec) {
  console.log(`\n======================================================`);
  console.log(`  Fetching repository: ${modelSpec.repoId}`);
  console.log(`  Destination: ${modelSpec.destDir}`);
  console.log(`======================================================`);

  fs.mkdirSync(modelSpec.destDir, { recursive: true });

  const metaRes = await fetch(`https://huggingface.co/api/models/${modelSpec.repoId}`);
  if (!metaRes.ok) {
    throw new Error(`Could not fetch repo metadata for ${modelSpec.repoId}`);
  }
  const meta = await metaRes.json();
  const files = (meta.siblings || []).map((s) => s.rfilename).filter((f) => !f.startsWith('.git'));

  console.log(`Files to download (${files.length}):`, files.join(', '));

  for (const filename of files) {
    const fileUrl = `https://huggingface.co/${modelSpec.repoId}/resolve/main/${encodeURIComponent(filename)}`;
    const destPath = path.join(modelSpec.destDir, filename);
    await downloadFile(fileUrl, destPath);
  }

  // Create junction / symlink in C:\Users\user\Documents\GitHub\tabbyAPI\models
  try {
    if (!fs.existsSync(modelSpec.linkDir)) {
      fs.symlinkSync(modelSpec.destDir, modelSpec.linkDir, 'junction');
      console.log(`[Link] Created junction: ${modelSpec.linkDir} -> ${modelSpec.destDir}`);
    }
  } catch (err) {
    console.warn(`[Link Note] Could not create junction: ${err.message}`);
  }
}

async function main() {
  for (const m of MODELS) {
    try {
      await downloadModel(m);
    } catch (err) {
      console.error(`Error downloading ${m.repoId}:`, err);
    }
  }
  console.log('\n[Done] All requested models downloaded successfully!');
}

main().catch(console.error);
