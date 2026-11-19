// 사용법: ocr <그림 경로>...   — 그림마다 한 줄 JSON {"path": ..., "lines": [...]}을 낸다.
// 읽지 못한 그림은 lines가 빈 목록이다(멈추지 않는다).
import Foundation
import Vision
import ImageIO

func recognize(_ path: String) -> [String] {
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(src, 0, nil) else { return [] }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.recognitionLanguages = ["ko-KR", "en-US"]
  request.usesLanguageCorrection = false
  let handler = VNImageRequestHandler(cgImage: image, options: [:])
  do { try handler.perform([request]) } catch { return [] }
  let results = request.results ?? []
  return results.compactMap { $0.topCandidates(1).first?.string }
}

for path in CommandLine.arguments.dropFirst() {
  let obj: [String: Any] = ["path": path, "lines": recognize(path)]
  if let data = try? JSONSerialization.data(withJSONObject: obj, options: [.withoutEscapingSlashes]),
     let line = String(data: data, encoding: .utf8) {
    print(line)
  }
}
