// EnumWindows: janelas de topo visíveis, não minimizadas, não "cloaked" (outras áreas de trabalho virtuais, apps UWP suspensos),
// da frente para trás. O retângulo é o da moldura visível (DWM), sem a sombra invisível que o GetWindowRect inclui.
#ifdef _WIN32

#include <windows.h>

#include <dwmapi.h>

#include <cstdint>
#include <string>
#include <vector>

#include "../window_list.hpp"

namespace rice {

namespace {

std::string toUtf8(const wchar_t* w, int length) {
  if (length <= 0) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w, length, nullptr, 0, nullptr, nullptr);
  std::string out(static_cast<size_t>(n), '\0');
  WideCharToMultiByte(CP_UTF8, 0, w, length, out.data(), n, nullptr, nullptr);
  return out;
}

std::string executableOf(DWORD pid) {
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
  if (!process) return {};
  wchar_t path[MAX_PATH * 2];
  DWORD size = static_cast<DWORD>(sizeof(path) / sizeof(path[0]));
  std::string name;
  if (QueryFullProcessImageNameW(process, 0, path, &size)) {
    std::wstring full(path, size);
    size_t cut = full.find_last_of(L"\\/");
    std::wstring base = cut == std::wstring::npos ? full : full.substr(cut + 1);
    name = toUtf8(base.data(), static_cast<int>(base.size()));
  }
  CloseHandle(process);
  return name;
}

BOOL CALLBACK collect(HWND hwnd, LPARAM param) {
  auto* out = reinterpret_cast<std::vector<WindowInfo>*>(param);
  if (!IsWindowVisible(hwnd) || IsIconic(hwnd)) return TRUE;
  LONG_PTR ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
  if ((ex & WS_EX_TOOLWINDOW) && !(ex & WS_EX_APPWINDOW)) return TRUE;
  if (GetWindow(hwnd, GW_OWNER) != nullptr && !(ex & WS_EX_APPWINDOW)) return TRUE;  // diálogos filhos
  DWORD cloaked = 0;
  if (SUCCEEDED(DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &cloaked, sizeof cloaked)) && cloaked != 0) return TRUE;

  RECT rect{};
  if (FAILED(DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &rect, sizeof rect)) && !GetWindowRect(hwnd, &rect)) return TRUE;
  if (rect.right <= rect.left || rect.bottom <= rect.top) return TRUE;

  wchar_t title[512];
  int length = GetWindowTextW(hwnd, title, 512);
  DWORD pid = 0;
  GetWindowThreadProcessId(hwnd, &pid);

  WindowInfo w;
  w.hwnd = static_cast<long long>(reinterpret_cast<intptr_t>(hwnd));
  w.pid = pid;
  w.exe = executableOf(pid);
  w.title = toUtf8(title, length);
  w.x = rect.left;
  w.y = rect.top;
  w.w = rect.right - rect.left;
  w.h = rect.bottom - rect.top;
  HMONITOR monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
  MONITORINFO info{};
  info.cbSize = sizeof info;
  if (monitor && GetMonitorInfoW(monitor, &info)) {
    w.monitor = static_cast<long long>(reinterpret_cast<intptr_t>(monitor));
    w.mx = info.rcMonitor.left;
    w.my = info.rcMonitor.top;
    w.mw = info.rcMonitor.right - info.rcMonitor.left;
    w.mh = info.rcMonitor.bottom - info.rcMonitor.top;
  }
  out->push_back(std::move(w));
  return TRUE;
}

}  // namespace

std::vector<WindowInfo> enumerateWindows() {
  std::vector<WindowInfo> windows;
  EnumWindows(collect, reinterpret_cast<LPARAM>(&windows));
  return windows;
}

void enableDpiAwareness() {
  // Per-monitor v2 (Windows 10 1703+). Resolvido em tempo de execução: o SDK com _WIN32_WINNT=0x0A00 não declara a constante
  // e a função não existe em Windows mais antigos. -4 = DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2. Falha em silêncio.
  using SetContextFn = BOOL(WINAPI*)(HANDLE);
  HMODULE user32 = GetModuleHandleW(L"user32.dll");
  if (!user32) return;
  auto fn = reinterpret_cast<SetContextFn>(reinterpret_cast<void*>(GetProcAddress(user32, "SetProcessDpiAwarenessContext")));
  if (fn) fn(reinterpret_cast<HANDLE>(static_cast<intptr_t>(-4)));
}

}  // namespace rice

#endif  // _WIN32
