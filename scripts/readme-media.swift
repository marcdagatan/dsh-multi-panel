// Local documentation tooling only; no runtime plugin dependency.
// Uses macOS AVFoundation to extract reviewed crops and encode silent MP4s.
import Foundation
import AVFoundation
import ImageIO
import CoreVideo

struct MediaError: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}

@main struct ReadmeMedia {
    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count >= 3 else {
            throw MediaError("Usage: inspect INPUT | extract INPUT OUTPUT FPS START END X,Y,W,H | encode FRAMES OUTPUT FPS")
        }
        switch args[1] {
        case "inspect":
            let asset = AVURLAsset(url: URL(fileURLWithPath: args[2]))
            let duration = try await asset.load(.duration)
            let video = try await asset.loadTracks(withMediaType: .video)
            let audio = try await asset.loadTracks(withMediaType: .audio)
            guard let track = video.first else { throw MediaError("No video track") }
            let size = try await track.load(.naturalSize)
            let rate = try await track.load(.nominalFrameRate)
            let report: [String: Any] = ["duration": duration.seconds, "width": size.width, "height": size.height, "fps": rate, "audioTracks": audio.count]
            print(String(data: try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys]), encoding: .utf8)!)
        case "extract":
            guard args.count == 9, let fps = Double(args[4]), fps > 0,
                  let start = Double(args[5]), let end = Double(args[6]), start >= 0, end > start,
                  let referenceWidth = Double(args[8]), referenceWidth > 0 else {
                throw MediaError("extract INPUT OUTPUT FPS START END X,Y,W,H REFERENCE_WIDTH")
            }
            let crop = args[7].split(separator: ",").compactMap { Double($0) }
            guard crop.count == 4, crop[0] >= 0, crop[1] >= 0, crop[2] > 0, crop[3] > 0 else {
                throw MediaError("Invalid crop")
            }
            let asset = AVURLAsset(url: URL(fileURLWithPath: args[2]))
            let duration = try await asset.load(.duration)
            guard end <= duration.seconds else { throw MediaError("Trim exceeds video duration") }
            let output = URL(fileURLWithPath: args[3], isDirectory: true)
            try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
            let generator = AVAssetImageGenerator(asset: asset)
            generator.appliesPreferredTrackTransform = true
            generator.requestedTimeToleranceBefore = .zero
            generator.requestedTimeToleranceAfter = .zero
            let count = Int(ceil((end - start) * fps))
            for index in 0..<count {
                let time = CMTime(seconds: start + Double(index) / fps, preferredTimescale: 600)
                let (image, _) = try await generator.image(at: time)
                let scale = Double(image.width) / referenceWidth
                let rect = CGRect(x: crop[0] * scale, y: crop[1] * scale, width: crop[2] * scale, height: crop[3] * scale).integral
                guard rect.maxX <= Double(image.width), rect.maxY <= Double(image.height),
                      let cropped = image.cropping(to: rect) else { throw MediaError("Crop exceeds frame") }
                let file = output.appendingPathComponent(String(format: "frame-%05d.png", index))
                guard !FileManager.default.fileExists(atPath: file.path) else { throw MediaError("Refusing to replace existing frame") }
                guard let destination = CGImageDestinationCreateWithURL(file as CFURL, "public.png" as CFString, 1, nil) else {
                    throw MediaError("Cannot create PNG")
                }
                CGImageDestinationAddImage(destination, cropped, nil)
                guard CGImageDestinationFinalize(destination) else { throw MediaError("Cannot write PNG") }
            }
            print("Extracted \(count) cropped frames")
        case "encode":
            guard args.count == 5, let fps = Int32(args[4]), fps > 0 else { throw MediaError("encode FRAMES OUTPUT FPS") }
            let folder = URL(fileURLWithPath: args[2], isDirectory: true)
            let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
                .filter { $0.lastPathComponent.hasPrefix("frame-") && $0.pathExtension == "png" }
                .sorted { $0.lastPathComponent < $1.lastPathComponent }
            guard let first = files.first,
                  let firstSource = CGImageSourceCreateWithURL(first as CFURL, nil),
                  let firstImage = CGImageSourceCreateImageAtIndex(firstSource, 0, nil) else { throw MediaError("No PNG frames") }
            let width = firstImage.width, height = firstImage.height
            guard width % 2 == 0, height % 2 == 0 else { throw MediaError("H.264 requires even frame dimensions") }
            let output = URL(fileURLWithPath: args[3])
            guard !FileManager.default.fileExists(atPath: output.path) else { throw MediaError("Refusing to replace existing video") }
            let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264,
                AVVideoWidthKey: width,
                AVVideoHeightKey: height,
                AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_800_000]
            ])
            input.expectsMediaDataInRealTime = false
            let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                kCVPixelBufferWidthKey as String: width,
                kCVPixelBufferHeightKey as String: height,
                kCVPixelBufferCGImageCompatibilityKey as String: true,
                kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
            ])
            guard writer.canAdd(input) else { throw MediaError("Cannot add video input") }
            writer.add(input)
            guard writer.startWriting() else { throw writer.error ?? MediaError("Cannot start encoding") }
            writer.startSession(atSourceTime: .zero)
            guard let pool = adaptor.pixelBufferPool else { throw MediaError("No pixel buffer pool") }
            for (index, file) in files.enumerated() {
                while !input.isReadyForMoreMediaData {
                    guard writer.status == .writing else { throw writer.error ?? MediaError("Encoder stopped") }
                    try await Task.sleep(nanoseconds: 2_000_000)
                }
                guard let source = CGImageSourceCreateWithURL(file as CFURL, nil),
                      let image = CGImageSourceCreateImageAtIndex(source, 0, nil),
                      image.width == width, image.height == height else { throw MediaError("Frame dimensions changed") }
                var buffer: CVPixelBuffer?
                guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess, let buffer else {
                    throw MediaError("Cannot allocate pixel buffer")
                }
                CVPixelBufferLockBaseAddress(buffer, [])
                guard let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height,
                    bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
                    space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue) else {
                    throw MediaError("Cannot create frame context")
                }
                context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
                CVPixelBufferUnlockBaseAddress(buffer, [])
                guard adaptor.append(buffer, withPresentationTime: CMTime(value: Int64(index), timescale: fps)) else {
                    throw writer.error ?? MediaError("Cannot append frame")
                }
            }
            input.markAsFinished()
            writer.endSession(atSourceTime: CMTime(value: Int64(files.count), timescale: fps))
            await writer.finishWriting()
            guard writer.status == .completed else { throw writer.error ?? MediaError("Cannot finish video") }
            print("Encoded \(files.count) frames; no audio or source metadata copied")
        default:
            throw MediaError("Unknown operation")
        }
    }
}
