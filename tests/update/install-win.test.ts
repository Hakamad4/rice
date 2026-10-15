import { createHash } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeTmpDir } from '../helpers/tmp';

const script = readFileSync('install-win.ps1', 'utf8');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;

describe('install-win.ps1 (texto do script)', () => {
  it('é só ASCII (o `irm | iex` do PowerShell 5.1 pode ler a codificação errada) e não usa nada exclusivo do PowerShell 7', () => {
    expect([...script].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
    expect(script).not.toMatch(/\?\?|\?\.|&&|\|\||-Parallel|ForEach-Object -Parallel/); // operadores do PowerShell 7
    expect(script).not.toMatch(/^param\(/m); // `iex` recebe só o texto: sem bloco param no topo
  });

  it('usa a API do GitHub da última release, confere o hash do latest.yml e apaga o instalador se não bater', () => {
    expect(script).toContain("$repo = 'WalissonCF/rice'");
    expect(script).toContain('/releases/latest');
    expect(script).toContain('latest.yml');
    expect(script).toContain('SHA512');
    expect(script).toContain('SHA256'); // o digest do GitHub, quando vem
    expect(script).toMatch(/Rice-Setup-\.\*-x64\\\.exe/);
    expect(script.indexOf('ComputeHash')).toBeLessThan(script.indexOf('Start-Process'));
    expect(script).toContain('Remove-Item -Force -ErrorAction SilentlyContinue $file'); // hash errado: nada fica no disco
    expect(script).toContain('Tls12');
  });

  it('mensagens em português e inglês (erros sempre nos dois)', () => {
    expect(script).toContain('function T($p, $e)');
    expect(script).toMatch(/ERRO: .*ERROR: /s);
    expect(script).toContain('\\u00e3o'); // acentos como \uXXXX, desfeitos em tempo de execução
  });

  it('não é o install.ps1 de desenvolvimento (nada de compilar nem de Node/CMake)', () => {
    expect(script).not.toMatch(/cmake|npm ci|Visual Studio/i);
  });
});

/** Roda de verdade quando há `pwsh` (o runner do Windows tem; o Mac do desenvolvedor, em geral, não). */
describe.skipIf(!hasPwsh)('install-win.ps1 (com um GitHub de mentira)', () => {
  async function fakeGithub(opts: { corrupt?: boolean; noYml?: boolean }) {
    const exe = Buffer.from('MZ-fake-installer-' + 'x'.repeat(5000));
    const served = opts.corrupt ? Buffer.from('MZ-tampered-' + 'y'.repeat(5000)) : exe;
    const sha512 = createHash('sha512').update(exe).digest('base64');
    const yml = `version: 0.5.0\nfiles:\n  - url: Rice-Setup-0.5.0-x64.exe\n    sha512: ${sha512}\n    size: ${exe.length}\npath: Rice-Setup-0.5.0-x64.exe\nsha512: ${sha512}\nreleaseDate: '2026-10-14T00:00:00.000Z'\n`;
    let base = '';
    const server = createServer((req, res) => {
      if (req.url === '/releases/latest') {
        const assets = [{ name: 'Rice-Setup-0.5.0-x64.exe', browser_download_url: `${base}/dl/exe`, digest: `sha256:${createHash('sha256').update(exe).digest('hex')}` }, ...(opts.noYml ? [] : [{ name: 'latest.yml', browser_download_url: `${base}/dl/yml` }])];
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ tag_name: 'v0.5.0', assets }));
      }
      if (req.url === '/dl/yml') return res.end(yml);
      if (req.url === '/dl/exe') return res.end(served);
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    return { base, close: () => server.close() };
  }
  const run = async (api: string) => {
    const out = await makeTmpDir();
    // assíncrono: o servidor falso vive neste mesmo processo e precisa responder enquanto o pwsh roda
    const text = await new Promise<string>((ok) => {
      execFile('pwsh', ['-NoProfile', '-File', 'install-win.ps1'], { encoding: 'utf8', env: { ...process.env, RICE_INSTALL_API: api, RICE_INSTALL_NORUN: '1', RICE_INSTALL_OUTDIR: out }, timeout: 60_000 }, (_e, stdout, stderr) => ok(stdout + stderr));
    });
    return { out, text, files: existsSync(out) ? readdirSync(out) : [] };
  };

  it('baixa, confere o hash e deixa o instalador (sem rodar, com -NoRun)', async () => {
    const gh = await fakeGithub({});
    const r = await run(gh.base);
    gh.close();
    expect(r.text).toContain('hash verified');
    expect(r.files).toEqual(['Rice-Setup-0.5.0-x64.exe']);
  });

  it('hash diferente: erro nos dois idiomas, arquivo apagado', async () => {
    const gh = await fakeGithub({ corrupt: true });
    const r = await run(gh.base);
    gh.close();
    expect(r.text).toContain('does NOT match latest.yml');
    expect(r.files).toEqual([]);
  });

  it('release sem latest.yml: não instala nada', async () => {
    const gh = await fakeGithub({ noYml: true });
    const r = await run(gh.base);
    gh.close();
    expect(r.text).toContain('has no latest.yml');
    expect(r.files).toEqual([]);
  });
});
