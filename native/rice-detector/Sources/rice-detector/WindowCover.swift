import CoreGraphics
import Foundation

/// Quanto da janela do Rice está coberta por outras janelas (para pausar os parciais do whisper quando ninguém os vê).
/// Só lê a lista de janelas na tela (`CGWindowListCopyWindowInfo`: ordem de empilhamento, camada, alfa e retângulo); não
/// pede Gravação de Tela, não lê títulos nem conteúdo.
enum WindowCover {
    struct Item {
        let number: Int
        let layer: Int
        let alpha: Double
        let rect: CGRect
    }

    /// Janelas de camada > 0 (PiP, sempre no topo, menus) e translúcidas (alfa < 0,99) não escondem o texto: não contam.
    static let minimumAlpha = 0.99

    /// Fração (0…1) da área de `target` coberta pela UNIÃO dos retângulos (sobreposições contam uma vez).
    static func coveredFraction(target: CGRect, covering: [CGRect]) -> Double {
        let area = Double(target.width * target.height)
        guard area > 0 else { return 0 }
        let clipped = covering.map { $0.intersection(target) }.filter { !$0.isNull && $0.width > 0 && $0.height > 0 }
        if clipped.isEmpty { return 0 }
        let xs = Array(Set(clipped.flatMap { [$0.minX, $0.maxX] })).sorted()
        var covered = 0.0
        for i in 0..<(xs.count - 1) {
            let x0 = xs[i], x1 = xs[i + 1]
            let spans = clipped.filter { $0.minX <= x0 && $0.maxX >= x1 }.map { ($0.minY, $0.maxY) }.sorted { $0.0 < $1.0 }
            var length = 0.0
            var low = 0.0, high = 0.0, open = false
            for (a, b) in spans {
                if !open { low = a; high = b; open = true }
                else if a <= high { high = max(high, b) }
                else { length += high - low; low = a; high = b }
            }
            if open { length += high - low }
            covered += length * Double(x1 - x0)
        }
        return min(1, covered / area)
    }

    /// `items` da frente para trás (como o CoreGraphics devolve). Fora da lista = janela minimizada, oculta ou em outro Space.
    static func evaluate(window number: Int, items: [Item]) -> (onScreen: Bool, covered: Double) {
        guard let index = items.firstIndex(where: { $0.number == number }) else { return (false, 1) }
        let infront = items[..<index].filter { $0.layer == 0 && $0.alpha >= minimumAlpha && $0.rect.width > 1 && $0.rect.height > 1 }.map(\.rect)
        return (true, coveredFraction(target: items[index].rect, covering: infront))
    }

    static func onScreenItems() -> [Item] {
        let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
        guard let raw = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] else { return [] }
        return raw.compactMap { entry in
            guard let bounds = entry[kCGWindowBounds as String] as? [String: CGFloat], let number = entry[kCGWindowNumber as String] as? Int else { return nil }
            return Item(
                number: number,
                layer: entry[kCGWindowLayer as String] as? Int ?? 0,
                alpha: entry[kCGWindowAlpha as String] as? Double ?? 1,
                rect: CGRect(x: bounds["X"] ?? 0, y: bounds["Y"] ?? 0, width: bounds["Width"] ?? 0, height: bounds["Height"] ?? 0)
            )
        }
    }
}

/// 1 Hz enquanto o Rice pede (`cover-watch`): emite `window-cover` com a fração coberta. Parado, não gasta nada.
final class CoverWatcher {
    private var timer: Timer?
    private var window = 0

    func watch(window number: Int) {
        timer?.invalidate()
        timer = nil
        window = number
        guard number > 0 else { return }
        tick()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
    }

    private func tick() {
        let result = WindowCover.evaluate(window: window, items: WindowCover.onScreenItems())
        Output.emit("window-cover", ["window": window, "onScreen": result.onScreen, "covered": (result.covered * 1000).rounded() / 1000])
    }
}
