import AVFoundation

/// Converte qualquer formato PCM para 16 kHz mono Int16. Mantém o estado do conversor
/// entre chamadas (filtro contínuo) e o recria se o formato de entrada mudar.
final class Resampler {
    static let outputFormat = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: 16_000, channels: 1, interleaved: true
    )!

    private var converter: AVAudioConverter?
    private var inputFormat: AVAudioFormat?
    private var reportedFormats = Set<String>()

    func convert(_ buffer: AVAudioPCMBuffer) -> [Int16] {
        if inputFormat == nil || inputFormat! != buffer.format {
            converter = AVAudioConverter(from: buffer.format, to: Self.outputFormat)
            converter?.downmix = true
            inputFormat = buffer.format
        }
        guard buffer.frameLength > 0 else { return [] }
        guard let converter else {
            reportOnce(buffer.format, "conversor indisponível para o formato de entrada")
            return []
        }

        let ratio = Self.outputFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
        guard let output = AVAudioPCMBuffer(pcmFormat: Self.outputFormat, frameCapacity: capacity) else { return [] }

        var supplied = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, inputStatus in
            if supplied {
                inputStatus.pointee = .noDataNow
                return nil
            }
            supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, let channel = output.int16ChannelData else {
            reportOnce(buffer.format, error?.localizedDescription ?? "convert failed")
            return []
        }
        return Array(UnsafeBufferPointer(start: channel[0], count: Int(output.frameLength)))
    }

    /// Um erro por formato de entrada, para não inundar o stderr a cada buffer.
    private func reportOnce(_ format: AVAudioFormat, _ message: String) {
        guard reportedFormats.insert(format.description).inserted else { return }
        Events.emit("error", ["source": "resampler", "message": message])
    }
}
