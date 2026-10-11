#include "output_classify.hpp"

#include <algorithm>
#include <cctype>

namespace rice {

OutputInfo classifyOutput(const std::string& name, int formFactor, bool bluetooth) {
  OutputInfo info;
  info.name = name.empty() ? "?" : name;
  if (bluetooth) {
    info.isHeadphones = true;
    info.reason = "saída Bluetooth (" + info.name + ")";
    return info;
  }
  if (formFactor == static_cast<int>(EndpointForm::Headphones) || formFactor == static_cast<int>(EndpointForm::Headset) || formFactor == static_cast<int>(EndpointForm::Handset)) {
    info.isHeadphones = true;
    info.reason = "fone com fio (" + info.name + ")";
    return info;
  }
  std::string lower = info.name;
  std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  for (const char* word : {"airpods", "headphone", "headset", "fone", "earpods", "buds", "earphone", "auricular", "hands-free", "handsfree", "hands free"}) {
    if (lower.find(word) != std::string::npos) {
      info.isHeadphones = true;
      info.reason = "fone (" + info.name + ")";
      return info;
    }
  }
  info.reason = "alto-falante (" + info.name + ")";
  return info;
}

}  // namespace rice
