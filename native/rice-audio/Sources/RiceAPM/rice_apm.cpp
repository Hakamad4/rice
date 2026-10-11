#include "rice_apm.h"

#include "api/audio/audio_processing.h"
#include "api/scoped_refptr.h"

struct rice_apm {
  rtc::scoped_refptr<webrtc::AudioProcessing> apm;
  webrtc::StreamConfig config;
  int16_t scratch[480];
};

extern "C" rice_apm *rice_apm_create(int sample_rate_hz) {
  // Só o AEC3: sem supressão de ruído nem AGC do WebRTC, para não
  // alterar a voz que vai para o Whisper.
  webrtc::AudioProcessing::Config cfg;
  cfg.echo_canceller.enabled = true;
  cfg.echo_canceller.mobile_mode = false;
  cfg.high_pass_filter.enabled = true;
  auto apm = webrtc::AudioProcessingBuilder().SetConfig(cfg).Create();
  if (!apm) return nullptr;
  apm->SetRuntimeSetting(webrtc::AudioProcessing::RuntimeSetting::CreateCaptureOutputUsedSetting(true));
  auto *handle = new rice_apm{apm, webrtc::StreamConfig(sample_rate_hz, 1), {}};
  return handle;
}

extern "C" int rice_apm_process_render(rice_apm *apm, const int16_t *frame, int samples) {
  if (!apm || samples != (int)apm->config.num_frames() || samples > 480) return -1;
  return apm->apm->ProcessReverseStream(frame, apm->config, apm->config, apm->scratch);
}

extern "C" int rice_apm_process_capture(rice_apm *apm, int16_t *frame, int samples) {
  if (!apm || samples != (int)apm->config.num_frames()) return -1;
  return apm->apm->ProcessStream(frame, apm->config, apm->config, frame);
}

extern "C" void rice_apm_set_stream_delay_ms(rice_apm *apm, int delay_ms) {
  if (apm) apm->apm->set_stream_delay_ms(delay_ms);
}

extern "C" void rice_apm_destroy(rice_apm *apm) {
  delete apm;
}
