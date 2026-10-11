// Rasteriza um SVG em PNG com fundo transparente usando o próprio Electron (sem dependências).
// Uso: node_modules/electron/dist/Electron.app/Contents/MacOS/Electron scripts/render-svg.cjs <entrada.svg> <saida-dir> <nome:tamanho>...
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');

const [svgPath, outDir, ...jobs] = process.argv.slice(2);
app.dock?.hide();
app.whenReady().then(async () => {
  try {
    mkdirSync(outDir, { recursive: true });
    const svg = readFileSync(svgPath, 'utf8');
    const max = Math.max(...jobs.map((j) => Number(j.split(':')[1])));
    const win = new BrowserWindow({ show: false, width: max, height: max, useContentSize: true, transparent: true, frame: false });
    await win.loadURL('data:text/html,<body style="margin:0;background:transparent;overflow:hidden"></body>');
    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    for (const job of jobs) {
      const [name, sizeText] = job.split(':');
      const size = Number(sizeText);
      await win.webContents.executeJavaScript(`new Promise((resolve) => { const i = new Image(); i.onload = () => { document.body.replaceChildren(i); resolve(); }; i.width = ${size}; i.height = ${size}; i.src = ${JSON.stringify(dataUrl)}; })`);
      await new Promise((r) => setTimeout(r, 200));
      const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
      writeFileSync(join(outDir, `${name}.png`), image.toPNG());
    }
    win.destroy();
  } catch (err) {
    console.error('render-svg falhou:', err);
    process.exitCode = 1;
  }
  app.quit();
});
