import AVFoundation
import CoreMedia
import ScreenCaptureKit

enum CaptureError: Error, LocalizedError {
    case noDisplay
    var errorDescription: String? { "nenhum display disponível para capturar áudio" }
}

protocol SystemAudioCapture: AnyObject {
    func start() async throws
    func stop() async
}

final class SystemCapture: NSObject, SystemAudioCapture, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private let resampler = Resampler()
    private let queue = DispatchQueue(label: "rice.audio.sys")
    private let onSamples: ([Int16]) -> Void
    private let onStopped: (Error) -> Void
    private var stopping = false

    init(onSamples: @escaping ([Int16]) -> Void, onStopped: @escaping (Error) -> Void) {
        self.onSamples = onSamples
        self.onStopped = onStopped
    }

    func start() async throws {
        stopping = false
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else { throw CaptureError.noDisplay }
        let filter = SCContentFilter(display: display, excludingWindows: [])

        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = true
        config.sampleRate = 48_000
        config.channelCount = 2
        // Vídeo mínimo: o SCStream exige um, mas só consumimos áudio.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        self.stream = stream
        do {
            try await stream.startCapture()
        } catch {
            self.stream = nil
            throw error
        }
    }

    func stop() async {
        stopping = true
        try? await stream?.stopCapture()
        stream = nil
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, sampleBuffer.isValid, let buffer = Self.pcmBuffer(from: sampleBuffer) else { return }
        let samples = resampler.convert(buffer)
        if !samples.isEmpty { onSamples(samples) }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        if !stopping {
            onStopped(error)
        }
    }

    static func pcmBuffer(from sampleBuffer: CMSampleBuffer) -> AVAudioPCMBuffer? {
        guard let description = sampleBuffer.formatDescription,
              var asbd = description.audioStreamBasicDescription,
              let format = AVAudioFormat(streamDescription: &asbd) else { return nil }
        let frames = AVAudioFrameCount(sampleBuffer.numSamples)
        guard frames > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames) else { return nil }
        buffer.frameLength = frames
        let status = CMSampleBufferCopyPCMDataIntoAudioBufferList(
            sampleBuffer, at: 0, frameCount: Int32(frames), into: buffer.mutableAudioBufferList
        )
        return status == noErr ? buffer : nil
    }
}
