#include "echo_canceller.hpp"

#ifdef RICE_HAS_AEC
#include "rice_apm.h"
#endif

namespace rice {

std::unique_ptr<EchoCanceller> EchoCanceller::create(LineEmitter& events) {
#ifdef RICE_HAS_AEC
  rice_apm* handle = rice_apm_create(16000);
  if (!handle) return nullptr;
  return std::unique_ptr<EchoCanceller>(new EchoCanceller(events, handle));
#else
  (void)events;
  return nullptr;
#endif
}

EchoCanceller::~EchoCanceller() {
#ifdef RICE_HAS_AEC
  if (handle_) rice_apm_destroy(handle_);
#endif
}

void EchoCanceller::setEnabled(bool value) {
  std::lock_guard<std::mutex> lock(mutex_);
  enabled_ = value;
  renderPending_.clear();
}

bool EchoCanceller::isEnabled() {
  std::lock_guard<std::mutex> lock(mutex_);
  return enabled_;
}

void EchoCanceller::warnOnce(bool& flag, int code) {
  if (flag) return;
  flag = true;
  json::Value f = json::Value::object();
  f.set("source", "aec").set("message", "AEC3 rejeitou um quadro (código " + std::to_string(code) + ")");
  events_.emit("warning", std::move(f));
}

void EchoCanceller::pushRender(const std::vector<int16_t>& samples) {
#ifdef RICE_HAS_AEC
  std::lock_guard<std::mutex> lock(mutex_);
  if (!enabled_ || !handle_) return;
  renderPending_.insert(renderPending_.end(), samples.begin(), samples.end());
  size_t offset = 0;
  while (renderPending_.size() - offset >= kFrameSamples) {
    int code = rice_apm_process_render(handle_, renderPending_.data() + offset, static_cast<int>(kFrameSamples));
    if (code != 0) warnOnce(renderWarned_, code);
    offset += kFrameSamples;
  }
  if (offset > 0) renderPending_.erase(renderPending_.begin(), renderPending_.begin() + static_cast<std::ptrdiff_t>(offset));
#else
  (void)samples;
#endif
}

std::vector<int16_t> EchoCanceller::processCapture(const std::vector<int16_t>& samples) {
  std::lock_guard<std::mutex> lock(mutex_);
  capturePending_.insert(capturePending_.end(), samples.begin(), samples.end());
  size_t usable = capturePending_.size() - capturePending_.size() % kFrameSamples;
  if (usable == 0) return {};
  std::vector<int16_t> output(capturePending_.begin(), capturePending_.begin() + static_cast<std::ptrdiff_t>(usable));
  capturePending_.erase(capturePending_.begin(), capturePending_.begin() + static_cast<std::ptrdiff_t>(usable));
#ifdef RICE_HAS_AEC
  if (!enabled_ || !handle_) return output;
  int16_t frame[kFrameSamples];
  for (size_t offset = 0; offset < usable; offset += kFrameSamples) {
    for (size_t i = 0; i < kFrameSamples; i++) frame[i] = output[offset + i];
    int code = rice_apm_process_capture(handle_, frame, static_cast<int>(kFrameSamples));
    if (code == 0) {
      for (size_t i = 0; i < kFrameSamples; i++) output[offset + i] = frame[i];
    } else {
      warnOnce(captureWarned_, code);
    }
  }
#endif
  return output;
}

std::vector<int16_t> EchoCanceller::drainCapture() {
  std::lock_guard<std::mutex> lock(mutex_);
  std::vector<int16_t> rest = std::move(capturePending_);
  capturePending_.clear();
  return rest;
}

}  // namespace rice
