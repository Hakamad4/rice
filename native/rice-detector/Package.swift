// swift-tools-version:5.9
import Foundation
import PackageDescription

let infoPlist = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .appendingPathComponent("Sources/rice-detector/Info.plist").path

let package = Package(
    name: "rice-detector",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "rice-detector",
            path: "Sources/rice-detector",
            exclude: ["Info.plist"],
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", infoPlist]),
                .linkedFramework("CoreAudio"),
                .linkedFramework("EventKit"),
            ]
        ),
    ]
)
