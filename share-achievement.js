// Imagens geradas no próprio aparelho; nenhum dado do participante é enviado a outro serviço.
(() => {
  const el = id => document.getElementById(id);
  let format = "post", participant = null, blob = null, previewUrl = null, generation = 0;
  const sizes = { post: [1080, 1080], story: [1080, 1920], certificate: [1600, 1132] };
  let universityLogo;
  const logoReady = new Promise(resolve => {
    const image = new Image();
    image.onload = () => { universityLogo = image; resolve(); };
    image.onerror = () => resolve();
    image.src = "assets/unipar-logo-horizontal.png";
  });
  function universityBrand(ctx, x, y, width) {
    if (universityLogo) {
      ctx.drawImage(universityLogo, 160, 250, 1530, 550, x, y, width, width * 550 / 1530);
    } else {
      text(ctx, "UNIPAR", x, y + 44, 40, "#ed1c2e", 800, width);
    }
  }
  const purple = "#171125", lime = "#c8ff3d";

  function text(ctx, value, x, y, size, color, weight = 700, maxWidth = 900) {
    ctx.fillStyle = color;
    do { ctx.font = `${weight >= 800 ? 400 : weight} ${size--}px ${weight >= 800 ? '"Archivo Black"' : "Inter"}, sans-serif`; }
    while (ctx.measureText(String(value)).width > maxWidth && size > 14);
    ctx.fillText(String(value), x, y);
  }
  function star(ctx, x, y, radius, color) {
    ctx.save(); ctx.translate(x,y); ctx.fillStyle=color; ctx.beginPath();
    for (let i=0;i<8;i++) {
      const a=i*Math.PI/4, r=i%2?radius*.23:radius;
      const px=Math.cos(a)*r, py=Math.sin(a)*r;
      if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
    }
    ctx.closePath();ctx.fill();ctx.restore();
  }
  function lines(ctx, y, width, color) {
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(76,y);ctx.lineTo(width-76,y);ctx.stroke();
  }
  function drawSocial(ctx, width, height, p) {
    const story=height>width;
    ctx.fillStyle="#f6f3ee";ctx.fillRect(0,0,width,height);
    ctx.fillStyle="#eee7f5";ctx.beginPath();ctx.moveTo(width*.74,0);ctx.lineTo(width,0);ctx.lineTo(width,height);ctx.lineTo(width*.24,height);ctx.closePath();ctx.fill();
    ctx.fillStyle="#6f35e8";ctx.fillRect(width-30,0,30,height);
    ctx.fillStyle=lime;ctx.fillRect(76,story?325:235,96,9);
    star(ctx,900,story?790:555,70,"#6f35e8");
    const top=story?190:95;
    universityBrand(ctx, 735, top - 38, 265);
    text(ctx,"MISSÃO UPXP",76,top,32,purple,800);
    text(ctx,"UNIPAR · 2026",76,top+42,19,"#716b7b",500);
    const titleY=story?510:340;
    text(ctx,"EU FIZ",70,titleY,122,purple,800);
    text(ctx,"PARTE.",70,titleY+140,133,"#ed1c2e",800);
    text(ctx,"Eu participei da Missão UPXP • UNIPAR.",76,titleY+209,30,"#716b7b",500);
    const nameY=story?1040:745;
    lines(ctx,nameY-90,width,"#ded8e6");
    text(ctx,p.name,76,nameY,56,purple,700,928);
    text(ctx,"Explorei. Aprendi. Superei desafios.",76,nameY+58,27,"#716b7b",400);
    const scoreY=story?1305:905;
    text(ctx,Number(p.score||0).toLocaleString("pt-BR"),76,scoreY,82,"#6f35e8",800,680);
    text(ctx,"PONTOS CONQUISTADOS",76,scoreY+39,18,"#716b7b",600);
    const footerY=story?1700:1020;
    text(ctx,"Educação, Evolução e Legado",76,footerY,31,purple,800,840);
    star(ctx,955,footerY-10,23,"#ed1c2e");
  }
  function drawCertificate(ctx,width,height,p) {
    ctx.fillStyle="#f6f3ee";ctx.fillRect(0,0,width,height);
    ctx.fillStyle="#ed1c2e";ctx.fillRect(0,0,34,height);
    ctx.strokeStyle="#d2c6de";ctx.lineWidth=2;ctx.strokeRect(66,52,width-118,height-104);
    universityBrand(ctx, 1120, 115, 320);
    text(ctx,"MISSÃO UPXP",120,155,35,purple);
    text(ctx,"UNIPAR · 2026",120,198,20,"#765e8c",500);
    text(ctx,"CERTIFICADO",120,350,81,"#ed1c2e",800,1350);
    text(ctx,"DE PARTICIPAÇÃO",124,402,27,"#73548d",600);
    text(ctx,"Este certificado celebra a participação de",124,510,27,"#73617d",400);
    text(ctx,p.name,120,613,70,purple,700,1340);
    ctx.strokeStyle="#d1c5d9";ctx.beginPath();ctx.moveTo(124,650);ctx.lineTo(1450,650);ctx.stroke();
    text(ctx,"na Missão UPXP 2026, uma jornada de conhecimento,",124,715,28,"#665570",400,1300);
    text(ctx,"exploração e desafios no campus da UNIPAR.",124,760,28,"#665570",400,1300);
    ctx.fillStyle=purple;ctx.fillRect(124,842,510,120);
    text(ctx,`${Number(p.score||0).toLocaleString("pt-BR")} pontos`,151,911,43,lime,800,454);
    text(ctx,"Educação, Evolução e Legado",690,902,29,purple,800,730);
    text(ctx,"Registro comemorativo de participação · Missão UPXP 2026",124,1040,19,"#8a7896",400,1300);
  }

  function setBusy(busy) {
    el("shareNative").disabled=busy;el("shareDownload").disabled=busy;
  }
  async function render() {
    const version=++generation, selected=format;
    blob=null;setBusy(true);el("shareMessage").textContent="Preparando sua imagem…";
    document.querySelectorAll("[data-share-format]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.shareFormat===format)));
    try {
      if(document.fonts) {
        await Promise.all([document.fonts.load('400 80px "Archivo Black"'), document.fonts.load('700 56px Inter')]);
        await document.fonts.ready;
      }
      await logoReady;
      const canvas=document.createElement("canvas");
      [canvas.width,canvas.height]=sizes[selected];
      const ctx=canvas.getContext("2d");
      if(!ctx) throw new Error("Canvas indisponível");
      if(selected==="certificate") drawCertificate(ctx,canvas.width,canvas.height,participant);
      else drawSocial(ctx,canvas.width,canvas.height,participant);
      const result=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
      if(version!==generation) return;
      if(!result) throw new Error("Imagem indisponível");
      if(previewUrl) URL.revokeObjectURL(previewUrl);
      blob=result;previewUrl=URL.createObjectURL(blob);el("sharePreview").src=previewUrl;
      el("shareMessage").textContent=selected==="certificate"?"Seu certificado comemorativo está pronto para baixar ou compartilhar.":"Sua imagem está pronta para o Instagram e o WhatsApp.";
      setBusy(false);
    } catch {
      if(version===generation) el("shareMessage").textContent="Não foi possível gerar a imagem. Selecione o formato para tentar novamente.";
    }
  }
  function filename(){return `missao-upxp-${format}.png`;}
  function download(){
    if(!blob) return;
    const a=document.createElement("a");a.href=previewUrl;a.download=filename();document.body.appendChild(a);a.click();a.remove();
    el("shareMessage").textContent="Imagem pronta para salvar. Depois, anexe no Instagram ou WhatsApp.";
  }
  async function share(){
    if(!blob) return;
    if(typeof File==="undefined") {download();return;}
    const file=new File([blob],filename(),{type:"image/png"});
    if(!navigator.share || !navigator.canShare || !navigator.canShare({files:[file]})){download();return;}
    setBusy(true);
    try {await navigator.share({files:[file],title:"Eu participei da Missão UPXP!"});}
    catch(error){if(error.name!=="AbortError") el("shareMessage").textContent="Não foi possível compartilhar por aqui. Use Baixar PNG e anexe a imagem no aplicativo.";}
    finally {setBusy(false);}
  }
  document.addEventListener("click",event=>{
    const selection=event.target.closest("[data-share-format]");
    if(selection && sizes[selection.dataset.shareFormat]) {format=selection.dataset.shareFormat;render();return;}
    const action=event.target.closest("[data-action]")?.dataset.action;
    if(action==="share-achievement"){
      if(!state.player || Number(state.player.score)<1000) return;
      participant={name:state.player.name,score:state.player.score};
      el("shareDialog").showModal();render();
    }
    if(action==="share-close") el("shareDialog").close();
    if(action==="share-download") download();
    if(action==="share-native") share();
  });
  el("shareDialog").addEventListener("close",()=>{
    generation++;blob=null;
    el("sharePreview").removeAttribute("src");
    if(previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl=null;
  });
})();
