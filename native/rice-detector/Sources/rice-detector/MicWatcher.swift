import Foundation

/// Transforma snapshots de "quem usa o mic" em eventos de transição por app.
final class MicWatcher {
    private(set) var activeApps: [String: String] = [:]

    func tick(bundleIds: [String]) {
        var current: [String: String] = [:]
        for bundleId in bundleIds {
            guard let app = AppMatcher.match(bundleId: bundleId), current[app] == nil else { continue }
            current[app] = activeApps[app] ?? bundleId
        }
        for (app, bundleId) in current.sorted(by: { $0.key < $1.key }) where activeApps[app] == nil {
            Output.emit("mic-in-use", ["app": app, "bundleId": bundleId])
        }
        for (app, bundleId) in activeApps.sorted(by: { $0.key < $1.key }) where current[app] == nil {
            Output.emit("mic-released", ["app": app, "bundleId": bundleId])
        }
        activeApps = current
    }
}
