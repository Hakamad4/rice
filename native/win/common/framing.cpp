#include "framing.hpp"

namespace rice {

std::vector<uint8_t> encodeFrame(Source source, uint64_t timestampMs, const int16_t* pcm, size_t samples) {
  std::vector<uint8_t> out;
  out.reserve(kFrameHeaderBytes + samples * 2);
  out.push_back(static_cast<uint8_t>(source));
  for (int i = 0; i < 8; i++) out.push_back(static_cast<uint8_t>((timestampMs >> (8 * i)) & 0xFF));
  uint32_t bytes = static_cast<uint32_t>(samples * 2);
  for (int i = 0; i < 4; i++) out.push_back(static_cast<uint8_t>((bytes >> (8 * i)) & 0xFF));
  for (size_t i = 0; i < samples; i++) {
    uint16_t u = static_cast<uint16_t>(pcm[i]);
    out.push_back(static_cast<uint8_t>(u & 0xFF));
    out.push_back(static_cast<uint8_t>(u >> 8));
  }
  return out;
}

std::vector<DecodedFrame> FrameDecoder::push(const uint8_t* data, size_t size) {
  std::vector<DecodedFrame> frames;
  if (failed_) return frames;
  buffer_.insert(buffer_.end(), data, data + size);
  size_t offset = 0;
  while (buffer_.size() - offset >= kFrameHeaderBytes) {
    const uint8_t* p = buffer_.data() + offset;
    if (p[0] != 0x01 && p[0] != 0x02) { failed_ = true; break; }
    uint32_t length = static_cast<uint32_t>(p[9]) | (static_cast<uint32_t>(p[10]) << 8) | (static_cast<uint32_t>(p[11]) << 16) | (static_cast<uint32_t>(p[12]) << 24);
    if (length > kMaxFramePayloadBytes) { failed_ = true; break; }
    if (buffer_.size() - offset < kFrameHeaderBytes + length) break;
    DecodedFrame frame;
    frame.source = static_cast<Source>(p[0]);
    frame.timestampMs = 0;
    for (int i = 0; i < 8; i++) frame.timestampMs |= static_cast<uint64_t>(p[1 + i]) << (8 * i);
    frame.pcm.resize(length / 2);
    for (size_t i = 0; i < frame.pcm.size(); i++) {
      frame.pcm[i] = static_cast<int16_t>(static_cast<uint16_t>(p[kFrameHeaderBytes + 2 * i]) | (static_cast<uint16_t>(p[kFrameHeaderBytes + 2 * i + 1]) << 8));
    }
    frames.push_back(std::move(frame));
    offset += kFrameHeaderBytes + length;
  }
  buffer_.erase(buffer_.begin(), buffer_.begin() + static_cast<std::ptrdiff_t>(offset));
  return frames;
}

}  // namespace rice
