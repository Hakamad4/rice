import Foundation

enum Output {
    private static let queue = DispatchQueue(label: "rice.detector.stdout")

    private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime]
        f.timeZone = .current
        return f
    }()

    static func iso(_ date: Date) -> String { formatter.string(from: date) }

    static func emit(_ event: String, _ fields: [String: Any?] = [:]) {
        var object: [String: Any] = ["event": event]
        for (key, value) in fields { object[key] = value ?? NSNull() }
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else { return }
        queue.sync {
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data("\n".utf8))
        }
    }
}
