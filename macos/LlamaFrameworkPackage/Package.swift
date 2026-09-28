// swift-tools-version: 5.10
import PackageDescription

let package = Package(
  name: "LlamaFrameworkPackage",
  platforms: [.macOS(.v14)],
  products: [
    .library(name: "LlamaFramework", targets: ["LlamaFramework"]),
  ],
  targets: [
    .binaryTarget(
      name: "LlamaFramework",
      url: "https://github.com/ggml-org/llama.cpp/releases/download/b11146/llama-b11146-xcframework.zip",
      checksum: "1c306afe9fe68a90c4bdc74619d8558d6e0754f085deb105dd2d70293a9a964f"
    ),
  ]
)
