// Faithful mirror of ReconnectBadge.tsx ring math + a REAL live countdown loop.
const size = 56, stroke = 4;
const radius = (size - stroke) / 2;            // 26
const circumference = 2 * Math.PI * radius;     // 163.3628...

function ringOffset(secondsRemaining, totalSeconds){
  const safeTotal = Math.max(totalSeconds, 1);
  const progress = Math.min(Math.max(secondsRemaining, 0), safeTotal) / safeTotal;
  return circumference * (1 - progress);
}

// Render the badge as an ASCII ring so UI is visible in terminal output.
function renderRing(remaining, total){
  const W=24,H=13, cx=W/2, cy=H/2, R=6;
  const grid=[...Array(H)].map(()=>Array(W).fill(' '));
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){
    const d=Math.hypot(x-cx,y-cy);
    if(Math.abs(d-R)<0.6)grid[y][x]='.';          // track ring
  }
  const progress = Math.min(Math.max(remaining,0),total)/total;
  for(let i=0;i<Math.round(progress*32);i++){     // sweep arc proportional to time left
    const ang=(i/32)*2*Math.PI - Math.PI/2;
    const x=Math.round(cx+R*Math.cos(ang)), y=Math.round(cy+R*Math.sin(ang));
    if(y>=0&&y<H&&x>=0&&x<W)grid[y][x]='#';
  }
  grid[Math.round(cy)][Math.round(cx)-1]=String(remaining); // center number
  return grid.map(r=>r.join('')).join('\n');
}

const TOTAL=5, ATTEMPT=1;
let remaining = TOTAL;
function tick(){
  const off = ringOffset(remaining, TOTAL).toFixed(3);
  const p = Math.min(Math.max(remaining,0),TOTAL)/TOTAL;
  console.log(`--- t=${remaining}s | progress=${p.toFixed(3)} dashoffset=${off} | Attempt #${ATTEMPT}`);
  console.log(renderRing(remaining, TOTAL));
  remaining -= 1;
  if(remaining < 0){
    console.log('\n[timer] DONE -> ring empty (··), reconnect attempt fired. clearInterval() called.');
    clearInterval(iv);
    return;
  }
}

const iv = setInterval(tick, 1000);   // real wall-clock countdown: one tick per second
tick();                                // initial render at t=5
