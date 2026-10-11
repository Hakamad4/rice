// Screenshots do logo (Electron escondido, sem abrir o app): Dock (ícone 128 px em fundo neutro), mini Rice (nub) em repouso
// e no hover, e a barra de menus (imagem template em barra clara e escura).
// Uso: node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/perf/logo-shots.cjs <saida-dir>
const { app, BrowserWindow } = require('electron');
const { writeFileSync, mkdirSync, readFileSync } = require('node:fs');
const { join, resolve } = require('node:path');

const out = resolve(process.argv[2] ?? 'logo-shots');
const repo = resolve(__dirname, '../..');
app.dock?.hide();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (file) => readFileSync(join(repo, file)).toString('base64');

let win;
async function shot(name, { width, height, html, url, scale = 2, transparent = false, after }) {
  win.setContentSize(width, height);
  if (url) await win.loadURL(url);
  else {
    const file = join(out, `.${name}.html`);
    writeFileSync(file, html);
    await win.loadFile(file);
  }
  await win.webContents.setZoomFactor(scale);
  win.setContentSize(Math.round(width * scale), Math.round(height * scale));
  await wait(300);
  if (after) await after(win);
  await wait(400);
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: Math.round(width * scale), height: Math.round(height * scale) });
  writeFileSync(join(out, `${name}.png`), image.toPNG());
}

app.whenReady().then(async () => {
  mkdirSync(out, { recursive: true });
  const stub = join(out, '.nub-stub.cjs');
  writeFileSync(stub, "const { contextBridge } = require('electron'); contextBridge.exposeInMainWorld('nub', { uiLanguage: 'pt-BR', openMain(){}, stop(){}, expand: async()=>({}), collapse: async()=>{}, ask: async()=>({}), cancel(){}, dragEnd(){}, on(){} });");
  win = new BrowserWindow({ show: false, width: 400, height: 300, useContentSize: true, frame: false, transparent: true, webPreferences: { preload: stub } });
  // 1. Dock: o ícone renderizado em 128 px sobre fundo neutro (claro e escuro)
  const dock = (bg) => `<body style="margin:0;background:${bg};display:flex;align-items:center;justify-content:center;width:100vw;height:100vh"><img width="128" height="128" src="data:image/png;base64,${b64('assets/icon/icon.png')}"></body>`;
  await shot('dock-128-claro', { width: 200, height: 200, html: dock('#d9d9d9'), scale: 1 });
  await shot('dock-128-escuro', { width: 200, height: 200, html: dock('#2b2b2b'), scale: 1 });

  // 2. Barra de menus: imagem template pintada de preto (barra clara) e branco (barra escura), 16/32 px
  const bar = (bg, color) => `<body style="margin:0;background:#888"><div style="height:28px;background:${bg};display:flex;align-items:center;padding:0 12px;gap:14px;font:13px -apple-system,sans-serif;color:${color}"><span style="width:16px;height:16px;display:inline-block;background:${color};-webkit-mask:url(data:image/png;base64,${b64('assets/icon/trayTemplate@2x.png')}) center/contain no-repeat"></span><span>REC</span><span style="margin-left:auto">qui 10:41</span></div></body>`;
  await shot('bandeja-barra-clara', { width: 260, height: 28, html: bar('#e8e6e1', '#000'), scale: 3 });
  await shot('bandeja-barra-escura', { width: 260, height: 28, html: bar('#2a2a2c', '#fff'), scale: 3 });

  // 3. Mini Rice (nub): a página real com um preload que simula a API
  const nubUrl = `file://${join(repo, 'src/renderer/nub.html')}`;
  for (const [name, hover] of [['nub-repouso', false], ['nub-hover', true]]) {
    await shot(name, {
      width: 330, height: 86, url: nubUrl, scale: 3,
      after: async (win) => {
        await win.webContents.executeJavaScript(`document.body.style.background='#5b6b82'; document.body.classList.toggle('hover', ${hover}); document.getElementById('bars').innerHTML = '<i></i><i></i><i></i><i></i>'; 0`);
      },
    });
  }
  app.quit();
});
