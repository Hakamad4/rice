#include "mic_monitor.hpp"

namespace rice {

std::string executableFromConsentKey(const std::string& keyName) {
  size_t cut = keyName.find_last_of("#\\/");
  return cut == std::string::npos ? keyName : keyName.substr(cut + 1);
}

#ifndef _WIN32
std::vector<std::string> identifiersUsingMic() { return {}; }
#endif

}  // namespace rice
