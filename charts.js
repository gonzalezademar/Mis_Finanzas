// === MisFinanzas Chart Engine (Canvas API) ===
const Charts = {
  colors: {income:'#06d6a0', expense:'#ef476f', accent:'#118ab2', warn:'#ffd166',
    palette:['#06d6a0','#ef476f','#118ab2','#ffd166','#8b5cf6','#f97316','#ec4899','#14b8a6','#a855f7','#64748b']},

  _ctx(id) {
    const c = document.getElementById(id);
    if(!c) return null;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr; c.height = rect.height * dpr;
    const ctx = c.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0,0,rect.width,rect.height);
    return {ctx, w:rect.width, h:rect.height};
  },

  miniBar(id, data) {
    const r = this._ctx(id); if(!r || !data.length) return;
    const {ctx,w,h} = r;
    const max = Math.max(...data.map(d=>Math.max(d.income,d.expense)),1);
    const barW = Math.min(24, (w-40)/(data.length*2.5));
    const gap = barW*0.5;
    const totalW = data.length*(barW*2+gap) - gap;
    const startX = (w-totalW)/2;
    const botY = h-24, topY = 10;

    data.forEach((d,i) => {
      const x = startX + i*(barW*2+gap);
      const hInc = (d.income/max)*(botY-topY);
      const hExp = (d.expense/max)*(botY-topY);

      ctx.fillStyle = this.colors.income;
      ctx.beginPath(); ctx.roundRect(x, botY-hInc, barW, hInc, [4,4,0,0]); ctx.fill();
      ctx.fillStyle = this.colors.expense;
      ctx.beginPath(); ctx.roundRect(x+barW, botY-hExp, barW, hExp, [4,4,0,0]); ctx.fill();

      ctx.fillStyle = '#64748b'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d.label, x+barW, h-6);
    });
  },

  barChart(id, data) {
    const r = this._ctx(id); if(!r || !data.length) return;
    const {ctx,w,h} = r;
    const pad = {t:20,b:36,l:55,r:16};
    const cw = w-pad.l-pad.r, ch = h-pad.t-pad.b;
    const max = Math.max(...data.map(d=>Math.max(d.income,d.expense)),1);
    const barW = Math.min(28, cw/(data.length*3));

    // Grid
    for(let i=0;i<=4;i++) {
      const y = pad.t + (ch/4)*i;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(pad.l,y); ctx.lineTo(w-pad.r,y); ctx.stroke();
      ctx.fillStyle = '#64748b'; ctx.font = '10px sans-serif'; ctx.textAlign = 'right';
      ctx.fillText('$'+Math.round(max-max/4*i).toLocaleString(), pad.l-6, y+4);
    }

    data.forEach((d,i) => {
      const cx = pad.l + (cw/(data.length))*(i+0.5);
      const hI = (d.income/max)*ch, hE = (d.expense/max)*ch;
      ctx.fillStyle = this.colors.income;
      ctx.beginPath(); ctx.roundRect(cx-barW-1, pad.t+ch-hI, barW, hI, [4,4,0,0]); ctx.fill();
      ctx.fillStyle = this.colors.expense;
      ctx.beginPath(); ctx.roundRect(cx+1, pad.t+ch-hE, barW, hE, [4,4,0,0]); ctx.fill();
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d.label, cx, h-pad.b+16);
    });

    // Legend
    [{c:this.colors.income,t:'Ingresos'},{c:this.colors.expense,t:'Egresos'}].forEach((l,i) => {
      const lx = w/2 + (i-1)*60 + 10;
      ctx.fillStyle = l.c; ctx.beginPath(); ctx.arc(lx,8,4,0,Math.PI*2); ctx.fill();
      ctx.fillStyle = '#94a3b8'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
      ctx.fillText(l.t, lx+8, 12);
    });
  },

  donut(id, legendId, data) {
    const r = this._ctx(id); if(!r) return;
    const {ctx,w,h} = r;
    if(!data.length) { ctx.fillStyle='#64748b';ctx.font='14px sans-serif';ctx.textAlign='center';ctx.fillText('Sin datos',w/2,h/2);return; }
    const total = data.reduce((s,d)=>s+d.amount,0);
    const cx=w/2, cy=h/2-10, radius=Math.min(cx,cy)-20;
    let angle = -Math.PI/2;

    data.forEach((d,i) => {
      const slice = (d.amount/total)*Math.PI*2;
      ctx.fillStyle = this.colors.palette[i % this.colors.palette.length];
      ctx.beginPath(); ctx.moveTo(cx,cy); ctx.arc(cx,cy,radius,angle,angle+slice); ctx.closePath(); ctx.fill();
      angle += slice;
    });
    // Inner circle (donut hole)
    ctx.fillStyle = '#111827'; ctx.beginPath(); ctx.arc(cx,cy,radius*0.55,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = '#f1f5f9'; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('$'+total.toLocaleString('es',{minimumFractionDigits:0,maximumFractionDigits:0}), cx, cy+6);

    // Legend
    const leg = document.getElementById(legendId);
    if(leg) {
      leg.innerHTML = data.map((d,i) => `<div class="legend-item"><span class="legend-dot" style="background:${this.colors.palette[i%this.colors.palette.length]}"></span>${d.icon} ${d.name} ($${d.amount.toLocaleString('es',{maximumFractionDigits:0})})</div>`).join('');
    }
  },

  lineChart(id, projection) {
    const r = this._ctx(id); if(!r || !projection.length) return;
    const {ctx,w,h} = r;
    const pad = {t:20,b:30,l:55,r:16};
    const cw = w-pad.l-pad.r, ch = h-pad.t-pad.b;
    const allVals = projection.flatMap(p=>[p.optimistic,p.realistic,p.pessimistic]);
    const min = Math.min(...allVals), max = Math.max(...allVals);
    const range = max-min || 1;

    const toX = i => pad.l + (i/(projection.length-1))*cw;
    const toY = v => pad.t + (1-(v-min)/range)*ch;

    // Grid
    for(let i=0;i<=4;i++){
      const y=pad.t+(ch/4)*i; const val=max-range/4*i;
      ctx.strokeStyle='rgba(255,255,255,0.06)';ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
      ctx.fillStyle='#64748b';ctx.font='9px sans-serif';ctx.textAlign='right';
      ctx.fillText('$'+Math.round(val).toLocaleString(),pad.l-4,y+3);
    }

    // Fill between optimistic and pessimistic
    ctx.fillStyle = 'rgba(17,138,178,0.08)';
    ctx.beginPath();
    projection.forEach((p,i) => { i===0?ctx.moveTo(toX(i),toY(p.optimistic)):ctx.lineTo(toX(i),toY(p.optimistic)); });
    for(let i=projection.length-1;i>=0;i--) ctx.lineTo(toX(i),toY(projection[i].pessimistic));
    ctx.closePath(); ctx.fill();

    // Lines
    const drawLine = (key,color,dash) => {
      ctx.strokeStyle=color; ctx.lineWidth=2; ctx.setLineDash(dash||[]);
      ctx.beginPath();
      projection.forEach((p,i) => { i===0?ctx.moveTo(toX(i),toY(p[key])):ctx.lineTo(toX(i),toY(p[key])); });
      ctx.stroke(); ctx.setLineDash([]);
    };
    drawLine('optimistic','#06d6a0',[6,3]);
    drawLine('realistic','#118ab2');
    drawLine('pessimistic','#ef476f',[6,3]);

    // Start dot
    ctx.fillStyle='#f1f5f9';ctx.beginPath();ctx.arc(toX(0),toY(projection[0].realistic),5,0,Math.PI*2);ctx.fill();

    // Labels
    ctx.fillStyle='#64748b';ctx.font='9px sans-serif';ctx.textAlign='center';
    ctx.fillText('Hoy',toX(0),h-8);
    ctx.fillText('Meta',toX(projection.length-1),h-8);

    // Legend
    [{c:'#06d6a0',t:'Optimista',d:true},{c:'#118ab2',t:'Realista'},{c:'#ef476f',t:'Pesimista',d:true}].forEach((l,i)=>{
      const lx=pad.l+i*80;
      ctx.strokeStyle=l.c;ctx.lineWidth=2;ctx.setLineDash(l.d?[4,2]:[]);
      ctx.beginPath();ctx.moveTo(lx,12);ctx.lineTo(lx+16,12);ctx.stroke();ctx.setLineDash([]);
      ctx.fillStyle='#94a3b8';ctx.font='9px sans-serif';ctx.textAlign='left';ctx.fillText(l.t,lx+20,15);
    });
  }
};
