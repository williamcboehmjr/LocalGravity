import fs from 'node:fs';

const filePath = 'server/src/tabby/tabbyEngine.ts';
let content = fs.readFileSync(filePath, 'utf-8');

// 1. Add adminKey field
content = content.replace(
  "  private apiKey: string;",
  "  private apiKey: string;\n  private adminKey: string;"
);

// 2. Initialize in constructor
content = content.replace(
  "    this.apiKey = options.apiKey || process.env.TABBY_API_KEY || 'glasshouse-tabby-secret';",
  "    this.apiKey = options.apiKey || process.env.TABBY_API_KEY || 'glasshouse-tabby-secret';\n    this.adminKey = (options as any).adminKey || process.env.TABBY_ADMIN_KEY || 'glasshouse-admin-secret';"
);

// 3. In switchModelTier
content = content.replace(
  `        if (this.apiKey) {
          headers['Authorization'] = \`Bearer \${this.apiKey}\`;
          headers['x-api-key'] = this.apiKey;
        }`,
  `        const adminAuth = this.adminKey || this.apiKey;
        if (adminAuth) {
          headers['Authorization'] = \`Bearer \${adminAuth}\`;
          headers['x-admin-key'] = adminAuth;
          headers['x-api-key'] = adminAuth;
        }`
);

// 4. In unloadModelDueToIdle
content = content.replace(
  `        if (this.apiKey) {
          headers['Authorization'] = \`Bearer \${this.apiKey}\`;
          headers['x-api-key'] = this.apiKey;
        }`,
  `        const adminAuth = this.adminKey || this.apiKey;
        if (adminAuth) {
          headers['Authorization'] = \`Bearer \${adminAuth}\`;
          headers['x-admin-key'] = adminAuth;
          headers['x-api-key'] = adminAuth;
        }`
);

fs.writeFileSync(filePath, content, 'utf-8');
console.log('Successfully patched adminKey in tabbyEngine.ts');
