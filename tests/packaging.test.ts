import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

describe('empacotamento (dmg/zip arm64)', () => {
  test('npm run dist: compila o nativo, copia para native-bin, gera o bundle e empacota', () => {
    expect(pkg.scripts.dist).toBe('scripts/build-native.sh && scripts/stage-native.sh && npm run build:app && electron-builder --mac --arm64');
    expect(pkg.devDependencies['electron-builder']).toBeTruthy();
  });
  test('alvos dmg e zip só arm64, assinatura ad hoc ("-") sem notarização, nome Rice-<versão>-arm64', () => {
    const b = pkg.build;
    expect(b.mac.target).toEqual([{ target: 'dmg', arch: ['arm64'] }, { target: 'zip', arch: ['arm64'] }]);
    expect(b.mac.identity).toBe('-');
    expect(b.artifactName).toBe('Rice-${version}-${arch}.${ext}');
    expect(b.directories.output).toBe('dist');
  });
  test('inclui out, renderer, ícones, modelo do VAD, binários nativos e node_modules, sem as plataformas que não são do Mac arm64', () => {
    const files: string[] = pkg.build.files;
    for (const f of ['out/**', 'src/renderer/**', 'resources/models/**', 'native-bin/**', 'node_modules/**']) expect(files).toContain(f);
    expect(files.some((f) => f.includes('onnxruntime-node/bin/napi-v6/linux'))).toBe(true); // excluído
    expect(files.some((f) => f.startsWith('!node_modules/better-sqlite3/prebuilds'))).toBe(true);
    expect(pkg.build.asar).toBe(false); // os binários nativos precisam existir como arquivos para serem executados
  });
  test('Info.plist: descrições de microfone, áudio do sistema, Calendário e Lembretes (pt/en)', () => {
    const info = pkg.build.mac.extendInfo;
    for (const k of ['NSMicrophoneUsageDescription', 'NSAudioCaptureUsageDescription', 'NSCalendarsFullAccessUsageDescription', 'NSRemindersFullAccessUsageDescription']) expect(info[k]).toMatch(/ \/ /);
    expect(pkg.build.mac.minimumSystemVersion).toBe('14.2');
  });
  test('entitlements para captura de áudio e agenda', () => {
    const plist = readFileSync('build/entitlements.mac.plist', 'utf8');
    for (const k of ['com.apple.security.device.audio-input', 'com.apple.security.personal-information.calendars']) expect(plist).toContain(k);
    expect(pkg.build.mac.entitlements).toBe('build/entitlements.mac.plist');
  });
  test('dist/ e native-bin/ fora do git', () => {
    const ignore = readFileSync('.gitignore', 'utf8').split('\n');
    expect(ignore).toContain('dist/');
    expect(ignore).toContain('native-bin/');
  });
});

describe('install.sh', () => {
  test('é executável, tem sintaxe válida e o --check roda sem instalar nada', () => {
    expect(statSync('install.sh').mode & 0o111).not.toBe(0);
    execFileSync('bash', ['-n', 'install.sh']);
    const text = readFileSync('install.sh', 'utf8');
    expect(text).toContain('set -euo pipefail');
    expect(text).not.toMatch(/\bsudo\b(?!\))/); // sem sudo (só aparece em comentário/mensagem, nunca como comando)
    for (const f of ['whisper.cpp', 'meson', 'ninja', 'pkg-config']) expect(text).toContain(f);
    expect(text).toContain('xattr -dr com.apple.quarantine');
    expect(text).toContain('ERRO:'); // mensagens de erro em pt e en
    expect(text).toContain('ERROR:');
  });
  test('o app empacotado acha os nativos: paths.ts usa native/ no repositório e native-bin/ no app', () => {
    const paths = readFileSync('src/main/app/paths.ts', 'utf8');
    expect(paths).toContain("existsSync(join(dir, 'native-bin'))");
    expect(paths).toContain("join(repoRoot(), 'native-bin', name)");
    expect(existsSync('scripts/stage-native.sh')).toBe(true);
  });
});
