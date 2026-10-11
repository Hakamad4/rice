import Foundation

/// Junta amostras em frames de 100 ms. O timestamp é contado por amostras a partir
/// do primeiro buffer, então é monotônico e sem lacunas dentro de uma fonte. Se o relógio
/// real adiantar mais de 200 ms em relação às amostras recebidas (captura travada, sleep),
/// insere silêncio para manter o áudio alinhado com o tempo real.
final class Chunker {
    static let samplesPerFrame = 1600
    static let gapThresholdMs: UInt64 = 200

    private struct Frame {
        let timestampMs: UInt64
        let pcm: Data
    }

    private let source: AudioSource
    private let sink: FrameSink
    private let lock = NSLock()
    private var pending: [Int16] = []
    private var startOffsetMs: UInt64?
    private var emittedSamples: UInt64 = 0

    init(source: AudioSource, sink: FrameSink) {
        self.source = source
        self.sink = sink
    }

    /// `nowMs` é o instante (ms desde o início da gravação) em que `samples` chegou,
    /// isto é, o fim real dessas amostras.
    func append(_ samples: [Int16], nowMs: UInt64) {
        guard !samples.isEmpty else { return }
        var gapMs: UInt64 = 0
        let frames: [Frame] = lock.withLock {
            let durationMs = UInt64(samples.count) / 16
            if startOffsetMs == nil { startOffsetMs = nowMs >= durationMs ? nowMs - durationMs : 0 }
            let expectedEndMs = startOffsetMs! + (emittedSamples + UInt64(pending.count)) / 16
            let expectedNewEndMs = expectedEndMs + durationMs
            if nowMs > expectedNewEndMs + Self.gapThresholdMs {
                gapMs = nowMs - expectedNewEndMs
                pending.append(contentsOf: [Int16](repeating: 0, count: Int(gapMs) * 16))
            }
            pending.append(contentsOf: samples)
            return drainFrames()
        }
        if gapMs > 0 { Events.emit("gap", ["source": source.name, "ms": gapMs]) }
        write(frames)
    }

    func flush() {
        let frames: [Frame] = lock.withLock {
            guard !pending.isEmpty else { return [] }
            let frame = makeFrame(pending)
            pending.removeAll()
            return [frame]
        }
        write(frames)
    }

    // Chamado com o lock tomado.
    private func drainFrames() -> [Frame] {
        var frames: [Frame] = []
        var offset = 0
        while pending.count - offset >= Self.samplesPerFrame {
            frames.append(makeFrame(Array(pending[offset..<offset + Self.samplesPerFrame])))
            offset += Self.samplesPerFrame
        }
        if offset > 0 { pending.removeFirst(offset) }
        return frames
    }

    // Chamado com o lock tomado.
    private func makeFrame(_ samples: [Int16]) -> Frame {
        let timestamp = (startOffsetMs ?? 0) + emittedSamples / 16
        emittedSamples += UInt64(samples.count)
        let data = samples.withUnsafeBufferPointer { Data(buffer: $0) } // arm64 é little-endian
        return Frame(timestampMs: timestamp, pcm: data)
    }

    private func write(_ frames: [Frame]) {
        for frame in frames { sink.write(source: source, timestampMs: frame.timestampMs, pcm: frame.pcm) }
    }
}
