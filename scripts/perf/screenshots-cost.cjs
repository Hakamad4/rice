// Custo de uma rodada de captura (reduzir para 1280 px, JPEG e hash) e, SE a Gravação de Tela já estiver concedida a este
// Electron, também o desktopCapturer. Nunca pede permissão. Uso:
//   npx esbuild src/main/screenshots/grab.ts --bundle --platform=node --external:electron --outfile=/tmp/x/grab.cjs
//   Electron scripts/perf/screenshots-cost.cjs /tmp/x/grab.cjs <pasta-com-pngs>
const { app, nativeImage, systemPreferences } = require('electron');
const { readdirSync, readFileSync } = require('node:fs');
const { join } = require('node:path');
app.dock?.hide();
const [grabPath, framesDir] = process.argv.slice(2);
app.whenReady().then(async () => {
  const grab = require(grabPath);
  const files = readdirSync(framesDir).filter((f) => f.endsWith('.png')).sort();
  const images = files.map((f) => nativeImage.createFromBuffer(readFileSync(join(framesDir, f))));
  const N = 60;
  const rss0 = process.memoryUsage().rss;
  const cpu0 = process.cpuUsage();
  const t0 = process.hrtime.bigint();
  let bytes = 0;
  for (let i = 0; i < N; i++) bytes += grab.frameFromImage(images[i % images.length]).jpeg.length;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const cpu = process.cpuUsage(cpu0);
  const out = {
    frameMs: +(ms / N).toFixed(1),
    cpuMsPerFrame: +((cpu.user + cpu.system) / 1000 / N).toFixed(1),
    avgJpegKB: Math.round(bytes / N / 1024),
    rssDeltaMB: Math.round((process.memoryUsage().rss - rss0) / 1048576),
    screenPermission: process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('screen') : 'n/a',
  };
  if (out.screenPermission === 'granted') {
    const times = [];
    const cpu1 = process.cpuUsage();
    const rss1 = process.memoryUsage().rss;
    for (let i = 0; i < 5; i++) {
      const t1 = process.hrtime.bigint();
      const f = await grab.grabScreen(); // o quadro fica só na memória e é descartado
      times.push(Math.round(Number(process.hrtime.bigint() - t1) / 1e6));
      out.grabScreenOk = Boolean(f);
      await new Promise((r) => setTimeout(r, 300));
    }
    const c = process.cpuUsage(cpu1);
    out.grabScreenMs = times;
    out.grabScreenCpuMsEach = Math.round((c.user + c.system) / 1000 / 5);
    out.grabScreenRssDeltaMB = Math.round((process.memoryUsage().rss - rss1) / 1048576);
  }
  console.log(JSON.stringify(out));
  app.quit();
});
