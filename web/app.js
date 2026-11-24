'use strict';

const $ = id => document.getElementById(id);
const app = { data: null, analytics: null, page: 'dashboard', selectedAreaId: null, tourStep: 0, toastTimer: null, requestVersion: 0 };
const palette = ['#438e81','#75aa9f','#9ec5bd','#d4e5df','#7f9dbb','#b0a0d3','#d1ad70','#87a7a0','#bac6d1'];
const money = n => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const number = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 1 });
const watts = n => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' W';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const qs = values => new URLSearchParams(values).toString();

async function request(path, method = 'GET') {
  const response = await fetch(path, { method, cache: 'no-store' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}
function toast(message) {
  const node = $('toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(app.toastTimer);
  app.toastTimer = setTimeout(() => node.classList.remove('show'), 2700);
}
function setConnection(ok) {
  const box = document.querySelector('.sync-state');
  box.classList.toggle('offline', !ok);
  $('connectionText').textContent = ok ? 'Connected' : 'Offline';
}

async function loadAnalytics() {
  try { app.analytics = await request('/api/analytics'); }
  catch (error) {
    // The server provides a fallback analysis if the native analytics program is unavailable.
    // Keep the UI useful even if the analytics endpoint itself cannot be reached.
    const readings = app.data?.readings || [];
    if (readings.length) {
      const values = readings.map(r => Number(r.powerW));
      const middle = Math.floor(values.length / 2);
      const mean = xs => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;
      const first = mean(values.slice(0,middle)), second = mean(values.slice(middle));
      app.analytics = { trend: second > first*1.05 ? 'RISING' : second < first*.95 ? 'FALLING' : 'STABLE', averagePowerW: mean(values), firstHalfAverageW:first, secondHalfAverageW:second, peakPowerW:Math.max(...values), forecastNextW:values.at(-1), readingCount:values.length, clusters:{low:readings.filter(r=>r.status==='NORMAL').length,medium:readings.filter(r=>r.status==='HIGH CONSUMPTION').length,high:readings.filter(r=>r.status==='POTENTIAL OVERLOAD').length}, engine:'BROWSER_FALLBACK', algorithm:'Browser fallback: split-half trend and last-value estimate' };
    } else app.analytics = null;
  }
}
async function refreshData({ quiet = false } = {}) {
  const version = ++app.requestVersion;
  try {
    const data = await request('/api/state');
    if (version !== app.requestVersion) return;
    app.data = data;
    await loadAnalytics();
    if (version !== app.requestVersion) return;
    setConnection(true);
    renderAll();
  } catch (error) {
    if (version !== app.requestVersion) return;
    setConnection(false);
    if (!quiet) toast(`Cannot load project data: ${error.message}`);
  }
}
async function postAction(path, successMessage) {
  const version = ++app.requestVersion;
  try {
    const updated = await request(path, 'POST');
    if (version !== app.requestVersion) return false;
    app.data = updated;
    await loadAnalytics();
    if (version !== app.requestVersion) return false;
    setConnection(true);
    renderAll();
    if (successMessage) toast(successMessage);
    return true;
  } catch (error) { toast(error.message); return false; }
}

function navigate(page) {
  if (!document.querySelector(`.page[data-page="${page}"]`)) return;
  app.page = page;
  document.querySelectorAll('.page').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.querySelectorAll('.nav-link[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  const nav = document.querySelector(`.nav-link[data-page="${page}"] .nav-text`);
  $('currentPageLabel').textContent = nav ? nav.textContent : 'Dashboard';
  $('pageViewport').scrollTo({ top: 0, behavior: 'smooth' });
  $('sidebar').classList.remove('mobile-open');
  $('scrim').classList.remove('show');
  if (page === 'areas' && app.data && !app.selectedAreaId) app.selectedAreaId = app.data.areas[0]?.id || null;
  if (window.SmartGridTwin) window.SmartGridTwin.setActive(page === 'digital-twin');
  if (page === 'digital-twin' && app.data && window.SmartGridTwin) window.SmartGridTwin.update(app.data, app.selectedTwinAreaId);
  if (page === 'settings') renderSettings();
  renderAll();
}
function renderAll() {
  if (!app.data) return;
  const d = app.data, a = app.analytics;
  $('profileSelect').value = d.profileId;
  renderUserIdentity(d);
  renderDashboard(d, a); renderAreas(d); renderMonitoring(d, a); renderAnalytics(d, a); renderAlerts(d, a); renderSimulation(d, a); renderSettings();
  const twinTitle = $('twinPropertyTitle'); if (twinTitle) twinTitle.textContent = d.profileId === 'campus' ? 'Campus energy model' : 'Residential energy model';
  if (window.SmartGridTwin) window.SmartGridTwin.update(d, app.selectedTwinAreaId);
}

function renderLineChart(targetId, readings, config = {}) {
  const host = $(targetId); if (!host) return;
  const rows = readings || [], values = rows.map(r => Number(r.powerW));
  if (!values.length) { host.innerHTML = '<div class="empty-detail">No readings available.</div>'; return; }
  const width = 760, height = targetId === 'monitorChart' ? 280 : 220;
  const pad = { l: 58, r: 16, t: 18, b: 30 };
  const normal = Number(config.normalThresholdW || 0), overload = Number(config.overloadThresholdW || 0);
  const maxValue = Math.max(...values, normal, overload, 1);
  const max = Math.max(500, Math.ceil(maxValue * 1.15 / 500) * 500), min = 0;
  const x = i => pad.l + (values.length === 1 ? 0 : i * (width - pad.l - pad.r) / (values.length - 1));
  const y = v => pad.t + (height - pad.t - pad.b) * (1 - (v - min) / (max - min));
  const areaPath = `M ${x(0)},${height-pad.b} L ${values.map((v,i)=>`${x(i)},${y(v)}`).join(' L ')} L ${x(values.length-1)},${height-pad.b} Z`;
  const grid = Array.from({length:5},(_,i)=>{const val=max*i/4,gy=y(val);return `<g><line x1="${pad.l}" y1="${gy}" x2="${width-pad.r}" y2="${gy}" stroke="var(--border)" stroke-dasharray="3 5"/><text x="${pad.l-9}" y="${gy+3}" text-anchor="end" fill="var(--muted)" font-size="10">${Math.round(val).toLocaleString('en-IN')}</text></g>`;}).join('');
  const statusColor = status => status === 'POTENTIAL OVERLOAD' ? '#d34f56' : status === 'HIGH CONSUMPTION' ? '#d59b32' : '#23865d';
  const segments = values.slice(0,-1).map((v,i)=>{const next=values[i+1], status=[rows[i]?.status,rows[i+1]?.status].includes('POTENTIAL OVERLOAD')?'POTENTIAL OVERLOAD':[rows[i]?.status,rows[i+1]?.status].includes('HIGH CONSUMPTION')?'HIGH CONSUMPTION':'NORMAL';return `<line x1="${x(i)}" y1="${y(v)}" x2="${x(i+1)}" y2="${y(next)}" stroke="${statusColor(status)}" stroke-width="3.5" stroke-linecap="round"/>`;}).join('');
  const thresholdLine = (value, color, label) => value > 0 && value < max ? `<g><line x1="${pad.l}" y1="${y(value)}" x2="${width-pad.r}" y2="${y(value)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="7 5"/><text x="${width-pad.r-2}" y="${y(value)-5}" text-anchor="end" fill="${color}" font-size="9" font-weight="700">${label} ${Math.round(value).toLocaleString('en-IN')} W</text></g>` : '';
  const circles = values.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="var(--surface)" stroke="${statusColor(rows[i]?.status)}" stroke-width="2"><title>Sample ${i+1}: ${Math.round(v).toLocaleString('en-IN')} W · ${rows[i]?.status || 'Unclassified'}</title></circle>`).join('');
  const labels = values.map((_,i)=>i%(values.length>8?2:1)===0?`<text x="${x(i)}" y="${height-8}" text-anchor="middle" fill="var(--muted)" font-size="9">${i+1}</text>`:'').join('');
  host.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Power demand readings coloured by demand classification"><defs><linearGradient id="chartFill-${targetId}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#7c9eaa" stop-opacity=".20"/><stop offset="100%" stop-color="#7c9eaa" stop-opacity="0"/></linearGradient></defs>${grid}${thresholdLine(normal,'#d59b32','NORMAL LIMIT')}${thresholdLine(overload,'#d34f56','OVERLOAD LIMIT')}<path d="${areaPath}" fill="url(#chartFill-${targetId})"/>${segments}${circles}${labels}</svg><div class="chart-status-legend"><span><i class="legend-normal"></i>Normal</span><span><i class="legend-high"></i>High</span><span><i class="legend-over"></i>Overload</span><span><i class="legend-threshold"></i>Thresholds</span></div>`;
}
function renderDashboard(d, a) {
  $('dashboardTitle').textContent = d.profileId === 'campus' ? 'Campus energy dashboard' : 'Home energy dashboard';
  $('dashboardSubtitle').textContent = d.profileId === 'campus' ? 'Monitor buildings and departments, understand demand patterns and identify possible savings.' : 'Monitor rooms and household loads, understand demand patterns and explore possible savings.';
  $('dailyUnits').innerHTML = `${number(d.dailyUnitsKWh)} <small>kWh</small>`;
  $('monthlyUnits').innerHTML = `${number(d.monthlyUnitsKWh)} <small>kWh</small>`;
  $('monthlyBill').textContent = money(d.monthlyBill);
  $('tariffLabel').textContent = `${money(d.tariffPerKWh)} / kWh`;
  const peak = a?.peakPowerW ?? Math.max(...d.readings.map(r=>r.powerW));
  $('peakDemand').innerHTML = `${number(peak)} <small>W</small>`;
  $('peakNote').textContent = `Detected: ${d.detectedCondition || 'Awaiting analysis'} · input: ${d.scenario}`; 
  $('peakBar').style.width = `${Math.min(100, peak / Math.max(1,d.peakCapacityW) * 100)}%`;
  $('avgPower').textContent = a ? `${number(a.averagePowerW)} W` : 'Unavailable';
  $('chartPeak').textContent = `${number(peak)} W`;
  const trend = a?.trend || 'N/A';
  $('trendBadge').textContent = trend;
  $('trendBadge').className = trend === 'RISING' ? 'trend-warn' : trend === 'FALLING' ? 'trend-down' : 'trend-neutral';
  renderLineChart('dashboardChart', d.readings, d);
  $('chartRangeLabel').textContent = `${d.readings.length} sample points · colours show automatic demand bands`;
  const trendDetail = $('trendDetail'); if (trendDetail) { const first=Number(a?.firstHalfAverageW||0), second=Number(a?.secondHalfAverageW||0), delta=first?((second-first)/first*100):0; trendDetail.textContent = a ? `${trend==='RISING'?'Later readings average higher':trend==='FALLING'?'Later readings average lower':'The two halves are within the 5% stability band'} · ${delta>=0?'+':''}${delta.toFixed(1)}% from first-half to second-half average.` : 'Trend unavailable until readings are analysed.'; }
  const normal = a?.clusters?.low ?? d.readings.filter(r=>r.status==='NORMAL').length;
  const high = a?.clusters?.medium ?? d.readings.filter(r=>r.status==='HIGH CONSUMPTION').length;
  const over = a?.clusters?.high ?? d.readings.filter(r=>r.status==='POTENTIAL OVERLOAD').length;
  $('normalCount').textContent = normal; $('highCount').textContent = high; $('overCount').textContent = over;
  const score = Math.max(8, 100 - high*5 - over*14);
  $('healthScore').textContent = score;
  $('healthRing').style.background = `conic-gradient(${over ? '#d56c6c' : high ? '#d2a04d' : 'var(--primary)'} ${score*3.6}deg,var(--border) 0deg)`;
  $('healthTitle').textContent = over ? 'Overload automatically detected' : high ? 'High consumption automatically detected' : 'Normal demand automatically detected';
  $('healthText').textContent = over ? `${over} generated readings exceed ${number(d.overloadThresholdW)} W. The alert was triggered by the readings, not by the scenario button.` : high ? `${high} generated readings are above ${number(d.normalThresholdW)} W. The alert was triggered automatically from the configured limits.` : `All ${d.readings.length} generated readings are within the normal band. The same classification runs after every edit.`;
  $('donutTotal').textContent = number(d.dailyUnitsKWh);
  const total = d.areas.reduce((s,x)=>s+x.dailyKWh,0) || 1;
  let angle = 0; const segments = d.areas.map((area,i)=>{const start=angle;angle+=area.dailyKWh/total*360;return `${palette[i%palette.length]} ${start}deg ${angle}deg`;});
  $('energyDonut').style.background = `conic-gradient(${segments.join(',')})`;
  $('donutLegend').innerHTML = d.areas.slice().sort((x,y)=>y.dailyKWh-x.dailyKWh).slice(0,6).map(area=>{const i=d.areas.indexOf(area);return `<div class="legend-item"><i class="legend-swatch" style="background:${palette[i%palette.length]}"></i><span>${escapeHtml(area.name)}</span><b>${number(area.dailyKWh)}</b></div>`;}).join('');
  const alerts = buildAlerts(d,a);
  $('dashboardAlerts').innerHTML = alerts.length ? alerts.slice(0,3).map(alertPreviewHtml).join('') : '<div class="empty-detail"><b>No active alerts</b><p>Current readings are within the configured limits. Alerts appear automatically when a threshold is crossed.</p></div>';
  $('updatedLabel').textContent = `● ${d.simulated ? 'Simulated data' : 'Connected data'}`;
  $('navAlertCount').textContent = String(alerts.filter(x=>x.level!=='info').length);
}
function buildAlerts(d,a) {
  const out=[];
  const clusters=a?.clusters || {
    low:d.readings.filter(x=>x.status==='NORMAL').length,
    medium:d.readings.filter(x=>x.status==='HIGH CONSUMPTION').length,
    high:d.readings.filter(x=>x.status==='POTENTIAL OVERLOAD').length
  };
  if (clusters.high > 0) out.push({level:'danger',title:'Overall demand exceeded the overload threshold',body:`${clusters.high} of ${d.readings.length} sample points are above ${number(d.overloadThresholdW)} W. This condition was classified automatically from the readings.`,tag:'Automatic detection'});
  else if (clusters.medium > 0) out.push({level:'warning',title:'Overall demand is above the normal threshold',body:`${clusters.medium} of ${d.readings.length} sample points are above ${number(d.normalThresholdW)} W. Review the demand graph and the areas contributing to the load.`,tag:'Automatic detection'});
  for (const area of (d.areas||[])) {
    if (Number(area.peakW) > Number(area.thresholdW)) {
      out.push({level:'warning',title:`${area.name}: area peak limit exceeded`,body:`The entered area peak is ${number(area.peakW)} W, above its editable warning threshold of ${number(area.thresholdW)} W.`,tag:'Area threshold'});
    }
  }
  if (a?.trend === 'RISING') out.push({level:'warning',title:'Demand trend is rising',body:`The second-half average (${number(a.secondHalfAverageW)} W) is more than 5% above the first-half average (${number(a.firstHalfAverageW)} W).`,tag:'Trend detection'});
  return out;
}

function alertPreviewHtml(item) {
  const cls=item.level==='danger'?'red':item.level==='good'?'green':'';
  const symbol=item.level==='danger'?'!':item.level==='good'?'✓':'i';
  return `<div class="alert-preview-item"><span class="alert-mark ${cls}">${symbol}</span><div><b>${escapeHtml(item.title)}</b><p>${escapeHtml(item.body)}</p></div></div>`;
}

function renderAreas(d) {
  if (!app.selectedAreaId || !d.areas.some(x=>x.id===app.selectedAreaId)) app.selectedAreaId=d.areas[0]?.id || null;
  $('areaCount').textContent = `${d.areas.length} areas`;
  $('areaListTitle').textContent = d.profileId==='campus'?'Campus departments & facilities':'Home rooms & spaces';
  $('areasTitle').textContent = d.profileId==='campus'?'Departments & facilities':'Rooms & appliances';
  $('areaCards').innerHTML = d.areas.map(area=>`<button class="area-card ${area.id===app.selectedAreaId?'selected':''}" data-area="${area.id}"><span class="area-symbol">${escapeHtml(area.icon)}</span><span class="area-card-copy"><b>${escapeHtml(area.name)}</b><small>${escapeHtml(area.category)}</small></span><span class="area-card-value"><b>${number(area.dailyKWh)} kWh</b><small>${number(area.peakW)} W peak</small><small class="${area.peakW>area.thresholdW?'area-limit-hit':''}">${area.peakW>area.thresholdW?'Threshold exceeded':'Within area limit'}</small></span></button>`).join('');
  renderAreaDetail(d.areas.find(x=>x.id===app.selectedAreaId));
}
function renderAreaDetail(area) {
  const host=$('areaDetail'); if(!area){host.innerHTML='<div class="empty-detail"><h2>No area selected</h2></div>';return;}
  const equipment=area.equipment || [];
  host.innerHTML=`<div class="area-detail-top"><span class="area-symbol">${escapeHtml(area.icon)}</span><div><h2>${escapeHtml(area.name)}</h2><p>${escapeHtml(area.category)} · Simulated area profile</p></div></div>
    <div class="detail-stats"><div class="detail-stat"><small>Daily energy</small><b>${number(area.dailyKWh)} kWh</b></div><div class="detail-stat"><small>Peak demand</small><b>${number(area.peakW)} W</b></div><div class="detail-stat"><small>Area peak threshold</small><b>${number(area.thresholdW)} W</b></div></div>
    <div class="panel-heading"><div><span class="section-tag">EQUIPMENT BREAKDOWN</span><h2>Estimated usage mix</h2><p>Illustrative contribution to this area's daily usage.</p></div></div>
    <div class="equipment-list">${equipment.map(e=>`<div class="equipment-row"><span>${escapeHtml(e.name)}</span><div class="equipment-track"><i style="width:${e.share}%"></i></div><b>${e.share}%</b></div>`).join('')}</div>
    <div class="edit-area-form"><div class="panel-heading"><div><span class="section-tag">EDITABLE DEMO INPUTS</span><h2>Adjust area data</h2><p>All three values are saved. The area's entered peak is checked against its editable threshold.</p></div></div>
      <div class="form-row"><div><label class="field-label" for="areaDailyInput">Daily energy (kWh)</label><input class="text-input" id="areaDailyInput" type="number" min="0" max="10000" step="0.1" value="${area.dailyKWh}"></div><div><label class="field-label" for="areaPeakInput">Peak power (W)</label><input class="text-input" id="areaPeakInput" type="number" min="0" max="100000" step="50" value="${area.peakW}"></div><div><label class="field-label" for="areaThresholdInput">Area warning threshold (W)</label><input class="text-input" id="areaThresholdInput" type="number" min="1" max="100000" step="50" value="${area.thresholdW}"></div></div>
      <button class="button button-primary save-area" id="saveAreaBtn" data-area-id="${area.id}">Save area values</button>
    </div>`;
}

function renderMonitoring(d,a) {
  const peak=a?.peakPowerW ?? Math.max(...d.readings.map(r=>r.powerW));
  const avg=a?.averagePowerW ?? 0;
  $('monitorKpis').innerHTML=[['CURRENT PEAK',watts(peak),'Highest sample point'],['AVERAGE POWER',watts(avg),'Across sample points'],['READING POINTS',d.readings.length,'Generated values'],['AUTO-DETECTED STATUS',d.detectedCondition || 'Checking','Based on current readings']].map(x=>`<div class="monitor-mini"><small>${x[0]}</small><b>${x[1]}</b><span>${x[2]}</span></div>`).join('');
  renderLineChart('monitorChart',d.readings,d);
  $('readingCount').textContent=`${d.readings.length} readings`;
  $('readingRows').innerHTML=d.readings.map(r=>`<tr><td>#${r.index}</td><td><b>${number(r.powerW)} W</b></td><td>${number(r.voltageV)} V</td><td>${number(r.currentA)} A</td><td><span class="band-pill ${r.status==='POTENTIAL OVERLOAD'?'over':r.status==='HIGH CONSUMPTION'?'high':''}">${r.status==='POTENTIAL OVERLOAD'?'Overload':r.status==='HIGH CONSUMPTION'?'High':'Normal'}</span></td></tr>`).join('');
}
function renderAnalytics(d,a) {
  const max=Math.max(1,...d.areas.map(x=>x.dailyKWh));
  $('comparisonChart').innerHTML=d.areas.slice().sort((x,y)=>y.dailyKWh-x.dailyKWh).map(area=>`<div class="comparison-row"><span>${escapeHtml(area.name)}</span><div class="comparison-track"><i style="width:${area.dailyKWh/max*100}%"></i></div><b>${number(area.dailyKWh)} kWh</b></div>`).join('');
  const peak=a?.peakPowerW ?? Math.max(...d.readings.map(x=>x.powerW));
  const stats=[['Daily energy',`${number(d.dailyUnitsKWh)} kWh`],['Monthly energy',`${number(d.monthlyUnitsKWh)} kWh`],['Estimated monthly bill',money(d.monthlyBill)],['Peak demand',watts(peak)]];
  $('analyticsSummary').innerHTML=stats.map(([k,v])=>`<div class="summary-stat"><small>${k}</small><b>${v}</b></div>`).join('');
  const leader=d.areas.slice().sort((x,y)=>y.dailyKWh-x.dailyKWh)[0];
  $('analyticsInsight').textContent=leader?`${leader.name} currently contributes ${(leader.dailyKWh/Math.max(.01,d.dailyUnitsKWh)*100).toFixed(1)}% of daily estimated energy. Open Areas & equipment to inspect its equipment allocation and edit the input.`:'No area information available.';
  const clusters=a?.clusters || {low:0,medium:0,high:0};
  $('trendCards').innerHTML=[['Trend',a?.trend || 'N/A'],['Average power',a?watts(a.averagePowerW):'Unavailable'],['First half avg.',a?watts(a.firstHalfAverageW):'Unavailable'],['Second half avg.',a?watts(a.secondHalfAverageW):'Unavailable'],['Next sample estimate',a?watts(a.forecastNextW):'Unavailable']].map(([k,v])=>`<div class="trend-card"><small>${k}</small><b>${v}</b></div>`).join('');
  const first=Number(a?.firstHalfAverageW||0), second=Number(a?.secondHalfAverageW||0), change=first?((second-first)/first*100):0;
  $('methodNote').textContent=a?`Trend compares the average of the first half of readings with the second half. Change: ${change>=0?'+':''}${change.toFixed(1)}%. A change greater than 5% is rising; below −5% is falling; otherwise it is stable. The next-sample estimate is a simple statistical estimate, not machine learning. Current bands: ${clusters.low} normal, ${clusters.medium} high, ${clusters.high} overload.`:'Trend is unavailable until readings can be analysed.';
}
function renderAlerts(d,a) {
  const alerts=buildAlerts(d,a), dangerous=alerts.filter(x=>x.level==='danger').length, warnings=alerts.filter(x=>x.level==='warning').length;
  $('alertSummaryCount').textContent=`${alerts.length} active alerts`;
  $('alertBanner').className=`alert-banner ${dangerous?'danger':warnings?'warning':''}`;
  $('alertBanner').innerHTML=`<b>${dangerous?`${dangerous} overload condition(s) need review`:warnings?`${warnings} active warning(s)`: 'No active alerts'}</b><span>Alerts are generated automatically from readings and editable thresholds.</span>`;
  $('alertsFull').innerHTML=alerts.length?alerts.map(item=>{const cls=item.level==='danger'?'red':'';const symbol=item.level==='danger'?'!':'!';return `<article class="full-alert"><span class="alert-mark ${cls}">${symbol}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.body)}</p></div><span class="alert-tag">${escapeHtml(item.tag)}</span></article>`;}).join(''):'<div class="empty-detail"><h2>No active alerts</h2><p>All current sample readings and area peaks are within their configured limits. Create a higher load in Simulation Lab or lower a threshold to see an alert generated automatically.</p></div>';
}
function renderSimulation(d,a) {
  $('scenarioCurrent').innerHTML=`<b>Input pattern:</b> ${escapeHtml(d.scenario)}<br><b>Automatically detected condition:</b> ${escapeHtml(d.detectedCondition || 'Checking')}<small> The pattern button creates sample readings; the system classifies the resulting readings using the saved thresholds.</small>`;
  const peak=a?.peakPowerW ?? Math.max(...d.readings.map(r=>r.powerW));
  $('simulationOutput').innerHTML=[['Peak demand',watts(peak)],['Average demand',a?watts(a.averagePowerW):'Unavailable'],['Detected condition',d.detectedCondition||'Unavailable'],['Power trend',a?.trend||'Unavailable'],['Next sample estimate',a?watts(a.forecastNextW):'Unavailable'],['Added energy',`${number(d.manualExtraKWh)} kWh/day`],['Monthly estimate',money(d.monthlyBill)]].map(([k,v])=>`<div class="output-stat"><small>${k}</small><b>${v}</b></div>`).join('');
  const suggested=d.manualLoadWatts>0?d.manualLoadWatts:1000; if (document.activeElement!==$('customWatts') && document.activeElement!==$('customWattsRange')) { $('customWatts').value=suggested; $('customWattsRange').value=Math.min(30000,suggested); } if(document.activeElement!==$('customHours')) $('customHours').value=d.manualLoadHours>0?d.manualLoadHours:2;
}
function renderUserIdentity(d) {
  const fallback = 'Set your name'; let name = fallback;
  try { name = (localStorage.getItem('smartgrid-user-name') || '').trim() || fallback; } catch (_) {}
  $('sidebarProfile').textContent = name;
  $('sidebarProperty').textContent = d.profileId === 'campus' ? 'Campus profile' : 'Home profile';
  const initials = name === fallback ? 'U' : name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  $('profileAvatar').textContent = initials;
}
function editUserIdentity() {
  let current = ''; try { current = localStorage.getItem('smartgrid-user-name') || ''; } catch (_) {}
  const entered = window.prompt('Name to display in the sidebar:', current);
  if (entered === null) return;
  const name = entered.trim().slice(0,32);
  if (!name) { toast('Please enter a name, or cancel to keep the current one.'); return; }
  try { localStorage.setItem('smartgrid-user-name', name); } catch (_) {}
  if (app.data) renderUserIdentity(app.data);
  toast('Displayed user name updated.');
}

function renderSettings() {
  if(!app.data)return; const d=app.data;
  if(document.activeElement!==$('tariffInput'))$('tariffInput').value=d.tariffPerKWh;
  if(document.activeElement!==$('normalThreshold'))$('normalThreshold').value=d.normalThresholdW;
  if(document.activeElement!==$('overloadThreshold'))$('overloadThreshold').value=d.overloadThresholdW;
}

async function changeProfile(profileId) {
  if (!['campus','home'].includes(profileId)) return;
  await postAction(`/api/profile?${qs({id:profileId})}`, `${profileId==='campus'?'Campus':'Home'} profile loaded`);
  app.selectedAreaId=null;
}
async function saveArea() {
  const id=$('saveAreaBtn')?.dataset.areaId; if(!id)return;
  const daily=Number($('areaDailyInput').value), peak=Number($('areaPeakInput').value), threshold=Number($('areaThresholdInput').value);
  if(!Number.isFinite(daily)||!Number.isFinite(peak)||!Number.isFinite(threshold)||daily<0||daily>10000||peak<0||peak>100000||!Number.isInteger(threshold)||threshold<1||threshold>100000){toast('Enter valid energy, peak power and area threshold values.');return;}
  await postAction(`/api/area?${qs({id,dailyKWh:daily,peakW:peak,thresholdW:threshold})}`,'Area data and threshold saved. Dashboard, demand readings and alerts recalculated.');
}
async function saveSettings() {
  const tariff=Number($('tariffInput').value),normal=Number($('normalThreshold').value),overload=Number($('overloadThreshold').value);
  if(!Number.isFinite(tariff)||tariff<0||tariff>1000||!Number.isInteger(normal)||!Number.isInteger(overload)||normal<1||overload<=normal||overload>100000){toast('Check the tariff and thresholds. Overload must exceed normal.');return;}
  const ok=await postAction(`/api/settings?${qs({tariff,normal,overload})}`,'Configuration saved. Bill and automatic demand classification updated.');
  $('settingsMessage').textContent=ok?`Applied: ${money(tariff)}/kWh · Normal ≤ ${number(normal)} W · Overload > ${number(overload)} W`:'Save failed. Check the values and try again.';
}
async function applyScenario(mode) { await postAction(`/api/scenario?${qs({mode})}`,`${mode} scenario applied. Results recalculated.`); }
async function applyCustomLoad() {
  const value=Number($('customWatts').value), hours=Number($('customHours').value);
  if(!Number.isInteger(value)||value<0||value>100000||!Number.isFinite(hours)||hours<0||hours>24){toast('Enter a valid load (0–100,000 W) and operating time (0–24 hours).');return;}
  await postAction(`/api/simulate?${qs({watts:value,hours})}`,'Additional simulated load applied. Energy, bill, charts and alerts recalculated.');
}
function exportCsv() {
  if(!app.data)return;
  const rows=[['Profile',app.data.profileName],['Property',app.data.propertyName],['Scenario',app.data.scenario],['Tariff INR per kWh',app.data.tariffPerKWh],[],['Area','Category','Daily energy kWh','Peak power W'],...app.data.areas.map(a=>[a.name,a.category,a.dailyKWh,a.peakW]),[],['Reading point','Power W','Voltage V','Current A','Status'],...app.data.readings.map(r=>[r.index,r.powerW,r.voltageV,r.currentA,r.status])];
  const csv=rows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=`SmartGrid_${app.data.profileId}_demo_report.csv`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);toast('CSV report exported.');
}

const tourSteps = [
  {title:'Welcome to SmartGrid Analytics',body:'One energy management prototype with two property profiles. Choose where you want to start. You can switch profiles at any time from the top bar.',kind:'profile'},
  {title:'Explore one section at a time',body:'Use the left navigation to move between Dashboard, Areas & equipment, Live monitoring, Analytics, Alerts and Simulation Lab. Each section is a separate page; scrolling will not take you into another section.',features:['Hover over the three-line menu to expand it on desktop.','Click the menu to pin it open. On mobile, tap to open the navigation drawer.']},
  {title:'Edit the demonstration data',body:'Open Areas & equipment to change daily energy and peak power for an individual area. Open Tariff & thresholds to adjust the illustrative tariff and demand thresholds.',features:['Changes update the monthly estimate and area comparisons.','The generated readings are analysed again using the saved demand limits.']},
  {title:'Experiment, compare and switch themes',body:'Use Simulation Lab to apply demand scenarios or enter a custom watt value. Review the updated graphs and alerts. Dark mode is available from the top-right theme control.',features:['Export a CSV snapshot for further inspection.','All values are simulated; no real meter or appliance is connected.']}
];
function openTour() { app.tourStep=0; renderTour(); $('tourBackdrop').classList.add('show'); $('tourBackdrop').setAttribute('aria-hidden','false'); }
function renderTour() {
  const step=tourSteps[app.tourStep]; $('tourStep').textContent=`QUICK START · ${app.tourStep+1} OF ${tourSteps.length}`;
  $('tourProgress').style.width=`${(app.tourStep+1)/tourSteps.length*100}%`;
  $('tourContent').innerHTML=`<h2 id="tourTitle">${step.title}</h2><p>${step.body}</p>${step.kind==='profile'?`<div class="tour-profile-picks"><button data-tour-profile="campus" class="${app.data?.profileId==='campus'?'selected':''}"><span>▤</span><b>Campus / College</b><small>Buildings, departments and shared facilities</small></button><button data-tour-profile="home" class="${app.data?.profileId==='home'?'selected':''}"><span>⌂</span><b>Residential / Home</b><small>Rooms, appliances and household loads</small></button></div>`:`<div class="tour-feature-list">${(step.features||[]).map(x=>`<div class="tour-feature"><i>✓</i><span>${x}</span></div>`).join('')}</div>`}`;
  $('tourBack').hidden=app.tourStep===0;
  $('tourNext').textContent=app.tourStep===tourSteps.length-1?'Finish tour ✓':'Next step →';
}
function closeTour() { $('tourBackdrop').classList.remove('show');$('tourBackdrop').setAttribute('aria-hidden','true');try{localStorage.setItem('smartgrid-tour-complete','yes');}catch(_){} }

function bindEvents() {
  window.onSmartGridTwinSelect = id => { app.selectedTwinAreaId=id; if(window.SmartGridTwin&&app.data)window.SmartGridTwin.select(id); };
  document.querySelectorAll('.nav-link[data-page]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.page)));
  document.querySelectorAll('[data-goto]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.goto)));
  const openMobileMenu=()=>{$('sidebar').classList.add('mobile-open');$('scrim').classList.add('show');};
  $('mobileMenuBtn').addEventListener('click',openMobileMenu);
  $('menuBtn').addEventListener('click',()=>{
    const side=$('sidebar');
    if(window.matchMedia('(max-width: 900px)').matches){side.classList.toggle('mobile-open');$('scrim').classList.toggle('show',side.classList.contains('mobile-open'));}
    else {side.classList.toggle('pinned');$('menuBtn').setAttribute('aria-expanded',side.classList.contains('pinned')?'true':'false');}
  });
  $('scrim').addEventListener('click',()=>{$('sidebar').classList.remove('mobile-open');$('scrim').classList.remove('show');});
  $('profileSelect').addEventListener('change',e=>changeProfile(e.target.value));
  $('profileEditor').addEventListener('click',editUserIdentity);
  $('themeBtn').addEventListener('click',()=>{document.body.classList.toggle('dark');const dark=document.body.classList.contains('dark');try{localStorage.setItem('smartgrid-dark',dark?'yes':'no');}catch(_){};});
  $('areaCards').addEventListener('click',e=>{const button=e.target.closest('[data-area]');if(!button)return;app.selectedAreaId=button.dataset.area;renderAreas(app.data);});
  $('areaDetail').addEventListener('click',e=>{if(e.target.closest('#saveAreaBtn'))saveArea();});
  document.querySelectorAll('.scenario-card').forEach(button=>button.addEventListener('click',()=>applyScenario(button.dataset.mode)));
  $('applyCustomLoad').addEventListener('click',applyCustomLoad);
  $('customWattsRange').addEventListener('input',e=>{$('customWatts').value=e.target.value;});
  $('customWatts').addEventListener('input',e=>{if(Number(e.target.value)>=0 && Number(e.target.value)<=30000)$('customWattsRange').value=e.target.value;});
  $('saveSettings').addEventListener('click',saveSettings);
  $('dashboardExport').addEventListener('click',exportCsv);$('analyticsExport').addEventListener('click',exportCsv);
  $('tourReplay').addEventListener('click',openTour);$('replayTour').addEventListener('click',openTour);
  $('tourNext').addEventListener('click',()=>{if(app.tourStep<tourSteps.length-1){app.tourStep++;renderTour();}else closeTour();});
  $('tourBack').addEventListener('click',()=>{app.tourStep=Math.max(0,app.tourStep-1);renderTour();});
  $('tourSkip').addEventListener('click',closeTour);
  $('tourContent').addEventListener('click',e=>{const b=e.target.closest('[data-tour-profile]');if(!b)return;changeProfile(b.dataset.tourProfile).then(()=>renderTour());});
  $('twinOpenArea')?.addEventListener('click',()=>{if(!app.data)return;app.selectedAreaId=app.selectedTwinAreaId||app.data.areas[0]?.id;navigate('areas');});
  document.querySelectorAll('[data-challenge]').forEach(button=>button.addEventListener('click',()=>{
    const type=button.dataset.challenge;
    if(type==='spike'){navigate('simulation');applyScenario('Power Spike');}
    else if(type==='bill'){navigate('areas');toast('Choose an area, increase its daily energy and save to see the bill update.');}
    else {const next=app.data?.profileId==='campus'?'home':'campus';changeProfile(next);}
  }));
}

async function init() {
  try { if(localStorage.getItem('smartgrid-dark')==='yes')document.body.classList.add('dark'); } catch(_){}
  bindEvents();
  await refreshData();
  try { if(!localStorage.getItem('smartgrid-tour-complete'))openTour(); } catch(_) { openTour(); }
  // No periodic polling: this prototype has no physical meter feed. Refresh happens after each saved action, preventing input values from being overwritten while editing.
}
window.addEventListener('DOMContentLoaded',init);
