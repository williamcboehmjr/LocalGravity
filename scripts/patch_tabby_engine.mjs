import fs from 'node:fs';

const filePath = 'server/src/tabby/tabbyEngine.ts';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Update fallbacks
content = content.replace(
  "fallbackFolderNames: ['Qwen3.5-4B-EXL3-4.5bpw', 'Qwen3-VL-8B-Instruct-exl3-4.0bpw'],",
  "fallbackFolderNames: ['Qwen3.5-4B-EXL3-4.0bpw', 'Qwen3.5-4B-EXL3-4.5bpw', 'Qwen3-VL-8B-Instruct-exl3-4.0bpw'],"
);
content = content.replace(
  "fallbackFolderNames: ['Qwen3.5-9B-EXL3-4.0bpw', 'Qwen3-VL-8B-Instruct-exl3-4.0bpw'],",
  "fallbackFolderNames: ['Qwen3.5-9B-EXL3-4.0bpw', 'Qwen3-VL-8B-Instruct-exl3-4.0bpw'],"
);

// 2. High tier fallback: prioritize Qwen3.8-27B-EXL3-11.5GB
content = content.replace(
  `fallbackFolderNames: [
      'Qwen-3.8-27B-VL-EXL3-3.5bpw',
      'Qwen-3.8-27B-VL-EXL3-4.0bpw',
      'Qwen3.8-27B-EXL3-11.5GB',
    ],`,
  `fallbackFolderNames: [
      'Qwen3.8-27B-EXL3-11.5GB',
      'Qwen-3.8-27B-VL-EXL3-4.0bpw',
      'Qwen-3.8-27B-VL-EXL3-3.5bpw',
    ],`
);

// 3. Default URL & API key
content = content.replace(
  "this.tabbyBaseUrl = options.tabbyBaseUrl || `http://127.0.0.1:${options.tabbyPort}`;",
  "this.tabbyBaseUrl = options.tabbyBaseUrl || process.env.LOCALGRAVITY_TABBY_URL || 'http://127.0.0.1:5001';"
);
content = content.replace(
  "this.apiKey = options.apiKey || process.env.TABBY_API_KEY || '';",
  "this.apiKey = options.apiKey || process.env.TABBY_API_KEY || 'localgravity-tabby-secret';"
);

// 4. Models dir on E drive
content = content.replace(
  "path.join(os.homedir(), 'Documents', 'GitHub', 'tabbyAPI', 'models'),",
  "path.join(os.homedir(), 'Documents', 'GitHub', 'tabbyAPI', 'models'),\n      'E:\\\\Github\\\\tabbyAPI\\\\models',"
);

// 5. Port check
content = content.replace(
  "if (this.tabbyPort === 5000 || this.tabbyPort === 5001) {",
  "if (this.tabbyPort === 5000) {"
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Successfully patched tabbyEngine.ts');
