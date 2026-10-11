import Foundation

enum AppMatcher {
    private static let apps: [(name: String, bundles: [String])] = [
        ("Zoom", ["us.zoom.xos"]),
        ("Microsoft Teams", ["com.microsoft.teams", "com.microsoft.teams2"]),
        ("Google Chrome", ["com.google.Chrome"]),
        ("Arc", ["company.thebrowser.Browser"]),
        ("Safari", ["com.apple.Safari", "com.apple.WebKit"]),
        ("Firefox", ["org.mozilla.firefox"]),
        ("Microsoft Edge", ["com.microsoft.edgemac"]),
        ("Brave", ["com.brave.Browser"]),
        ("Slack", ["com.tinyspeck.slackmacgap"]),
        ("FaceTime", ["com.apple.FaceTime", "com.apple.avconferenced"]),
        ("Discord", ["com.hnc.Discord"]),
        ("Webex", ["com.cisco.webexmeetingsapp", "Cisco-Systems.Spark"]),
    ]

    /// Casa o bundle id exato ou seus sub-processos (`<bundle>.helper`, `<bundle>.GPU`, …).
    static func match(bundleId: String) -> String? {
        guard !bundleId.isEmpty else { return nil }
        for app in apps {
            for bundle in app.bundles where bundleId == bundle || bundleId.hasPrefix(bundle + ".") {
                return app.name
            }
        }
        return nil
    }
}
