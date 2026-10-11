import Foundation
import RiceAPM

/// WebRTC AEC3 sobre o microfone, usando o áudio do sistema como referência.
/// Recebe amostras de 16 kHz mono em blocos de qualquer tamanho e processa em quadros de 10 ms.
/// O render (sistema) e o capture (mic) chegam de threads diferentes; o lock serializa os dois.
final class EchoCanceller {
    static let frameSamples = 160

    private let lock = NSLock()
    private var handle: OpaquePointer?
    private var renderPending: [Int16] = []
    private var capturePending: [Int16] = []
    private var enabled = true
    private var renderWarned = false
    private var captureWarned = false

    init?() {
        guard let handle = rice_apm_create(16_000) else { return nil }
        self.handle = handle
    }

    deinit {
        if let handle { rice_apm_destroy(handle) }
    }

    /// Desligado (ex.: saída em fone), o microfone passa sem alteração.
    func setEnabled(_ value: Bool) {
        lock.withLock {
            enabled = value
            renderPending.removeAll()
        }
    }

    var isEnabled: Bool { lock.withLock { enabled } }

    func pushRender(_ samples: [Int16]) {
        lock.withLock {
            guard enabled, let handle else { return }
            renderPending.append(contentsOf: samples)
            var offset = 0
            while renderPending.count - offset >= Self.frameSamples {
                renderPending.withUnsafeBufferPointer { buffer in
                    let code = rice_apm_process_render(handle, buffer.baseAddress! + offset, Int32(Self.frameSamples))
                    if code != 0 { warnOnce(&renderWarned, code) }
                }
                offset += Self.frameSamples
            }
            if offset > 0 { renderPending.removeFirst(offset) }
        }
    }

    /// Devolve o áudio do mic já processado (múltiplo de 10 ms; o resto fica para a próxima chamada).
    func processCapture(_ samples: [Int16]) -> [Int16] {
        lock.withLock {
            capturePending.append(contentsOf: samples)
            let usable = capturePending.count - capturePending.count % Self.frameSamples
            guard usable > 0 else { return [] }
            var output = Array(capturePending[0..<usable])
            capturePending.removeFirst(usable)
            guard enabled, let handle else { return output }
            var frame = [Int16](repeating: 0, count: Self.frameSamples)
            var offset = 0
            while offset < usable {
                for i in 0..<Self.frameSamples { frame[i] = output[offset + i] }
                let code = frame.withUnsafeMutableBufferPointer { rice_apm_process_capture(handle, $0.baseAddress!, Int32(Self.frameSamples)) }
                if code == 0 {
                    for i in 0..<Self.frameSamples { output[offset + i] = frame[i] }
                } else {
                    warnOnce(&captureWarned, code)
                }
                offset += Self.frameSamples
            }
            return output
        }
    }

    /// Avisa só uma vez por tipo (render/capture); o quadro segue como está.
    private func warnOnce(_ flag: inout Bool, _ code: Int32) {
        guard !flag else { return }
        flag = true
        Events.emit("warning", ["source": "aec", "message": "AEC3 rejeitou um quadro (código \(code))"])
    }

    /// O que sobrou (< 10 ms) no fim da gravação, sem processar.
    func drainCapture() -> [Int16] {
        lock.withLock {
            let rest = capturePending
            capturePending.removeAll()
            return rest
        }
    }
}
