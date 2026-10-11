#include "app_matcher.hpp"

#include <algorithm>
#include <cctype>
#include <vector>

namespace rice {

namespace {

struct AppEntry {
  const char* name;
  std::vector<const char*> bundles;     // macOS (diferencia maiúsculas)
  std::vector<const char*> executables;  // Windows: nome do .exe, minúsculo
  std::vector<const char*> packages;     // Windows: prefixo do nome de família do pacote, minúsculo
};

// Ordem = ordem do AppMatcher.swift (o primeiro que casa vence).
const std::vector<AppEntry>& apps() {
  static const std::vector<AppEntry> list = {
      {"Zoom", {"us.zoom.xos"}, {"zoom.exe"}, {"zoomvideocommunications."}},
      {"Microsoft Teams", {"com.microsoft.teams", "com.microsoft.teams2"}, {"ms-teams.exe", "teams.exe"}, {"msteams_"}},
      {"Google Chrome", {"com.google.Chrome"}, {"chrome.exe"}, {}},
      {"Arc", {"company.thebrowser.Browser"}, {"arc.exe"}, {"thebrowsercompany.arc"}},
      {"Safari", {"com.apple.Safari", "com.apple.WebKit"}, {}, {}},
      {"Firefox", {"org.mozilla.firefox"}, {"firefox.exe"}, {}},
      {"Microsoft Edge", {"com.microsoft.edgemac"}, {"msedge.exe"}, {}},
      {"Brave", {"com.brave.Browser"}, {"brave.exe"}, {}},
      {"Slack", {"com.tinyspeck.slackmacgap"}, {"slack.exe"}, {"com.tinyspeck.slackdesktop"}},
      {"FaceTime", {"com.apple.FaceTime", "com.apple.avconferenced"}, {}, {}},
      {"Discord", {"com.hnc.Discord"}, {"discord.exe"}, {}},
      {"Webex", {"com.cisco.webexmeetingsapp", "Cisco-Systems.Spark"}, {"webex.exe", "ciscocollabhost.exe", "atmgr.exe", "webexhost.exe"}, {"ciscospark."}},
  };
  return list;
}

std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  return s;
}

bool startsWith(const std::string& s, const std::string& prefix) { return s.compare(0, prefix.size(), prefix) == 0; }

}  // namespace

std::optional<std::string> matchApp(const std::string& identifier) {
  if (identifier.empty()) return std::nullopt;
  const std::string lowered = lower(identifier);
  for (const AppEntry& app : apps()) {
    for (const char* bundle : app.bundles) {
      std::string b = bundle;
      if (identifier == b || startsWith(identifier, b + ".")) return std::string(app.name);
    }
    for (const char* exe : app.executables) {
      if (lowered == exe) return std::string(app.name);
    }
    for (const char* pkg : app.packages) {
      if (startsWith(lowered, pkg)) return std::string(app.name);
    }
  }
  return std::nullopt;
}

}  // namespace rice
