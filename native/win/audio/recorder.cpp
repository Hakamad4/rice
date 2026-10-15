#include "recorder.hpp"

namespace rice {

namespace {
json::Value fields(const char* source, const std::string& message) {
  json::Value f = json::Value::object();
  f.set("source", source).set("message", message);
  return f;
}
}  // namespace

Recorder::Recorder(Platform& platform, FrameSink& sink, LineEmitter& events, RecorderOptions options)
    : platform_(platform),
      sink_(sink),
      events_(events),
      options_(std::move(options)),
      aec_(options_.echoCancellation ? EchoCanceller::create(events) : nullptr),
      micChunker_(Source::Mic, sink, events),
      sysChunker_(Source::Sys, sink, events) {}

Recorder::~Recorder() {
  platform_.setMicDeviceListener(nullptr);  // o listener captura `this`
  for (auto& t : workers_) {
    if (t.joinable()) t.join();
  }
}

uint64_t Recorder::elapsedMs() const {
  return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - startTime_).count());
}

void Recorder::error(const char* source, const std::string& message, bool fatal) {
  json::Value f = fields(source, message);
  if (fatal) f.set("fatal", true);
  events_.emit("error", std::move(f));
}

void Recorder::start() {
  std::lock_guard<std::mutex> op(opMutex_);
  {
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (running_ || stopRequested_.load()) return;
    running_ = true;
    startTime_ = std::chrono::steady_clock::now();
  }

  std::string warning;
  sleepBlocked_ = platform_.preventSleep(warning);
  if (!sleepBlocked_) events_.emit("warning", fields("power", warning));
  configureEchoCancellation();
  bool micOk = startMic();
  if (stopRequested()) {
    if (mic_) mic_->stop();
    endDeviceWork();
    return;
  }
  bool sysOk = startSystem();
  if (stopRequested()) {
    if (mic_) mic_->stop();
    if (system_) system_->stop();
    endDeviceWork();
    return;
  }
  json::Value f = json::Value::object();
  f.set("mic", micOk).set("sys", sysOk);
  events_.emit("started", std::move(f));
}

void Recorder::stop() {
  bool wasRunning;
  {
    std::lock_guard<std::mutex> lock(stateMutex_);
    wasRunning = running_;
    running_ = false;
    stopRequested_ = true;
  }
  if (!wasRunning) return;
  std::lock_guard<std::mutex> op(opMutex_);
  if (mic_) mic_->stop();
  if (system_) system_->stop();
  endDeviceWork();
  if (aec_) {
    std::vector<int16_t> rest = aec_->drainCapture();
    if (!rest.empty()) micChunker_.append(rest, elapsedMs());
  }
  micChunker_.flush();
  sysChunker_.flush();
  events_.emit("stopped");
}

void Recorder::onMicBlock(const float* data, size_t frames, int channels, int rate) {
  std::vector<int16_t> samples;
  {
    std::lock_guard<std::mutex> lock(micResamplerMutex_);
    samples = micResampler_.convert(data, frames, channels, rate);
  }
  if (samples.empty()) return;
  std::vector<int16_t> cleaned = aec_ ? aec_->processCapture(samples) : samples;
  if (!cleaned.empty()) micChunker_.append(cleaned, elapsedMs());
}

void Recorder::onSystemBlock(const float* data, size_t frames, int channels, int rate) {
  std::vector<int16_t> samples;
  {
    std::lock_guard<std::mutex> lock(sysResamplerMutex_);
    samples = sysResampler_.convert(data, frames, channels, rate);
  }
  if (samples.empty()) return;
  if (aec_) aec_->pushRender(samples);
  sysChunker_.append(samples, elapsedMs());
}

bool Recorder::startMic() {
  platform_.setPreferredInput(options_.micDevice);
  platform_.setMicDeviceListener([this](const MicDeviceInfo& info) { events_.emit("mic-device", micDeviceFields(info)); });
  std::string message;
  CaptureFailure failure = CaptureFailure::None;
  auto capture = platform_.startMic(
      [this](const float* d, size_t n, int c, int r) { onMicBlock(d, n, c, r); },
      [this] { events_.emit("device-changed"); },
      [this](std::string m) { error("mic", "mic restart failed: " + m, true); },
      message, failure);
  if (!capture) {
    error("mic", failure == CaptureFailure::PermissionDenied ? "permissão de microfone negada" : message, false);
    return false;
  }
  mic_ = std::move(capture);
  return true;
}

void Recorder::configureEchoCancellation() {
  auto off = [&](const std::string& reason) {
    json::Value f = json::Value::object();
    f.set("enabled", false).set("reason", reason);
    events_.emit("aec", std::move(f));
  };
  if (!options_.echoCancellation) return off("desligado por --no-aec");
  if (!aec_) return off(EchoCanceller::compiledIn() ? "falha ao iniciar o WebRTC AEC3" : "AEC3 não incluído neste build");
  auto apply = [this] {
    OutputInfo output = platform_.currentOutput();
    aec_->setEnabled(!output.isHeadphones);
    json::Value f = json::Value::object();
    f.set("enabled", !output.isHeadphones).set("reason", output.reason);
    events_.emit("aec", std::move(f));
  };
  apply();
  if (!cancelOutputObserver_) cancelOutputObserver_ = platform_.observeOutput(apply);
}

void Recorder::endDeviceWork() {
  if (cancelOutputObserver_) {
    cancelOutputObserver_();
    cancelOutputObserver_ = nullptr;
  }
  if (sleepBlocked_) {
    platform_.allowSleep();
    sleepBlocked_ = false;
  }
}

std::unique_ptr<CaptureHandle> Recorder::openSystem(std::string& error) {
  return platform_.startSystem(
      [this](const float* d, size_t n, int c, int r) { onSystemBlock(d, n, c, r); },
      [this](std::string m) { handleSystemStopped(m); },
      options_.excludePids, error);
}

bool Recorder::startSystem() {
  std::string message;
  auto capture = openSystem(message);
  if (!capture) {
    error("sys", message, false);
    return false;
  }
  system_ = std::move(capture);
  return true;
}

void Recorder::handleSystemStopped(const std::string& message) {
  {
    std::lock_guard<std::mutex> lock(stateMutex_);
    if (!running_ || stopRequested_.load() || systemRestarted_) {
      if (!stopRequested_.load()) error("sys", "captura do sistema parou: " + message, true);
      return;
    }
    systemRestarted_ = true;
  }
  error("sys", "captura do sistema parou, reiniciando: " + message, false);
  // Fora da thread de captura: ela pode ser a que está chamando isto.
  std::lock_guard<std::mutex> lock(stateMutex_);
  workers_.emplace_back([this] {
    std::this_thread::sleep_for(options_.systemRetryDelay);
    if (stopRequested()) return;
    std::lock_guard<std::mutex> op(opMutex_);
    if (stopRequested()) return;
    std::string err;
    auto capture = openSystem(err);
    if (!capture) {
      error("sys", "falha ao reiniciar a captura do sistema: " + err, true);
      return;
    }
    if (system_) system_->stop();
    system_ = std::move(capture);
  });
}

}  // namespace rice
