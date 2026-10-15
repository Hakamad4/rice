// Lista de janelas visíveis (Windows), para o Rice achar a janela do app da chamada. É resposta a pedido
// (`--list-windows` ou o comando `list-windows`); o protocolo de eventos do detector não muda.
// A parte de filtro e JSON é portátil e testada em qualquer sistema; a enumeração (EnumWindows) é só Win32.
#pragma once

#include <string>
#include <vector>

#include "../common/json.hpp"

namespace rice {

struct WindowInfo {
  long long hwnd = 0;
  unsigned long pid = 0;
  std::string exe;    // nome do executável ("chrome.exe")
  std::string title;  // título da janela (num navegador, o da aba ativa)
  int x = 0, y = 0, w = 0, h = 0;                   // retângulo em pixels físicos da área de trabalho virtual
  long long monitor = 0;                             // HMONITOR da tela que mais contém a janela
  int mx = 0, my = 0, mw = 0, mh = 0;                // retângulo desse monitor
};

struct WindowFilter {
  std::vector<std::string> apps;  // nome do app como o detector emite ("Zoom", "Google Chrome")
  std::vector<std::string> exes;  // nome do .exe, sem diferenciar maiúsculas
  std::vector<unsigned long> pids;
  bool empty() const { return apps.empty() && exes.empty() && pids.empty(); }
};

/// Janelas visíveis, da frente para trás (ordem do EnumWindows). Fora do Windows: vazio.
std::vector<WindowInfo> enumerateWindows();

/// Ajusta o processo para coordenadas físicas por monitor (sem isso o Windows entrega retângulos virtualizados pelo DPI).
void enableDpiAwareness();

/// Mantém só as janelas que casam com algum critério (OU entre critérios; sem critério, todas). Preserva a ordem.
std::vector<WindowInfo> filterWindows(const std::vector<WindowInfo>& windows, const WindowFilter& filter);

/// `owner` = nome do app como o detector emite (matchApp), senão o nome do .exe sem extensão.
std::string windowOwner(const WindowInfo& window);

/// Array JSON no formato lido por `parseWindows` do Rice: id, owner, pid, title, x, y, w, h (+ exe, monitor, mx, my, mw, mh).
json::Value windowsToJson(const std::vector<WindowInfo>& windows);

/// Inverso de windowsToJson (usado pelo modo simulado `--fake-windows`). Ignora o que vier malformado.
std::vector<WindowInfo> windowsFromJson(const json::Value& array);

}  // namespace rice
