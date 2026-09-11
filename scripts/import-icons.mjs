import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const revision = '242f7e883a6851e496ad01531ca499059230c57e';
const repository = 'https://raw.githubusercontent.com/OthelloRhin/MHW_Icons_SVG';
const types = {
  'great-sword':'Great_Sword', 'long-sword':'Long_Sword', 'sword-shield':'Sword_&_Shield',
  'dual-blades':'Dual_Blades', hammer:'Hammer', 'hunting-horn':'Hunting_Horn', lance:'Lance',
  gunlance:'Gunlance', 'switch-axe':'Switch_Axe', 'charge-blade':'Charge_Blade',
  'insect-glaive':'Insect_Glaive', 'light-bowgun':'Light_Bowgun', 'heavy-bowgun':'Heavy_Bowgun', bow:'Bow',
};
const armor = {head:'Helm', chest:'Chest', arms:'Arms', waist:'Torso', legs:'Legs', charm:'Charm'};
const colorAliases = {'dark-purple':'DPURPLE', 'moss-green':'MOS', 'sage-green':'SGREEN'};
const decorations = JSON.parse(await readFile(new URL('data/decorations.json',root),'utf8'));
const tasks = [];
for (const [kind,name] of Object.entries({...types,...armor})) {
  for (let rarity=1;rarity<=8;rarity++) {
    const rank=String(rarity).padStart(2,'0');
    const source=`SVG/${kind in types?'Weapons':'Hunter'}/${name}/${name}_${kind==='charge-blade'?'rank':'Rank'}_${rank}.svg`;
    tasks.push({path:`equipment/${kind}-${rarity}.svg`,url:`${repository}/${revision}/${source.split('/').map(encodeURIComponent).join('/')}`});
  }
}
const jewels=new Map(decorations.map(d=>[`${d.slot}-${d.icon.color}`,{level:d.slot,color:d.icon.color}]));
for (const {level,color} of jewels.values()) {
  const sourceColor=colorAliases[color]??color.toUpperCase();
  tasks.push({path:`decorations/${level}-${color}.png`,url:`https://www.phantombrawlers.com/static/MHWilds/Decoration%20Icons/${level}_I_${sourceColor}.png`});
}
tasks.push({path:'LICENSE-MIT.txt',url:`${repository}/${revision}/LICENSE`});
const records=[];
// Bounded requests; assets are vendored so the app never hotlinks or depends on these hosts.
for(let offset=0;offset<tasks.length;offset+=6) {
  await Promise.all(tasks.slice(offset,offset+6).map(async task=>{
    const response=await fetch(task.url);
    if(!response.ok)throw Error(`${task.path}: HTTP ${response.status}`);
    const data=Buffer.from(await response.arrayBuffer());
    if(task.path.endsWith('.svg')&&(!data.toString().includes('<svg')||/<script|onload=|<foreignObject/i.test(data.toString())))throw Error(`Invalid SVG: ${task.path}`);
    if(task.path.endsWith('.png')&&data.subarray(1,4).toString()!=='PNG')throw Error(`Invalid PNG: ${task.path}`);
    const destination=new URL(`public/icons/${task.path}`,root);
    await mkdir(new URL('.',destination),{recursive:true});
    await writeFile(destination,data);
    records.push({...task,sha256:createHash('sha256').update(data).digest('hex')});
  }));
}
const rarityColors={};
for(let rarity=1;rarity<=8;rarity++) {
  const svg=await readFile(new URL(`public/icons/equipment/bow-${rarity}.svg`,root),'utf8');
  const color=svg.match(/id="color_01"[^>]+fill:(rgb\([^)]+\))/)?.[1];
  if(!color)throw Error(`Missing rarity color ${rarity}`);
  rarityColors[rarity]=color;
}
await writeFile(new URL('lib/icon-palette.json',root),JSON.stringify(rarityColors,null,2)+'\n');
await writeFile(new URL('public/icons/manifest.json',root),JSON.stringify({revision,assets:records.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
console.log(`Imported ${records.length} icon assets and license; rarity palette:`,rarityColors);
