// swift-tools-version:5.9
import Foundation
import PackageDescription

let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let infoPlist = packageDir.appendingPathComponent("Sources/rice-audio/Info.plist").path
// WebRTC audio-processing compilado por scripts/build-webrtc-apm.sh.
let webrtc = packageDir.appendingPathComponent("../third_party/webrtc-apm").standardizedFileURL.path

let package = Package(
    name: "rice-audio",
    platforms: [.macOS(.v14)],
    targets: [
        .target(
            name: "RiceAPM",
            path: "Sources/RiceAPM",
            cxxSettings: [
                .define("WEBRTC_LIBRARY_IMPL"),
                .define("WEBRTC_POSIX"),
                .define("WEBRTC_MAC"),
                .unsafeFlags(["-I\(webrtc)/include/webrtc-audio-processing-2", "-I\(webrtc)/include"]),
            ],
            linkerSettings: [
                .unsafeFlags(["-L\(webrtc)/lib"]),
                .linkedLibrary("webrtc-audio-processing-2"),
                .linkedLibrary("c++"),
                .linkedFramework("CoreFoundation"),
            ]
        ),
        .executableTarget(
            name: "rice-audio",
            dependencies: ["RiceAPM"],
            path: "Sources/rice-audio",
            exclude: ["Info.plist"],
            linkerSettings: [
                .unsafeFlags(["-Xlinker", "-sectcreate", "-Xlinker", "__TEXT", "-Xlinker", "__info_plist", "-Xlinker", infoPlist]),
                .linkedFramework("AVFoundation"),
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("IOKit"),
            ]
        ),
    ],
    cxxLanguageStandard: .cxx17
)
