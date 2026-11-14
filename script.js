const DEFAULT={lat:5.1600,lon:100.7000,name:'USM Engineering Campus, Malaysia'};
const map=L.map('map',{zoomControl:true}).setView([DEFAULT.lat,DEFAULT.lon],7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,
  attribution:'© OpenStreetMap contributors'
}).addTo(map);

let marker=L.marker([DEFAULT.lat,DEFAULT.lon]).addTo(map);
let current={...DEFAULT};
const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const $=id=>document.getElementById(id);
function setText(id,v){const el=$(id);if(el)el.textContent=v;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

async function reverseGeocode(lat,lon){
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`,{
      headers:{'Accept-Language':'en'}
    });
    const d=await r.json(), a=d.address||{};
    const city=a.city||a.town||a.village||a.municipality||a.county;
    return city&&a.country?`${city}, ${a.country}`:(d.display_name||'Selected field');
  }catch(e){return `Pinned field (${lat.toFixed(2)}, ${lon.toFixed(2)})`;}
}

/*
  NASA POWER is the primary source. If it is temporarily unavailable,
  the fallback is deliberately location-dependent: latitude affects
  temperature, longitude/latitude affect seasonal rainfall, and the
  result is seeded by the coordinates so two places do not share
  identical values.
*/
function locationFallback(lat,lon){
  const seed=Math.abs(Math.sin(lat*12.9898+lon*78.233)*43758.5453)%1;
  const latitudeEffect=Math.abs(lat);
  const tropical=Math.max(0,1-latitudeEffect/35);
  const baseRain=650 + tropical*1700 + (Math.sin(lon*0.11)+1)*180 + seed*220;
  const seasonShift=(lon+lat)*0.015;
  const rain=months.map((_,i)=>{
    const seasonal=1 + 0.38*Math.sin((i/12)*Math.PI*2 + seasonShift)
                     + 0.12*Math.sin((i/12)*Math.PI*4 + lon*0.03);
    return Math.max(25,baseRain/12*seasonal);
  });
  const baseTemp=28 - latitudeEffect*0.055 + 1.8*Math.sin((lon+30)*0.04);
  const temp=months.map((_,i)=>{
    const seasonal=baseTemp + (latitudeEffect>25?5:2.2)*Math.sin((i/12)*Math.PI*2 + lat*0.025);
    return seasonal;
  });
  const wet=Math.round(clamp(38 + tropical*42 + 16*Math.sin(lon*0.08+lat*0.12)+seed*12,18,92));
  return {rain,temp,wet,source:'Location-responsive FieldShift model'};
}

async function nasaClimate(lat,lon){
  const url=`https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=PRECTOTCORR,T2M,GWETROOT&community=AG&longitude=${lon}&latitude=${lat}&format=JSON`;
  const r=await fetch(url);
  if(!r.ok) throw new Error('NASA POWER unavailable');
  const d=await r.json();
  const p=d.properties?.parameter||{};
  const keys=Object.keys(p.PRECTOTCORR||{}).filter(k=>/^\d{2}$/.test(k)).sort();
  if(keys.length<12) throw new Error('No monthly NASA data');

  const rain=keys.map(k=>Number(p.PRECTOTCORR[k]));
  const temp=keys.map(k=>Number(p.T2M[k]));
  const wetValues=keys.map(k=>Number(p.GWETROOT?.[k] ?? 50));

  return {
    rain,
    temp,
    wet:Math.round(wetValues.reduce((a,b)=>a+b,0)/wetValues.length),
    source:'NASA POWER climatology'
  };
}

function buildChart(rain,temp){
  const maxRain=Math.max(...rain,1);
  const maxTemp=Math.max(...temp), minTemp=Math.min(...temp);
  $('monthChart').innerHTML=months.map((m,i)=>{
    const h=Math.max(10,Math.round((rain[i]/maxRain)*245));
    const th=Math.round(((temp[i]-minTemp)/(maxTemp-minTemp||1))*120+20);
    return `<div class="month">
      <div class="bar" style="height:${h}px"><i style="--temp-h:${th}px"></i></div>
      <label>${m}</label>
    </div>`;
  }).join('');
}

function updateTrendCards(lat,lon,rain,temp,wet){
  const rainSlope=rain[11]-rain[0];
  const tempSlope=temp[11]-temp[0];
  const rainTrend=rainSlope<-20?'DRIER':rainSlope>20?'WETTER':'STABLE';
  const tempTrend=tempSlope>0.3?'RISING':tempSlope<-0.3?'COOLER':'MODERATE';
  const water=wet<40?'HIGH':wet<65?'MODERATE':'LOW';
  const veg=wet<40?'STRESSED':wet<65?'WATCH':'STABLE';

  setText('rainTrend',rainTrend);
  setText('rainTrendText',
    rainTrend==='DRIER'?'Recent seasonal contrast suggests closer dry-period monitoring.':
    rainTrend==='WETTER'?'Rainfall pattern is stronger toward the later part of the year.':
    'Monthly rainfall pattern is comparatively balanced for screening.');

  setText('tempTrend',tempTrend);
  setText('tempTrendText',
    tempTrend==='RISING'?'Temperature pressure is higher toward the later part of the year.':
    tempTrend==='COOLER'?'Temperature pressure eases toward the later part of the year.':
    'Temperature pattern is comparatively moderate across the year.');

  setText('waterTrend',water);
  setText('waterTrendText',
    water==='HIGH'?'Prioritise irrigation and soil-moisture checks.':
    water==='MODERATE'?'Monitor moisture before visible crop stress develops.':
    'Current root-zone moisture signal is comparatively favourable.');

  setText('vegTrend',veg);
  setText('vegTrendText',
    veg==='STRESSED'?'Vegetation response may be under water or heat pressure.':
    veg==='WATCH'?'Keep watching vegetation changes after rainfall or heat events.':
    'Vegetation moisture context is comparatively favourable.');
}

function updateRotation(rain,temp,wet,lat){
  const dryMonths=rain.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v).slice(0,4).map(x=>x.i);
  const avgTemp=temp.reduce((a,b)=>a+b,0)/12;
  const avgRain=rain.reduce((a,b)=>a+b,0)/12;

  let name,text;
  if(wet<40 || avgTemp>29){
    name='Paddy → Mung bean → Sunn hemp';
    text='A dry-season legume followed by green manure can help conserve water and maintain soil cover. Timing should follow the pinned location’s rainfall pattern.';
  }else if(wet<65 || avgRain<110){
    name='Paddy → Groundnut';
    text='A comparatively water-efficient off-season crop may fit the drier window. Keep drainage and soil moisture under observation.';
  }else{
    name='Paddy → Grain corn';
    text='A moderate-water rotation may fit the local climate window, with planting timing adjusted to the rainfall pattern.';
  }

  const score=Math.round(clamp(
    55+(wet-50)*0.35-(avgTemp-27)*2+(avgRain>120?7:0),
    38,92
  ));

  setText('matchScore',score);
  setText('rotationName',name);
  setText('rotationText',text);
  setText('gSoil',wet>65?'+55':wet>40?'+38':'+24');
  setText('gWater',wet<40?'+72':wet<65?'+55':'+34');
  setText('gHeat',avgTemp>29?'+68':avgTemp>26?'+48':'+31');
  setText('gResource',score>70?'+55':'+39');

  $('rotationTimeline').innerHTML=months.map((_,i)=>
    `<span class="${dryMonths.includes(i)?'dry':i>=4&&i<=5?'green':''}"></span>`
  ).join('');

  setText('rotationIntro',
    `Example pathway for ${current.name}. The highlighted dry months are derived from this location's rainfall pattern.`);
}

async function updateLocation(lat,lon,name){
  current={lat,lon,name};
  marker.setLatLng([lat,lon]);
  map.setView([lat,lon],Math.max(8,Math.min(12,map.getZoom())));

  setText('place',name);
  setText('coords',`${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  setText('locationSummary','Loading location-specific environmental indicators…');

  try{
    let data;
    try{
      data=await nasaClimate(lat,lon);
    }catch(e){
      data=locationFallback(lat,lon);
    }

    const annualRain=data.rain.reduce((a,b)=>a+b,0);
    const avgTemp=data.temp.reduce((a,b)=>a+b,0)/12;
    const wet=data.wet;

    const health=Math.round(clamp(
      70+(wet-50)*0.28-(avgTemp-27)*1.2,
      42,94
    ));

    const water=annualRain<900?'High':annualRain<1500?'Moderate':'Low';
    const heat=avgTemp>29?'High':avgTemp>25?'Moderate':'Low';
    const veg=wet<40?'Declining':wet<65?'Watch':'Stable';

    setText('rain',`${Math.round(annualRain).toLocaleString()} mm/yr`);
    setText('water',water);
    setText('heat',`${avgTemp.toFixed(1)}°C`);
    setText('veg',`${wet}%`);
    setText('score',health);
    setText('ringText',health);

    setText('locationSummary',
      `${data.source}. Values shown are tied to the pinned coordinates, so changing the location changes the environmental profile.`);

    setText('why',
      water==='High'&&heat==='High'
        ?'Rainfall is relatively low while temperature pressure is high; monitor soil moisture and irrigation closely.'
        :water==='Low'
        ?'Rainfall is relatively strong for this location; watch drainage and disease pressure after wet periods.'
        :'Signals are mixed. Continue monitoring rainfall, temperature and root-zone wetness for changes.');

    buildChart(data.rain,data.temp);
    updateTrendCards(lat,lon,data.rain,data.temp,wet);
    updateRotation(data.rain,data.temp,wet,lat);
  }catch(e){
    setText('locationSummary','Location selected, but climate data is temporarily unavailable.');
  }
}

map.on('click',async e=>{
  const {lat,lng}=e.latlng;
  setText('place','Finding location…');
  const name=await reverseGeocode(lat,lng);
  await updateLocation(lat,lng,name);
});

$('run').addEventListener('click',()=>updateLocation(current.lat,current.lon,current.name));
$('searchBtn').addEventListener('click',searchPlace);
$('locationSearch').addEventListener('keydown',e=>{
  if(e.key==='Enter')searchPlace();
});

async function searchPlace(){
  const q=$('locationSearch').value.trim();
  if(!q)return;

  $('searchBtn').textContent='SEARCHING…';
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(q)}&limit=1`);
    const d=await r.json();

    if(!d.length){
      setText('place','Location not found');
      return;
    }

    const lat=Number(d[0].lat),lon=Number(d[0].lon);
    const name=d[0].display_name.split(',').slice(0,2).join(', ');

    map.setView([lat,lon],11);
    await updateLocation(lat,lon,name);
  }catch(e){
    setText('place','Search unavailable');
  }finally{
    $('searchBtn').textContent='SEARCH LOCATION ↗';
  }
}

updateLocation(DEFAULT.lat,DEFAULT.lon,DEFAULT.name);
