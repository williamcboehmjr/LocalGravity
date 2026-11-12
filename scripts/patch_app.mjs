import fs from 'node:fs';

const filePath = 'client/src/App.tsx';
let content = fs.readFileSync(filePath, 'utf-8');

content = content.replace(
  "const cleanHost = effectiveHost.replace(/^http/, 'ws');",
  "const cleanHost = effectiveHost.replace(/^http/, 'ws').replace('localhost', '127.0.0.1');"
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('App.tsx cleanHost patched');
