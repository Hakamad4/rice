# Helpers nativos para Windows

`rice-audio.exe` e `rice-detector.exe` falam o **mesmo protocolo** dos helpers Swift do macOS
(ver [`../PROTOCOL.md`](../PROTOCOL.md)); o main do Electron não muda.

```
common/    portátil: JSON, eventos, frames, Chunker, Resampler (sem Win32)
audio/     portátil: Recorder, AEC (wrapper), sinks, selftests, plataforma simulada
audio/win/ Win32: WASAPI (mic por evento, loopback da saída padrão), IMMNotificationClient, PowerRequest
detector/  portátil: AppMatcher, MicWatcher, main
detector/win/ Win32: leitura do consent store do registro
tests/     testes de paridade contra tests/fixtures/protocol (gravados do Swift)
```

Tudo que é Win32 está atrás de `#ifdef _WIN32`. O resto compila no macOS/Linux com `native/win/run-tests.sh`
(clang/g++, sem CMake) e no Windows com CMake + MSVC:

```powershell
cmake -S native/win -B build/win -A x64
cmake --build build/win --config Release
ctest --test-dir build/win -C Release --output-on-failure
```

## Modo simulado

`rice-audio --simulate-capture` (ou `RICE_AUDIO_SIMULATE=1`) troca o hardware por tons sintéticos, mantendo o resto do protocolo.
`rice-detector --fake-mic-steps '[["chrome.exe"],[]]' [--fake-mic-interval-ms 200]` (ou `RICE_DETECTOR_FAKE_MIC_STEPS` /
`RICE_DETECTOR_FAKE_MIC_INTERVAL_MS`) simula os apps usando o mic. É o que o smoke test do CI usa.

## O que foi provado onde

| | macOS (clang) | CI Windows | PC Windows (fase 2) |
| --- | --- | --- | --- |
| JSON, frames, Chunker, Resampler, Recorder, AppMatcher, MicWatcher | testado, comparado com o Swift | idem (MSVC) | – |
| `--selftest-gap` bit a bit; `--selftest-tone` ≤ 1 LSB do Swift | testado | testado | – |
| Protocolo ponta a ponta (cliente TS real + modo simulado) | testado | testado | – |
| Compila com MSVC (WASAPI, registro) | **não** | **prova** | – |
| Captura real do mic/loopback, troca de dispositivo, suspensão, consent store | não | não | **prova** |
| AEC no MSVC | wrapper validado no mac (≈21 dB) | job experimental | prova de qualidade |

## AEC no Windows

O `rice_apm.cpp` e o `webrtc-audio-processing` 2.1 são portáveis em tese (meson suporta MSVC), mas sem uma máquina Windows não dá
para garantir o build, então **o padrão no Windows é sem AEC**: `-DRICE_WITH_AEC=OFF`, o binário emite
`aec {enabled:false, reason:"AEC3 não incluído neste build"}` e `--selftest-aec` imprime `{"error":...}`. Para tentar:
`scripts/build-webrtc-apm.ps1` e depois `cmake ... -DRICE_WITH_AEC=ON -DRICE_WEBRTC_DIR=native/third_party/webrtc-apm-win`.
O job `aec` do workflow faz isso com `continue-on-error`; quando ele ficar verde, a fase 2 liga o AEC por padrão.
Sem AEC, quem usa alto-falante pode ter o eco da call transcrito duas vezes (mic + sys); fone não é afetado.

## Limitações conhecidas

- `--exclude-pid` é aceito e ignorado: o loopback captura a saída inteira. Excluir o Rice exigiria o loopback por processo
  (`ActivateAudioInterfaceAsync`, Windows 10 2004+); fica para a fase 2.
- O loopback abre também um fluxo de silêncio na saída padrão, para o Windows continuar entregando pacotes quando nada toca.
- Permissão de microfone: se "Permitir que aplicativos da área de trabalho acessem o microfone" estiver desligado, o Windows
  entrega silêncio sem erro; o helper lê a chave `ConsentStore\microphone` e avisa com `permissão de microfone negada`.
- Calendário e Lembretes respondem `unsupported` (ver PROTOCOL.md).
