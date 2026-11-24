/* SmartGrid Digital Twin — lightweight 3D geometry renderer, no external libraries required. */
(() => {
  const canvas = document.getElementById('twinCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const state = { data:null, selected:null, yaw:-0.62, pitch:0.62, zoom:1, dragging:false, moved:false, lastX:0, lastY:0, points:[], raf:0, active:false, start:performance.now() };
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const hex=(h)=>{const n=parseInt(h.replace('#',''),16);return [(n>>16)&255,(n>>8)&255,n&255]};
  const shade=(c,k)=>`rgb(${c.map(v=>Math.round(clamp(v*k,0,255))).join(',')})`;
  function project(p,w,h){
    const cy=Math.cos(state.yaw),sy=Math.sin(state.yaw),cp=Math.cos(state.pitch),sp=Math.sin(state.pitch);
    const x=p.x*cy-p.z*sy, z=p.x*sy+p.z*cy;
    const yy=p.y*cp-z*sp, depth=p.y*sp+z*cp;
    const scale=(Math.min(w,h)*0.115*state.zoom)/(1+depth*0.055);
    return {x:w*.5+x*scale,y:h*.56-yy*scale,depth,scale};
  }
  const boxFaces=(cx,cy,cz,sx,sy,sz,color,kind='box')=>{
    const x0=cx-sx/2,x1=cx+sx/2,y0=cy,y1=cy+sy,z0=cz-sz/2,z1=cz+sz/2;
    const v=[{x:x0,y:y0,z:z0},{x:x1,y:y0,z:z0},{x:x1,y:y1,z:z0},{x:x0,y:y1,z:z0},{x:x0,y:y0,z:z1},{x:x1,y:y0,z:z1},{x:x1,y:y1,z:z1},{x:x0,y:y1,z:z1}];
    const faces=[[0,1,2,3,0.72],[4,7,6,5,1.08],[0,4,5,1,0.88],[3,2,6,7,0.95],[0,3,7,4,0.78],[1,5,6,2,0.84]];
    return faces.map(f=>({pts:f.slice(0,4).map(i=>v[i]),color:shade(hex(color),f[4]),kind,depth:f.slice(0,4).reduce((s,i)=>s+v[i].z,0)/4}));
  };
  function roomGeometry(area,index,total){
    const cols=3, row=Math.floor(index/cols),col=index%cols;
    const x=(col-1)*3.15,z=(row-1)*2.72;
    const high=area.peakW>area.thresholdW, elevated=area.peakW>area.thresholdW*.78;
    const base=high?'#d85e62':elevated?'#d9a34c':'#4d9b89';
    const faces=[];
    faces.push(...boxFaces(x,-.16,z,2.82,.22,2.38,'#aab8bd','floor'));
    // Three low walls create an open-front dollhouse room.
    faces.push(...boxFaces(x,0.0,z-1.12,2.82,.92,.12,base,'wall'));
    faces.push(...boxFaces(x-1.35,0.0,z, .12,.92,2.24,'#b6c4c6','wall'));
    faces.push(...boxFaces(x+1.35,0.0,z,.12,.92,2.24,'#8fa6a8','wall'));
    // Furniture and equipment blocks vary by room type while staying clearly illustrative.
    const id=area.id;
    if(/kitchen|canteen/i.test(id+' '+area.name)){
      faces.push(...boxFaces(x-.55,.02,z-.25,.72,.62,.68,'#d7d2c6','cabinet'));
      faces.push(...boxFaces(x+.48,.02,z+.38,.55,.78,.5,'#9aaeb1','appliance'));
      faces.push(...boxFaces(x+.15,.02,z-.65,.6,.42,.28,'#b8a58c','counter'));
    } else if(/bed|hostel|living|lounge/i.test(id+' '+area.name)){
      faces.push(...boxFaces(x-.42,.02,z+.18,1.1,.34,.78,'#7e91a2','furniture'));
      faces.push(...boxFaces(x+.55,.02,z-.52,.42,.62,.42,'#b4a58c','furniture'));
    } else if(/bath|laundry|utility/i.test(id+' '+area.name)){
      faces.push(...boxFaces(x-.48,.02,z-.3,.58,.55,.58,'#91b5b8','appliance'));
      faces.push(...boxFaces(x+.48,.02,z+.35,.56,.46,.55,'#b8c7c6','appliance'));
    } else {
      faces.push(...boxFaces(x-.48,.02,z+.18,.78,.52,.58,'#9baab2','equipment'));
      faces.push(...boxFaces(x+.55,.02,z-.42,.42,.72,.42,'#b7c0c1','equipment'));
      faces.push(...boxFaces(x+.42,.02,z+.58,.5,.28,.3,'#c1ad8c','equipment'));
    }
    return {area,index,x,z,base,high,elevated,faces};
  }
  function draw(){
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(devicePixelRatio||1,2),w=Math.max(1,Math.floor(rect.width*dpr)),h=Math.max(1,Math.floor(rect.height*dpr));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    ctx.setTransform(dpr,0,0,dpr,0,0);const W=rect.width,H=rect.height;
    const dark=document.body.classList.contains('dark');
    const bg=ctx.createLinearGradient(0,0,0,H);bg.addColorStop(0,dark?'#172638':'#edf4f2');bg.addColorStop(1,dark?'#0d1724':'#dce9e6');ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
    // soft ground plane
    const ground=[{x:-7,y:-.3,z:-5},{x:7,y:-.3,z:-5},{x:7,y:-.3,z:5},{x:-7,y:-.3,z:5}].map(p=>project(p,W,H));
    ctx.beginPath();ground.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.closePath();ctx.fillStyle=dark?'rgba(49,79,91,.26)':'rgba(111,154,145,.18)';ctx.fill();
    const areas=state.data?.areas||[];const rooms=areas.slice(0,9).map(roomGeometry);
    const faces=[];
    rooms.forEach(r=>r.faces.forEach(f=>faces.push({...f,room:r})));
    // central meter plinth and hub
    faces.push(...boxFaces(0,-.05,3.9,1.05,.3,.85,'#4c7c83','hub').map(f=>({...f,hub:true})));
    faces.push(...boxFaces(0,.25,3.9,.48,.68,.42,'#6fb9a9','hub').map(f=>({...f,hub:true})));
    faces.sort((a,b)=>project({x:0,y:0,z:b.depth},W,H).depth-project({x:0,y:0,z:a.depth},W,H));
    const drawPoly=(pts,fill,stroke)=>{const p=pts.map(v=>project(v,W,H));ctx.beginPath();p.forEach((v,i)=>i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=1;ctx.stroke();}};
    faces.forEach(f=>{drawPoly(f.pts,f.color,dark?'rgba(9,18,29,.38)':'rgba(52,73,78,.22)');});
    // Energy conduits from the hub to each area, with animated travelling pulses.
    const now=(performance.now()-state.start)/1000;
    rooms.forEach((r,i)=>{
      const start={x:0,y:.65,z:3.9},end={x:r.x,y:.2,z:r.z};
      const a=project(start,W,H),b=project(end,W,H);
      ctx.save();ctx.strokeStyle=dark?'rgba(100,214,191,.28)':'rgba(49,139,125,.27)';ctx.lineWidth=2;ctx.setLineDash([4,6]);ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.restore();
      for(let j=0;j<3;j++){
        const t=(now*.22+j/3+i*.037)%1,px=start.x+(end.x-start.x)*t,py=start.y+(end.y-start.y)*t+.12*Math.sin(t*Math.PI),pz=start.z+(end.z-start.z)*t;
        const q=project({x:px,y:py,z:pz},W,H);ctx.beginPath();ctx.arc(q.x,q.y,2.6+(1-t)*1.2,0,Math.PI*2);ctx.fillStyle=r.high?'#f07872':'#61d6bc';ctx.shadowColor=ctx.fillStyle;ctx.shadowBlur=12;ctx.fill();ctx.shadowBlur=0;
      }
    });
    // Room labels and selection outlines.
    state.points=[];
    rooms.forEach(r=>{
      const center=project({x:r.x,y:.95,z:r.z},W,H),floor=project({x:r.x,y:0,z:r.z},W,H);
      const selected=state.selected===r.area.id;
      ctx.save();ctx.textAlign='center';ctx.font='600 10px Inter,system-ui,sans-serif';ctx.fillStyle=dark?'#e7f3f1':'#203b43';ctx.fillText(r.area.name.length>22?r.area.name.slice(0,20)+'…':r.area.name,center.x,center.y-7);
      ctx.font='700 9px Inter,system-ui,sans-serif';ctx.fillStyle=r.high?'#d94e55':r.elevated?'#b77d25':'#27816f';ctx.fillText(`${Math.round(r.area.peakW).toLocaleString('en-IN')} W`,center.x,center.y+7);
      ctx.restore();
      const radius=Math.max(34,Math.min(62,project({x:r.x+1.1,y:0,z:r.z},W,H).x-floor.x));
      if(selected){ctx.beginPath();ctx.ellipse(floor.x,floor.y+5,radius*1.02,radius*.42,-.08,0,Math.PI*2);ctx.strokeStyle='#39b99e';ctx.lineWidth=2.4;ctx.stroke();}
      state.points.push({id:r.area.id,x:floor.x,y:floor.y,r:radius,area:r.area});
    });
    const hub=project({x:0,y:1.05,z:3.9},W,H);ctx.textAlign='center';ctx.font='700 9px Inter,system-ui,sans-serif';ctx.fillStyle=dark?'#d9f8ef':'#1e6159';ctx.fillText('SMART METER',hub.x,hub.y-5);ctx.font='8px Inter,system-ui,sans-serif';ctx.fillStyle=dark?'#a7c7c0':'#47766e';ctx.fillText('SIMULATED',hub.x,hub.y+8);
    // Small orientation legend
    ctx.textAlign='left';ctx.font='9px Inter,system-ui,sans-serif';ctx.fillStyle=dark?'#b4c5d2':'#59727b';ctx.fillText('DRAG TO ROTATE  ·  SCROLL TO ZOOM',16,H-16);
    if(state.active)state.raf=requestAnimationFrame(draw);
  }
  function updateInfo(){
    const area=state.data?.areas?.find(a=>a.id===state.selected)||state.data?.areas?.[0];
    if(!area)return;state.selected=area.id;
    const high=area.peakW>area.thresholdW,warning=area.peakW>area.thresholdW*.78;
    document.getElementById('twinSelectedName').textContent=area.name;
    document.getElementById('twinSelectedCategory').textContent=area.category||'Monitored area';
    document.getElementById('twinSelectedEnergy').textContent=`${Number(area.dailyKWh).toLocaleString('en-IN',{maximumFractionDigits:1})} kWh`;
    document.getElementById('twinSelectedPeak').textContent=`${Number(area.peakW).toLocaleString('en-IN')} W`;
    document.getElementById('twinSelectedStatus').textContent=high?'Threshold exceeded':warning?'Elevated':'Within limit';
    document.getElementById('twinSelectedStatus').className='twin-status '+(high?'danger':warning?'warning':'normal');
    document.getElementById('twinEquipment').innerHTML=(area.equipment||[]).map(e=>`<div class="twin-equipment-row"><span>${String(e.name).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span><b>${e.share}%</b><i><em style="width:${e.share}%"></em></i></div>`).join('');
  }
  function selectAt(x,y){let nearest=null,dist=Infinity;for(const p of state.points){const d=Math.hypot(x-p.x,y-p.y);if(d<p.r&&d<dist){nearest=p;dist=d;}}if(nearest){state.selected=nearest.id;updateInfo();if(window.onSmartGridTwinSelect)window.onSmartGridTwinSelect(nearest.id);}}
  canvas.addEventListener('pointerdown',e=>{state.dragging=true;state.moved=false;state.lastX=e.clientX;state.lastY=e.clientY;canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!state.dragging)return;const dx=e.clientX-state.lastX,dy=e.clientY-state.lastY;if(Math.abs(dx)+Math.abs(dy)>2)state.moved=true;state.yaw+=dx*.008;state.pitch=clamp(state.pitch+dy*.004,.28,1.05);state.lastX=e.clientX;state.lastY=e.clientY;});
  canvas.addEventListener('pointerup',e=>{if(state.dragging&&!state.moved){const r=canvas.getBoundingClientRect();selectAt(e.clientX-r.left,e.clientY-r.top);}state.dragging=false;});
  canvas.addEventListener('wheel',e=>{e.preventDefault();state.zoom=clamp(state.zoom*(e.deltaY>0?.92:1.08),.68,1.55);},{passive:false});
  document.getElementById('twinResetView')?.addEventListener('click',()=>{state.yaw=-.62;state.pitch=.62;state.zoom=1;});
  window.addEventListener('resize',()=>{if(state.data&&state.active)drawOnce();});
  function drawOnce(){cancelAnimationFrame(state.raf);state.raf=0;if(state.active)draw();}
  window.SmartGridTwin={update(data,selected){state.data=data;if(selected&&data.areas.some(a=>a.id===selected))state.selected=selected;if(!state.selected||!data.areas.some(a=>a.id===state.selected))state.selected=data.areas[0]?.id;updateInfo();if(state.active&&!state.raf)drawOnce();},select(id){state.selected=id;updateInfo();},setActive(active){state.active=!!active;if(state.active&&!state.raf)drawOnce();else if(!state.active){cancelAnimationFrame(state.raf);state.raf=0;}},destroy(){cancelAnimationFrame(state.raf);state.raf=0;state.active=false;}};
})();
