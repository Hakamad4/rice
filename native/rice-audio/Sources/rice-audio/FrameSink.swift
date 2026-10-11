import Foundation

enum AudioSource: UInt8 {
    case mic = 0x01
    case sys = 0x02

    var name: String { self == .mic ? "mic" : "sys" }
}

protocol FrameSink: AnyObject {
    func write(source: AudioSource, timestampMs: UInt64, pcm: Data)
}

/// Contrato §4.1: source(1) + timestampMs(u64 LE) + length(u32 LE) + payload.
/// A escrita é assíncrona numa fila serial (preserva a ordem) para não travar as threads
/// de captura se o leitor do pipe ficar lento. Acima de 30 s de áudio pendente, descarta.
final class StdoutFrameSink: FrameSink {
    static let maxPendingBytes = 30 * 16_000 * 2 // ~1.92 MB

    private let queue = DispatchQueue(label: "rice.audio.stdout")
    private let lock = NSLock()
    private var pendingBytes = 0
    private var backpressured = false

    func write(source: AudioSource, timestampMs: UInt64, pcm: Data) {
        var frame = Data(capacity: 13 + pcm.count)
        frame.append(source.rawValue)
        withUnsafeBytes(of: timestampMs.littleEndian) { frame.append(contentsOf: $0) }
        withUnsafeBytes(of: UInt32(pcm.count).littleEndian) { frame.append(contentsOf: $0) }
        frame.append(pcm)

        let size = frame.count
        let (accepted, shouldReport) = lock.withLock { () -> (Bool, Bool) in
            if pendingBytes + size > Self.maxPendingBytes {
                let first = !backpressured
                backpressured = true
                return (false, first)
            }
            pendingBytes += size
            return (true, false)
        }
        if shouldReport { Events.emit("error", ["source": "cli", "message": "stdout backpressure"]) }
        guard accepted else { return }

        queue.async { [self] in
            FileHandle.standardOutput.write(frame)
            lock.withLock {
                pendingBytes -= size
                if pendingBytes < Self.maxPendingBytes { backpressured = false }
            }
        }
    }

    /// Espera as escritas pendentes terminarem (antes de sair do processo).
    func drain() {
        queue.sync {}
    }
}

/// Modo de teste manual: grava o PCM cru de cada fonte em arquivos separados.
final class FileFrameSink: FrameSink {
    private let handles: [AudioSource: FileHandle]
    private let queue = DispatchQueue(label: "rice.audio.files")

    init(directory: String) throws {
        try FileManager.default.createDirectory(atPath: directory, withIntermediateDirectories: true)
        var handles: [AudioSource: FileHandle] = [:]
        for source in [AudioSource.mic, .sys] {
            let path = (directory as NSString).appendingPathComponent("\(source.name).pcm")
            FileManager.default.createFile(atPath: path, contents: nil)
            handles[source] = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
        }
        self.handles = handles
    }

    func write(source: AudioSource, timestampMs: UInt64, pcm: Data) {
        queue.sync { handles[source]?.write(pcm) }
    }
}
