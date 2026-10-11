#include "chunker.hpp"

namespace rice {

void Chunker::append(const std::vector<int16_t>& samples, uint64_t nowMs) {
  if (samples.empty()) return;
  uint64_t gapMs = 0;
  std::vector<Frame> frames;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    uint64_t durationMs = samples.size() / 16;
    if (!hasStart_) {
      hasStart_ = true;
      startOffsetMs_ = nowMs >= durationMs ? nowMs - durationMs : 0;
    }
    uint64_t expectedEndMs = startOffsetMs_ + (emittedSamples_ + pending_.size()) / 16;
    uint64_t expectedNewEndMs = expectedEndMs + durationMs;
    if (nowMs > expectedNewEndMs + kGapThresholdMs) {
      gapMs = nowMs - expectedNewEndMs;
      pending_.insert(pending_.end(), static_cast<size_t>(gapMs) * 16, 0);
    }
    pending_.insert(pending_.end(), samples.begin(), samples.end());
    frames = drainFrames();
  }
  if (gapMs > 0) {
    json::Value fields = json::Value::object();
    fields.set("source", sourceName(source_)).set("ms", gapMs);
    events_.emit("gap", std::move(fields));
  }
  write(frames);
}

void Chunker::flush() {
  std::vector<Frame> frames;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (pending_.empty()) return;
    frames.push_back(makeFrame(pending_.data(), pending_.size()));
    pending_.clear();
  }
  write(frames);
}

std::vector<Chunker::Frame> Chunker::drainFrames() {
  std::vector<Frame> frames;
  size_t offset = 0;
  while (pending_.size() - offset >= kSamplesPerFrame) {
    frames.push_back(makeFrame(pending_.data() + offset, kSamplesPerFrame));
    offset += kSamplesPerFrame;
  }
  if (offset > 0) pending_.erase(pending_.begin(), pending_.begin() + static_cast<std::ptrdiff_t>(offset));
  return frames;
}

Chunker::Frame Chunker::makeFrame(const int16_t* samples, size_t count) {
  Frame frame;
  frame.timestampMs = (hasStart_ ? startOffsetMs_ : 0) + emittedSamples_ / 16;
  frame.pcm.assign(samples, samples + count);
  emittedSamples_ += count;
  return frame;
}

void Chunker::write(const std::vector<Frame>& frames) {
  for (const Frame& f : frames) sink_.write(source_, f.timestampMs, f.pcm.data(), f.pcm.size());
}

}  // namespace rice
