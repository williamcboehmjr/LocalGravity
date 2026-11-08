import fs from 'node:fs';

// 1. client/src/styles/index.css
let css = fs.readFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/styles/index.css', 'utf8');
if (!css.includes('@media (max-width: 768px)')) {
  css = css.replace(
    /(body\s*\{[\s\S]*?font-size:\s*13px;[\s\S]*?\})/,
    '$1\n\n@media (max-width: 768px) {\n  body {\n    font-size: 15px;\n    line-height: 1.6;\n  }\n}'
  );
  fs.writeFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/styles/index.css', css, 'utf8');
  console.log('Updated index.css');
}

// 2. client/src/components/center-canvas/ChatFeed.tsx
let chatFeed = fs.readFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/components/center-canvas/ChatFeed.tsx', 'utf8');
// user message box
chatFeed = chatFeed.replace(
  'rounded-xl px-4 py-3 text-[13px] text-[#E3E3E3] space-y-2',
  'rounded-xl px-4 py-3 text-[15px] sm:text-[13px] text-[#E3E3E3] space-y-2'
);
// assistant markdown container
chatFeed = chatFeed.replace(
  'text-[13px] text-[#E3E3E3] leading-relaxed pt-1 prose',
  'text-[15px] sm:text-[13px] text-[#E3E3E3] leading-relaxed pt-1 prose'
);
// paragraphs
chatFeed = chatFeed.replace(
  'return <p className="my-1 leading-relaxed text-[13px] text-[#D8D8DC]">{children}</p>;',
  'return <p className="my-1.5 leading-relaxed text-[15px] sm:text-[13px] text-[#D8D8DC]">{children}</p>;'
);
// ul
chatFeed = chatFeed.replace(
  '<ul className="list-disc pl-5 my-1 space-y-0.5 text-[13px] text-[#D8D8DC]',
  '<ul className="list-disc pl-5 my-1.5 space-y-1 text-[15px] sm:text-[13px] text-[#D8D8DC]'
);
// ol
chatFeed = chatFeed.replace(
  '<ol className="list-decimal pl-5 my-1 space-y-0.5 text-[13px] text-[#D8D8DC]',
  '<ol className="list-decimal pl-5 my-1.5 space-y-1 text-[15px] sm:text-[13px] text-[#D8D8DC]'
);
// headings
chatFeed = chatFeed.replace(
  'h1 className="text-sm font-semibold text-white mt-2.5 mb-1 pb-0.5 border-b border-[#262629]">{children}</h1>',
  'h1 className="text-base sm:text-sm font-semibold text-white mt-3 mb-1 pb-0.5 border-b border-[#262629]">{children}</h1>'
);
chatFeed = chatFeed.replace(
  'h2 className="text-[13px] font-semibold text-white mt-2 mb-0.5">{children}</h2>',
  'h2 className="text-[15px] sm:text-[13px] font-semibold text-white mt-2.5 mb-1">{children}</h2>'
);
chatFeed = chatFeed.replace(
  'h3 className="text-xs font-medium text-[#A0A0A5] uppercase tracking-wider mt-1.5 mb-0.5">{children}</h3>',
  'h3 className="text-sm sm:text-xs font-medium text-[#A0A0A5] uppercase tracking-wider mt-2 mb-0.5">{children}</h3>'
);
fs.writeFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/components/center-canvas/ChatFeed.tsx', chatFeed, 'utf8');
console.log('Updated ChatFeed.tsx');

// 3. client/src/components/center-canvas/ThoughtAccordion.tsx
let thoughtAcc = fs.readFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/components/center-canvas/ThoughtAccordion.tsx', 'utf8');
thoughtAcc = thoughtAcc.replace(
  'className="group inline-flex items-center gap-1.5 text-xs text-[#8E8E93]',
  'className="group inline-flex items-center gap-1.5 text-sm sm:text-xs text-[#8E8E93]'
);
thoughtAcc = thoughtAcc.replace(
  'border-l text-xs leading-relaxed whitespace-pre-wrap',
  'border-l text-[13.5px] sm:text-xs leading-relaxed whitespace-pre-wrap'
);
fs.writeFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/components/center-canvas/ThoughtAccordion.tsx', thoughtAcc, 'utf8');
console.log('Updated ThoughtAccordion.tsx');

// 4. client/src/components/center-canvas/PromptBar.tsx
let promptBar = fs.readFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/components/center-canvas/PromptBar.tsx', 'utf8');
promptBar = promptBar.replace(
  'outline-none text-[13px] text-[#E3E3E3]',
  'outline-none text-[16px] sm:text-[13px] text-[#E3E3E3]'
);
fs.writeFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/components/center-canvas/PromptBar.tsx', promptBar, 'utf8');
console.log('Updated PromptBar.tsx');

// 5. client/src/App.tsx
let app = fs.readFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/App.tsx', 'utf8');
// header breadcrumbs
app = app.replace(
  'flex items-center gap-1.5 text-xs min-w-0 truncate',
  'flex items-center gap-1.5 text-sm sm:text-xs min-w-0 truncate'
);
// mobile bottom nav
app = app.replace(
  'nav className="h-12 shrink-0',
  'nav className="h-14 shrink-0'
);
app = app.replace(
  /className=\{`flex-1 flex flex-col items-center justify-center gap-0\.5 text-\[11px\]/g,
  'className={`flex-1 flex flex-col items-center justify-center gap-1 text-xs'
);
fs.writeFileSync('C:/Users/Sue/.gemini/antigravity/scratch/LocalGravity/client/src/App.tsx', app, 'utf8');
console.log('Updated App.tsx');
