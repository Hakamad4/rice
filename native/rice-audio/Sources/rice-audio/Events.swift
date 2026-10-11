import Foundation

/// Eventos e logs como linhas JSON no stderr. O stdout é exclusivo dos frames.
enum Events {
    private static let queue = DispatchQueue(label: "rice.audio.stderr")

    static func emit(_ event: String, _ fields: [String: Any] = [:]) {
        var object = fields
        object["event"] = event
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
        queue.sync {
            FileHandle.standardError.write(data)
            FileHandle.standardError.write(Data("\n".utf8))
        }
    }
}
