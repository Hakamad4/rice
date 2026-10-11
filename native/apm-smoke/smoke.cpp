// Smoke test: AEC3 via webrtc-audio-processing 2.x. 100 x 10 ms frames @16k mono int16.
#include <cstdint>
#include <cstdio>
#include <cmath>
#include "api/scoped_refptr.h"
#include "api/audio/audio_processing.h"

int main() {
  webrtc::AudioProcessing::Config cfg;
  cfg.echo_canceller.enabled = true;
  cfg.echo_canceller.mobile_mode = false;
  auto apm = webrtc::AudioProcessingBuilder().SetConfig(cfg).Create();
  if (!apm) { std::puts("create failed"); return 1; }
  apm->SetRuntimeSetting(webrtc::AudioProcessing::RuntimeSetting::CreateCaptureOutputUsedSetting(true));
  webrtc::StreamConfig sc(16000, 1);
  int16_t ref[160], mic[160], out[160], rout[160];
  for (int f = 0; f < 100; ++f) {
    for (int i = 0; i < 160; ++i) {
      ref[i] = (int16_t)(8000 * std::sin(2 * M_PI * 440 * (f * 160 + i) / 16000.0));
      mic[i] = ref[i] / 2;
    }
    apm->set_stream_delay_ms(40);
    if (apm->ProcessReverseStream(ref, sc, sc, rout) != 0) return 2;
    if (apm->ProcessStream(mic, sc, sc, out) != 0) return 3;
  }
  std::puts("apm smoke OK");
  return 0;
}
