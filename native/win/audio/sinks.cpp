#include "sinks.hpp"

#include <filesystem>
#include <stdexcept>

namespace rice {

StdoutFrameSink::StdoutFrameSink(std::FILE* out, LineEmitter& events) : out_(out), events_(events), thread_([this] { run(); }) {}

StdoutFrameSink::~StdoutFrameSink() {
  {
    std::lock_guard<std::mutex> lock(mutex_);
    stop_ = true;
  }
  wake_.notify_all();
  thread_.join();
}

void StdoutFrameSink::write(Source source, uint64_t timestampMs, const int16_t* pcm, size_t samples) {
  std::vector<uint8_t> frame = encodeFrame(source, timestampMs, pcm, samples);
  bool report = false;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (pendingBytes_ + frame.size() > kMaxPendingBytes) {
      report = !backpressured_;
      backpressured_ = true;
    } else {
      pendingBytes_ += frame.size();
      queue_.push_back(std::move(frame));
    }
  }
  if (report) {
    json::Value f = json::Value::object();
    f.set("source", "cli").set("message", "stdout backpressure");
    events_.emit("error", std::move(f));
    return;
  }
  wake_.notify_one();
}

void StdoutFrameSink::drain() {
  std::unique_lock<std::mutex> lock(mutex_);
  idle_.wait(lock, [this] { return (queue_.empty() && !writing_) || broken_; });
}

void StdoutFrameSink::run() {
  std::unique_lock<std::mutex> lock(mutex_);
  for (;;) {
    wake_.wait(lock, [this] { return stop_ || !queue_.empty(); });
    if (queue_.empty()) {
      if (stop_) return;
      continue;
    }
    std::vector<uint8_t> frame = std::move(queue_.front());
    queue_.pop_front();
    writing_ = true;
    lock.unlock();
    bool ok = std::fwrite(frame.data(), 1, frame.size(), out_) == frame.size() && std::fflush(out_) == 0;
    lock.lock();
    writing_ = false;
    pendingBytes_ -= frame.size();
    if (pendingBytes_ < kMaxPendingBytes) backpressured_ = false;
    if (!ok) {  // pipe fechado: o pai foi embora; descarta o resto
      broken_ = true;
      queue_.clear();
      pendingBytes_ = 0;
    }
    if (queue_.empty()) idle_.notify_all();
  }
}

FileFrameSink::FileFrameSink(const std::string& directory) {
  std::error_code ec;
  std::filesystem::create_directories(directory, ec);
  if (ec) throw std::runtime_error("não foi possível criar " + directory);
  auto open = [&](const char* name) {
    std::filesystem::path path = std::filesystem::path(directory) / name;
    std::FILE* f = std::fopen(path.string().c_str(), "wb");
    if (!f) throw std::runtime_error("não foi possível abrir " + path.string());
    return f;
  };
  mic_ = open("mic.pcm");
  sys_ = open("sys.pcm");
}

FileFrameSink::~FileFrameSink() {
  if (mic_) std::fclose(mic_);
  if (sys_) std::fclose(sys_);
}

void FileFrameSink::write(Source source, uint64_t, const int16_t* pcm, size_t samples) {
  std::lock_guard<std::mutex> lock(mutex_);
  std::FILE* f = source == Source::Mic ? mic_ : sys_;
  for (size_t i = 0; i < samples; i++) {
    uint8_t b[2] = {static_cast<uint8_t>(static_cast<uint16_t>(pcm[i]) & 0xFF), static_cast<uint8_t>(static_cast<uint16_t>(pcm[i]) >> 8)};
    std::fwrite(b, 1, 2, f);
  }
  std::fflush(f);
}

void MemoryFrameSink::write(Source source, uint64_t timestampMs, const int16_t* pcm, size_t samples) {
  std::lock_guard<std::mutex> lock(mutex_);
  entries_.push_back({source, timestampMs, std::vector<int16_t>(pcm, pcm + samples)});
}

std::vector<MemoryFrameSink::Entry> MemoryFrameSink::entries() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return entries_;
}

}  // namespace rice
