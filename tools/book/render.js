// node render.js <html> <out.pdf> <boxes.json>
const { chromium } = require('playwright'); const fs=require('fs'); const path=require('path');
const FD=path.join(__dirname,'node_modules/@fontsource');
const faces=[['Cinzel','cinzel',[400,600,700,900],'normal'],['Crimson Pro','crimson-pro',[300,400,600],'normal'],['Crimson Pro','crimson-pro',[300,400],'italic'],['Share Tech Mono','share-tech-mono',[400],'normal']];
let css=''; for (const [fam,dir,ws,st] of faces) for (const w of ws) css+=`@font-face{font-family:'${fam}';font-style:${st};font-weight:${w};src:url(https://fonts.local/${dir}/${dir}-latin-${w}-${st}.woff2) format('woff2');}\n`;
(async()=>{
  const [html,out,bx]=process.argv.slice(2);
  const b=await chromium.launch(); const p=await b.newPage();
  await p.route('https://fonts.googleapis.com/**', r=>r.fulfill({contentType:'text/css',body:css}));
  await p.route('https://fonts.local/**', r=>{const f=r.request().url().split('fonts.local/')[1].split('/'); r.fulfill({contentType:'font/woff2',body:fs.readFileSync(path.join(FD,f[0],'files',f[1]))});});
  await p.goto('file://'+path.resolve(html)); await p.emulateMedia({media:'print'}); await p.evaluate(()=>document.fonts.ready); await p.waitForTimeout(300);
  const info=await p.evaluate(()=>{
    const pages=[...document.querySelectorAll('.page')];
    const over=[...document.querySelectorAll('.card')].map((c,i)=>[i,c.scrollHeight-c.clientHeight]).filter(x=>x[1]>0);
    const fields=[];
    pages.forEach((pg,pi)=>{const o=pg.getBoundingClientRect();
      pg.querySelectorAll('[data-field]').forEach(e=>{
        let kind=e.tagName==='INPUT'?'text':e.classList.contains('d')?'dot':e.classList.contains('cb')?'box':e.classList.contains('bx')?'cross':null;
        if(!kind) return; const r=e.getBoundingClientRect();
        fields.push({page:pi,name:e.dataset.field,kind,x:r.left-o.left,y:r.top-o.top,w:r.width,h:r.height});
      });});
    return {over,fields};
  });
  fs.writeFileSync(bx,JSON.stringify(info.fields));
  console.log('overflowing cards:',JSON.stringify(info.over),'fields',info.fields.length);
  await p.pdf({path:out,preferCSSPageSize:true,printBackground:true});
  await p.screenshot({path:out.replace(/\.pdf$/,'.png'),fullPage:true});
  await b.close();
})();
