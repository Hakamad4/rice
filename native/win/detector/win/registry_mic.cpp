// Lê o consent store do microfone: HKCU\...\CapabilityAccessManager\ConsentStore\microphone.
// Cada app que já usou o mic tem uma subchave (empacotados direto; os demais em NonPackaged, com "#" no lugar de "\")
// com LastUsedTimeStart/LastUsedTimeStop (FILETIME, REG_QWORD). Em uso = Start > Stop (Stop zerado enquanto grava).
#ifdef _WIN32

#include <windows.h>

#include <string>
#include <vector>

#include "../mic_monitor.hpp"

namespace rice {

namespace {

constexpr const wchar_t* kConsentPath = L"Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone";

std::string toUtf8(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), nullptr, 0, nullptr, nullptr);
  std::string out(static_cast<size_t>(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), static_cast<int>(w.size()), out.data(), n, nullptr, nullptr);
  return out;
}

bool readQword(HKEY key, const wchar_t* name, unsigned long long& out) {
  DWORD type = 0, size = sizeof(out);
  out = 0;
  LONG rc = RegQueryValueExW(key, name, nullptr, &type, reinterpret_cast<LPBYTE>(&out), &size);
  return rc == ERROR_SUCCESS && type == REG_QWORD;
}

/// Subchaves de `parent`, com o nome de cada uma e se está em uso.
void scan(HKEY parent, bool nonPackaged, std::vector<std::string>& active) {
  for (DWORD index = 0;; index++) {
    wchar_t name[512];
    DWORD length = 512;
    LONG rc = RegEnumKeyExW(parent, index, name, &length, nullptr, nullptr, nullptr, nullptr);
    if (rc == ERROR_NO_MORE_ITEMS) break;
    if (rc != ERROR_SUCCESS) continue;
    std::wstring wname(name, length);
    if (!nonPackaged && wname == L"NonPackaged") continue;
    HKEY app = nullptr;
    if (RegOpenKeyExW(parent, wname.c_str(), 0, KEY_READ, &app) != ERROR_SUCCESS) continue;
    unsigned long long start = 0, stop = 0;
    bool haveStart = readQword(app, L"LastUsedTimeStart", start);
    readQword(app, L"LastUsedTimeStop", stop);
    RegCloseKey(app);
    if (haveStart && start > 0 && start > stop) {
      std::string id = toUtf8(wname);
      active.push_back(nonPackaged ? executableFromConsentKey(id) : id);
    }
  }
}

}  // namespace

std::vector<std::string> identifiersUsingMic() {
  std::vector<std::string> active;
  HKEY root = nullptr;
  if (RegOpenKeyExW(HKEY_CURRENT_USER, kConsentPath, 0, KEY_READ, &root) != ERROR_SUCCESS) return active;
  scan(root, false, active);
  HKEY nonPackaged = nullptr;
  if (RegOpenKeyExW(root, L"NonPackaged", 0, KEY_READ, &nonPackaged) == ERROR_SUCCESS) {
    scan(nonPackaged, true, active);
    RegCloseKey(nonPackaged);
  }
  RegCloseKey(root);
  return active;
}

}  // namespace rice

#endif  // _WIN32
