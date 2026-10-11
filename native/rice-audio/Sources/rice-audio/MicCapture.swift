import AVFoundation

final class MicCapture {
    private var engine = AVAudioEngine()
    private let resampler = Resampler()
    private let onSamples: ([Int16]) -> Void
    private let onDeviceChanged: () -> Void
    private var observer: NSObjectProtocol?

    /// Captura simples do microfone (HAL, sem o voice processing da Apple): o eco é
    /// removido depois pelo `EchoCanceller` (AEC3).
    init(onSamples: @escaping ([Int16]) -> Void, onDeviceChanged: @escaping () -> Void) {
        self.onSamples = onSamples
        self.onDeviceChanged = onDeviceChanged
    }

    func start() throws {
        do {
            let input = engine.inputNode
            _ = engine.mainMixerNode // garante um grafo válido para o engine iniciar
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
                guard let self else { return }
                let samples = self.resampler.convert(buffer)
                if !samples.isEmpty { self.onSamples(samples) }
            }
            observer = NotificationCenter.default.addObserver(
                forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main
            ) { [weak self] _ in
                self?.restartAfterDeviceChange()
            }
            engine.prepare()
            try engine.start()
        } catch {
            stop()
            throw error
        }
    }

    func stop() {
        if let observer { NotificationCenter.default.removeObserver(observer) }
        observer = nil
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
    }

    private func restartAfterDeviceChange() {
        stop()
        var lastError: Error?
        for attempt in 1...3 {
            engine = AVAudioEngine()
            do {
                try start()
                onDeviceChanged()
                return
            } catch {
                lastError = error
                if attempt < 3 {
                    Thread.sleep(forTimeInterval: 0.5)
                }
            }
        }
        let message = "mic restart failed: \(lastError?.localizedDescription ?? "unknown error")"
        Events.emit("error", ["source": "mic", "message": message, "fatal": true])
    }
}
